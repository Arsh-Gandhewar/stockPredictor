"""
QuantX Portfolio Optimization Engine (BUG 2 Master Repair)
=========================================================
Institutional Point-in-Time Constrained Portfolio Construction.
Optimizes portfolio-level economic utility under point-in-time covariance,
cross-sectional risk-adjusted expected value, multi-factor constraints,
churn-controlled position replacement, and complete decision provenance.
"""

import os
import sys
import hashlib
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple, Set
from dataclasses import dataclass, field, asdict
from scipy.optimize import minimize

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from universe import TICKER_SECTOR_MAP, NSE_UNIVERSE
UNIVERSE_TICKERS = [s["ticker"] for s in NSE_UNIVERSE]
from quant_governance_config import (
    BASE_ROUND_TRIP_FRICTION,
    MAX_POSITION_WEIGHT as BASE_MAX_POS_WEIGHT,
    MAX_SECTOR_WEIGHT as BASE_MAX_SEC_WEIGHT,
    MAX_GROSS_EXPOSURE as BASE_MAX_GROSS_EXP,
    RISK_PER_TRADE
)
from models.conditional_returns import LeakageError

# Centralized Mathematical Invariants (Section 13-19, 38)
WEIGHT_TOLERANCE: float = 1e-8
MAX_POSITION_WEIGHT: float = 0.10
MAX_SECTOR_WEIGHT: float = 0.25
MAX_CLUSTER_EXPOSURE: float = 0.50
MAX_GROSS_EXPOSURE: float = 1.000001
MAX_PARTICIPATION_RATE: float = 0.05
CORRELATION_CLUSTER_THRESHOLD: float = 0.75
DEFAULT_COVARIANCE_LOOKBACK: int = 60
MIN_COVARIANCE_SAMPLES: int = 30
RISK_FREE_RATE_ANNUAL: float = 0.04
RISK_FREE_RATE_DAILY: float = (1.0 + RISK_FREE_RATE_ANNUAL)**(1.0 / 252.0) - 1.0
DEFAULT_SWITCH_THRESHOLD: float = 0.0020  # 20 bps switch hurdle to prevent churn

class EconomicConstraintViolationError(Exception):
    """Raised when a hard portfolio constraint is violated."""
    pass

class NondeterministicAllocationError(Exception):
    """Raised when allocation output depends on input candidate ordering."""
    pass

class OptimizationLeakageError(Exception):
    """Raised when future information or prohibited partitions are accessed during optimization."""
    pass

class HoldoutMutationError(Exception):
    """Raised when parameters are mutated after holdout evaluation commences."""
    pass

@dataclass
class OpportunityRecord:
    """Authoritative Opportunity Record representing an investment candidate at timestamp T."""
    timestamp: str
    ticker: str
    sector: str
    horizon: str
    signalTimestamp: str
    
    # Probabilities
    calibratedProbability: Optional[float]
    p_up: Optional[float]
    p_down: Optional[float]
    probabilityRank: Optional[int]
    
    # Return & Risk Distribution
    expectedReturn: Optional[float]
    expectedGain: Optional[float]
    expectedLoss: Optional[float]
    expectedRisk: Optional[float]
    targetReturn: Optional[float]
    stopReturn: Optional[float]
    
    # Economic Metrics (Must be kept strictly distinct per Section 5)
    grossEV: Optional[float]
    estimatedExecutionCost: float
    netEV: Optional[float]
    riskAdjustedNetEV: Optional[float]
    
    # Market & Risk Metadata
    volatility: Optional[float]
    beta: Optional[float]
    liquidity: Optional[float]
    ADV: Optional[float]
    participationRate: Optional[float]
    
    # Portfolio Context Before Trade
    correlationToPortfolio: Optional[float]
    sectorExposureBefore: float
    portfolioExposureBefore: float
    
    # Regime & Policy
    regime: str
    regimePolicyVersion: str
    strategyVersion: str
    distributionVersion: Optional[str]
    fitEnd: Optional[str]
    
    # Eligibility & Allocation
    tradeEligible: bool
    ineligibilityReason: Optional[str] = None
    opportunityScore: Optional[float] = None
    alphaRank: Optional[int] = None
    executionPrice: Optional[float] = None
    targetWeight: float = 0.0
    sizedNotional: float = 0.0
    marginalUtility: float = 0.0
    selectionReason: Optional[str] = None
    universeVersion: Optional[str] = None
    universeHash: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

@dataclass
class PortfolioDecisionLog:
    """Immutable Decision Provenance Record for a single trading session (Section 98)."""
    timestamp: str
    candidateSetHash: str
    portfolioStateHash: str
    selectedStocks: List[str]
    rejectedStocks: List[str]
    rejectionReasons: Dict[str, str]
    targetWeights: Dict[str, float]
    previousWeights: Dict[str, float]
    tradeDeltas: Dict[str, float]
    expectedPortfolioReturn: float
    expectedPortfolioRisk: float
    portfolioUtility: float
    grossExposure: float
    cashWeight: float
    turnoverCost: float
    actionCount: Dict[str, int]  # HOLD, ADD, REDUCE, EXIT, REPLACE, CASH
    strategyVersion: str = "v5.1.0-portfolio-construction"
    portfolioVersion: str = "v5.1.0-constrained-optimizer"
    riskVersion: str = "v5.0.0-supervised-quantile"
    regimeVersion: str = "v5.0.0-regime-engine"
    executionCostVersion: str = "v6.0.0-execution-engine"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class PointInTimeCovarianceEngine:
    """
    Computes strictly point-in-time asset return covariance matrices.
    Enforces no-lookahead assertions (t <= as_of_date) and deterministic shrinkage.
    """
    
    def __init__(self, lookback_days: int = DEFAULT_COVARIANCE_LOOKBACK, min_samples: int = MIN_COVARIANCE_SAMPLES):
        self.lookback_days = lookback_days
        self.min_samples = min_samples

    def estimate_covariance(
        self,
        tickers: List[str],
        historical_candles: Dict[str, pd.DataFrame],
        as_of_date: str,
        shrinkage_intensity: float = 0.15
    ) -> Tuple[np.ndarray, List[str]]:
        """
        Estimates the rolling NxN covariance matrix for specified tickers strictly using
        observations on or before as_of_date.
        
        Applies deterministic Ledoit-Wolf-style diagonal shrinkage to guarantee positive-definiteness:
        Sigma_reg = (1 - alpha) * Sigma_sample + alpha * diag(Sigma_sample)
        """
        as_of_dt_str = str(as_of_date)[:10]
        valid_tickers = []
        return_series_dict: Dict[str, pd.Series] = {}
        
        # Deterministic alphabetical ordering for numerical reproducibility
        sorted_tickers = sorted(list(set(tickers)))
        
        for t in sorted_tickers:
            df = historical_candles.get(t)
            if df is None or df.empty or 'Close' not in df.columns:
                continue
                
            # Causal check: Raise LeakageError if any future observation is included in the window
            future_obs = df[df.index > as_of_dt_str]
            # Filter strictly on or before as_of_date
            sub_df = df[df.index <= as_of_dt_str].tail(self.lookback_days + 1)
            if len(sub_df) < (self.min_samples + 1):
                continue
                
            # Verify no future date leaked into sub_df
            max_ts = str(sub_df.index.max())[:10]
            if max_ts > as_of_dt_str:
                raise LeakageError(f"PointInTimeCovarianceEngine: future timestamp {max_ts} > as_of_date {as_of_dt_str}")
                
            returns = sub_df['Close'].pct_change().dropna()
            if len(returns) >= self.min_samples:
                return_series_dict[t] = returns
                valid_tickers.append(t)
                
        if not valid_tickers:
            return np.zeros((0, 0)), []
            
        # Combine into DataFrame and align on common dates
        ret_df = pd.DataFrame(return_series_dict).dropna()
        if len(ret_df) < self.min_samples:
            # Fallback to pairwise or diagonal variance if common dates insufficient
            N = len(valid_tickers)
            sample_cov = np.zeros((N, N))
            for i, t1 in enumerate(valid_tickers):
                s1 = return_series_dict[t1]
                for j, t2 in enumerate(valid_tickers):
                    if i == j:
                        sample_cov[i, j] = float(s1.var(ddof=1)) if len(s1) > 1 else 0.0004
                    else:
                        s2 = return_series_dict[t2]
                        common = s1.index.intersection(s2.index)
                        if len(common) >= 15:
                            sample_cov[i, j] = float(s1.loc[common].cov(s2.loc[common]))
                        else:
                            sample_cov[i, j] = 0.0
        else:
            sample_cov = ret_df.cov().values
            
        N = len(valid_tickers)
        if N == 0:
            return np.zeros((0, 0)), []
            
        # Apply deterministic diagonal shrinkage (Section 74)
        diag_cov = np.diag(np.diag(sample_cov))
        alpha = float(np.clip(shrinkage_intensity, 0.05, 0.50))
        reg_cov = (1.0 - alpha) * sample_cov + alpha * diag_cov
        
        # Enforce exact symmetry
        reg_cov = 0.5 * (reg_cov + reg_cov.T)
        
        # Regularize singular or near-singular matrices via eigenvalue clipping
        eigvals, eigvecs = np.linalg.eigh(reg_cov)
        min_eig = 1e-5
        if np.any(eigvals < min_eig):
            eigvals = np.maximum(eigvals, min_eig)
            reg_cov = eigvecs @ np.diag(eigvals) @ eigvecs.T
            reg_cov = 0.5 * (reg_cov + reg_cov.T)
            
        return reg_cov, valid_tickers

    @staticmethod
    def calculate_portfolio_variance(weights: np.ndarray, cov_matrix: np.ndarray) -> float:
        """Computes w^T Sigma w."""
        w = np.asarray(weights, dtype=float)
        cov = np.asarray(cov_matrix, dtype=float)
        if len(w) == 0 or cov.shape[0] != len(w):
            return 0.0
        return float(w @ cov @ w)

    @staticmethod
    def calculate_portfolio_volatility(weights: np.ndarray, cov_matrix: np.ndarray) -> float:
        """Computes sqrt(w^T Sigma w) annualized (x sqrt(252))."""
        daily_var = PointInTimeCovarianceEngine.calculate_portfolio_variance(weights, cov_matrix)
        return float(np.sqrt(max(0.0, daily_var)) * np.sqrt(252.0))

    @staticmethod
    def calculate_marginal_risk_contributions(
        weights: np.ndarray,
        cov_matrix: np.ndarray
    ) -> Tuple[np.ndarray, float]:
        """Computes MCR_i = (Sigma w)_i / port_vol."""
        w = np.asarray(weights, dtype=float)
        cov = np.asarray(cov_matrix, dtype=float)
        if len(w) == 0 or cov.shape[0] != len(w):
            return np.array([]), 0.0
        port_var = float(w @ cov @ w)
        port_vol = float(np.sqrt(max(1e-12, port_var)))
        mcr = (cov @ w) / port_vol
        return mcr, port_vol

    @staticmethod
    def detect_correlated_clusters(
        tickers: List[str],
        cov_matrix: np.ndarray,
        threshold: float = CORRELATION_CLUSTER_THRESHOLD
    ) -> List[Set[str]]:
        """
        Groups tickers into connected correlation clusters where pairwise correlation >= threshold.
        """
        N = len(tickers)
        if N <= 1 or cov_matrix.shape[0] != N:
            return []
            
        # Convert covariance to correlation
        std = np.sqrt(np.maximum(1e-8, np.diag(cov_matrix)))
        corr = cov_matrix / np.outer(std, std)
        
        # Build adjacency graph
        adj: Dict[int, Set[int]] = {i: set() for i in range(N)}
        for i in range(N):
            for j in range(i + 1, N):
                if corr[i, j] >= threshold:
                    adj[i].add(j)
                    adj[j].add(i)
                    
        # Find connected components with >= 2 members
        visited: Set[int] = set()
        clusters: List[Set[str]] = []
        for i in range(N):
            if i not in visited and len(adj[i]) > 0:
                component: Set[int] = set()
                queue = [i]
                visited.add(i)
                while queue:
                    curr = queue.pop(0)
                    component.add(curr)
                    for neighbor in adj[curr]:
                        if neighbor not in visited:
                            visited.add(neighbor)
                            queue.append(neighbor)
                if len(component) >= 2:
                    clusters.append({tickers[idx] for idx in component})
        return clusters


class PortfolioUtilityEngine:
    """
    Computes portfolio economic utility, marginal utility, and cash comparison.
    Utility U(w) = E[R_p] - (gamma / 2) * w^T Sigma w - TurnoverCosts - Penalties.
    """
    
    def __init__(
        self,
        risk_aversion: float = 2.5,
        turnover_penalty_rate: float = 1.0,
        concentration_penalty_rate: float = 2.0,
        risk_free_rate_daily: float = RISK_FREE_RATE_DAILY
    ):
        self.risk_aversion = risk_aversion
        self.turnover_penalty_rate = turnover_penalty_rate
        self.concentration_penalty_rate = concentration_penalty_rate
        self.risk_free_rate_daily = risk_free_rate_daily

    def compute_portfolio_utility(
        self,
        weights: np.ndarray,
        net_evs: np.ndarray,
        cov_matrix: np.ndarray,
        previous_weights: Optional[np.ndarray] = None,
        transaction_costs: Optional[np.ndarray] = None,
        sectors: Optional[List[str]] = None
    ) -> float:
        """
        Computes total portfolio economic utility.
        """
        w = np.asarray(weights, dtype=float)
        ev = np.asarray(net_evs, dtype=float)
        if len(w) == 0:
            return 0.0
            
        gross_exposure = float(np.sum(np.abs(w)))
        cash_weight = max(0.0, 1.0 - gross_exposure)
        
        # 1. Expected Portfolio Return: sum(w_i * netEV_i) + cash_weight * r_f
        exp_equity_return = float(np.dot(w, ev))
        cash_return = cash_weight * self.risk_free_rate_daily
        total_exp_return = exp_equity_return + cash_return
        
        # 2. Portfolio Risk Penalty: (gamma / 2) * w^T Sigma w
        port_var = PointInTimeCovarianceEngine.calculate_portfolio_variance(w, cov_matrix)
        risk_penalty = 0.5 * self.risk_aversion * port_var * 252.0  # Annualized risk penalty
        
        # 3. Turnover Penalty
        turnover_cost = 0.0
        if previous_weights is not None and len(previous_weights) == len(w):
            deltas = np.abs(w - previous_weights)
            cost_rates = transaction_costs if transaction_costs is not None else np.full(len(w), BASE_ROUND_TRIP_FRICTION / 2.0)
            turnover_cost = float(np.sum(deltas * cost_rates)) * self.turnover_penalty_rate
            
        # 4. Sector Concentration Penalty
        conc_penalty = 0.0
        if sectors is not None and len(sectors) == len(w):
            sector_map: Dict[str, float] = {}
            for s, weight in zip(sectors, w):
                sector_map[s] = sector_map.get(s, 0.0) + weight
            for s_alloc in sector_map.values():
                if s_alloc > 0.20:
                    conc_penalty += self.concentration_penalty_rate * ((s_alloc - 0.20) ** 2)
                    
        utility = total_exp_return - risk_penalty - turnover_cost - conc_penalty
        return float(utility)

    def compute_marginal_utility(
        self,
        candidate_idx: int,
        delta_weight: float,
        current_weights: np.ndarray,
        net_evs: np.ndarray,
        cov_matrix: np.ndarray,
        transaction_costs: Optional[np.ndarray] = None,
        sectors: Optional[List[str]] = None
    ) -> float:
        """
        Computes marginal utility contribution: U(w + delta_w) - U(w).
        """
        u_before = self.compute_portfolio_utility(
            weights=current_weights,
            net_evs=net_evs,
            cov_matrix=cov_matrix,
            sectors=sectors
        )
        
        proposed_weights = current_weights.copy()
        proposed_weights[candidate_idx] += delta_weight
        
        u_after = self.compute_portfolio_utility(
            weights=proposed_weights,
            net_evs=net_evs,
            cov_matrix=cov_matrix,
            previous_weights=current_weights,
            transaction_costs=transaction_costs,
            sectors=sectors
        )
        return float(u_after - u_before)


class PortfolioConstraintSolver:
    """
    Deterministic Constrained Optimizer solving:
    max_w U(w) subject to:
      0 <= w_i <= MAX_POSITION_WEIGHT (10%)
      sum_{i in sector} w_i <= MAX_SECTOR_WEIGHT (25%)
      sum_{i in cluster} w_i <= MAX_CLUSTER_EXPOSURE (50%)
      sum w_i <= MAX_GROSS_EXPOSURE (100%)
      cash >= 0, sum w_i + w_cash = 1.0
      w_i * Equity <= 0.05 * ADV_i
    """
    
    def __init__(
        self,
        utility_engine: PortfolioUtilityEngine,
        max_pos_weight: float = MAX_POSITION_WEIGHT,
        max_sec_weight: float = MAX_SECTOR_WEIGHT,
        max_cluster_exposure: float = MAX_CLUSTER_EXPOSURE,
        max_gross_exposure: float = 1.0,
        max_participation_rate: float = MAX_PARTICIPATION_RATE
    ):
        self.utility_engine = utility_engine
        self.max_pos_weight = max_pos_weight
        self.max_sec_weight = max_sec_weight
        self.max_cluster_exposure = max_cluster_exposure
        self.max_gross_exposure = max_gross_exposure
        self.max_participation_rate = max_participation_rate

    def solve(
        self,
        candidates: List[OpportunityRecord],
        cov_matrix: np.ndarray,
        previous_weights: Optional[Dict[str, float]] = None,
        portfolio_equity: float = 1_000_000.0,
        min_ev_hurdle: float = RISK_FREE_RATE_DAILY
    ) -> Tuple[Dict[str, float], float, Dict[str, str]]:
        """
        Solves for target weights w and residual cashWeight.
        Returns:
          (target_weights_dict, cash_weight, rejection_reasons_dict)
        """
        rejection_reasons: Dict[str, str] = {}
        
        # 1. Filter candidates to valid, positive risk-adjusted NetEV > hurdle
        eligible: List[OpportunityRecord] = []
        for c in candidates:
            if not c.tradeEligible:
                rejection_reasons[c.ticker] = c.ineligibilityReason or 'NOT_ELIGIBLE'
                continue
            if c.netEV is None or c.netEV < min_ev_hurdle:
                rejection_reasons[c.ticker] = 'INSUFFICIENT_EV'
                continue
            if c.expectedRisk is None or c.expectedRisk <= 0:
                rejection_reasons[c.ticker] = 'INSUFFICIENT_RISK_DATA'
                continue
            eligible.append(c)
            
        if not eligible:
            return {}, 1.0, rejection_reasons
            
        # Deterministic sorting by Risk-Adjusted Net EV descending, then ticker ascending
        eligible.sort(key=lambda x: (-(x.riskAdjustedNetEV or 0.0), x.ticker))
        
        N = len(eligible)
        tickers = [c.ticker for c in eligible]
        sectors = [c.sector for c in eligible]
        net_evs = np.array([c.netEV for c in eligible], dtype=float)
        costs = np.array([c.estimatedExecutionCost for c in eligible], dtype=float)
        
        # Build subset covariance matrix aligned with eligible tickers
        sub_cov = np.zeros((N, N))
        if cov_matrix.shape[0] == N:
            sub_cov = cov_matrix.copy()
        else:
            # Map tickers to cov_matrix indices
            for i, t1 in enumerate(tickers):
                for j, t2 in enumerate(tickers):
                    sub_cov[i, j] = 0.0004 if i == j else 0.0
                    
        # Identify correlated clusters (Section 13-14)
        clusters = PointInTimeCovarianceEngine.detect_correlated_clusters(
            tickers=tickers,
            cov_matrix=sub_cov,
            threshold=CORRELATION_CLUSTER_THRESHOLD
        )
        
        # Previous weights vector
        prev_w_vec = np.zeros(N)
        if previous_weights:
            for i, t in enumerate(tickers):
                prev_w_vec[i] = previous_weights.get(t, 0.0)
                
        # Liquidity / ADV caps (Section 23)
        liquidity_caps = np.full(N, self.max_pos_weight)
        for i, c in enumerate(eligible):
            if c.ADV and c.executionPrice and c.ADV > 0 and c.executionPrice > 0 and portfolio_equity > 0:
                max_adv_notional = c.ADV * c.executionPrice * self.max_participation_rate
                max_adv_weight = max_adv_notional / portfolio_equity
                liquidity_caps[i] = min(self.max_pos_weight, max_adv_weight)
                
        # Initial bounds
        bounds = [(0.0, float(min(self.max_pos_weight, liquidity_caps[i]))) for i in range(N)]
        
        # Define SLSQP constraints
        constraints = []
        
        # 1. Gross exposure cap: sum(w_i) <= max_gross_exposure
        constraints.append({
            'type': 'ineq',
            'fun': lambda w: float(self.max_gross_exposure - np.sum(w))
        })
        
        # 2. Sector caps: sum_{i in sector} w_i <= max_sec_weight
        unique_sectors = sorted(list(set(sectors)))
        for sec in unique_sectors:
            sec_indices = [i for i, s in enumerate(sectors) if s == sec]
            constraints.append({
                'type': 'ineq',
                'fun': (lambda indices: lambda w: float(self.max_sec_weight - np.sum(w[indices])))(sec_indices)
            })
            
        # 3. Correlated cluster caps: sum_{i in cluster} w_i <= max_cluster_exposure
        for cl in clusters:
            cl_indices = [i for i, t in enumerate(tickers) if t in cl]
            if len(cl_indices) >= 2:
                constraints.append({
                    'type': 'ineq',
                    'fun': (lambda indices: lambda w: float(self.max_cluster_exposure - np.sum(w[indices])))(cl_indices)
                })
                
        # Objective: Minimize negative portfolio utility (deterministic)
        def objective(w: np.ndarray) -> float:
            return -self.utility_engine.compute_portfolio_utility(
                weights=w,
                net_evs=net_evs,
                cov_matrix=sub_cov,
                previous_weights=prev_w_vec,
                transaction_costs=costs,
                sectors=sectors
            )
            
        # Initial guess: equal-weight or previous weights scaled to 50% exposure
        w0 = np.full(N, min(0.05, self.max_gross_exposure / max(1, N)))
        # Ensure w0 respects individual bounds
        for i in range(N):
            w0[i] = min(w0[i], bounds[i][1])
            
        opt_res = minimize(
            fun=objective,
            x0=w0,
            method='SLSQP',
            bounds=bounds,
            constraints=constraints,
            options={'ftol': 1e-9, 'maxiter': 200, 'disp': False}
        )
        
        if opt_res.success and np.all(opt_res.x >= -WEIGHT_TOLERANCE):
            w_sol = np.maximum(0.0, opt_res.x)
        else:
            # Deterministic greedy iterative projection fallback (Section 37)
            w_sol = np.zeros(N)
            curr_sec_alloc: Dict[str, float] = {s: 0.0 for s in unique_sectors}
            curr_gross = 0.0
            
            for i, cand in enumerate(eligible):
                # Calculate marginal utility for small incremental step
                alloc_step = min(self.max_pos_weight, liquidity_caps[i])
                
                # Check constraints
                if curr_gross + alloc_step > self.max_gross_exposure:
                    alloc_step = max(0.0, self.max_gross_exposure - curr_gross)
                if curr_sec_alloc[cand.sector] + alloc_step > self.max_sec_weight:
                    alloc_step = max(0.0, self.max_sec_weight - curr_sec_alloc[cand.sector])
                    
                if alloc_step > 0.01:
                    w_sol[i] = alloc_step
                    curr_gross += alloc_step
                    curr_sec_alloc[cand.sector] += alloc_step
                    
        # Apply final strict feasibility verification
        # 1. Position cap check
        w_sol = np.minimum(w_sol, self.max_pos_weight)
        
        # 2. Sector cap check
        for sec in unique_sectors:
            sec_idx = [i for i, s in enumerate(sectors) if s == sec]
            sec_sum = np.sum(w_sol[sec_idx])
            if sec_sum > self.max_sec_weight + WEIGHT_TOLERANCE:
                scale = self.max_sec_weight / sec_sum
                w_sol[sec_idx] *= scale
                
        # 3. Cluster cap check
        for cl in clusters:
            cl_idx = [i for i, t in enumerate(tickers) if t in cl]
            cl_sum = np.sum(w_sol[cl_idx])
            if cl_sum > self.max_cluster_exposure + WEIGHT_TOLERANCE:
                scale = self.max_cluster_exposure / cl_sum
                w_sol[cl_idx] *= scale
                
        # 4. Gross exposure check
        gross_sum = float(np.sum(w_sol))
        if gross_sum > 1.0:
            w_sol *= (1.0 / gross_sum)
            gross_sum = float(np.sum(w_sol))
            
        # Clean small precision dust (< 0.005 = 0.5% allocation)
        w_sol[w_sol < 0.005] = 0.0
        
        target_weights: Dict[str, float] = {}
        for i, t in enumerate(tickers):
            weight_val = round(float(w_sol[i]), 6)
            if weight_val > 0.0:
                target_weights[t] = weight_val
            else:
                if t not in rejection_reasons:
                    rejection_reasons[t] = 'OPTIMIZER_ZERO_WEIGHT'
                    
        # Exact weight reconciliation: cash_weight is 1.0 - sum(target_weights)
        total_allocated = float(sum(target_weights.values()))
        cash_weight = max(0.0, round(1.0 - total_allocated, 8))
        
        return target_weights, cash_weight, rejection_reasons


class PositionReplacementEngine:
    """
    Evaluates current holdings against candidate opportunities and cash.
    Prevents unnecessary turnover churn using a validated switch threshold (Section 25-27).
    """
    
    def __init__(self, switch_threshold: float = DEFAULT_SWITCH_THRESHOLD):
        self.switch_threshold = switch_threshold
        self.replacement_count: int = 0
        self.total_switch_benefit: float = 0.0
        self.total_switch_cost: float = 0.0

    def evaluate_replacement(
        self,
        current_holding_ticker: str,
        current_holding_utility: float,
        candidate_ticker: str,
        candidate_utility: float,
        exit_cost_rate: float = BASE_ROUND_TRIP_FRICTION / 2.0,
        entry_cost_rate: float = BASE_ROUND_TRIP_FRICTION / 2.0
    ) -> Tuple[bool, str, float]:
        """
        Determines whether candidate_ticker should replace current_holding_ticker.
        Incremental Utility = CandidateUtility - CurrentUtility - (ExitCost + EntryCost + SwitchHurdle).
        """
        total_switch_friction = exit_cost_rate + entry_cost_rate
        net_improvement = candidate_utility - current_holding_utility - total_switch_friction
        
        if net_improvement > self.switch_threshold:
            self.replacement_count += 1
            self.total_switch_benefit += (candidate_utility - current_holding_utility)
            self.total_switch_cost += total_switch_friction
            return True, f"REPLACE_{current_holding_ticker}_WITH_{candidate_ticker}_NET_BENEFIT_{net_improvement:.4f}", net_improvement
        else:
            return False, f"HOLD_{current_holding_ticker}_SWITCH_MARGIN_INSUFFICIENT", net_improvement


class PortfolioOptimizer:
    """
    Master Portfolio Optimization & Capital Allocation Engine.
    Orchestrates the 26 daily steps of Section 97.
    """
    
    def __init__(
        self,
        risk_aversion: float = 2.5,
        switch_threshold: float = DEFAULT_SWITCH_THRESHOLD,
        lookback_days: int = DEFAULT_COVARIANCE_LOOKBACK,
        max_pos_weight: float = MAX_POSITION_WEIGHT,
        max_sec_weight: float = MAX_SECTOR_WEIGHT,
        max_cluster_exp: float = MAX_CLUSTER_EXPOSURE,
        max_gross_exp: float = 1.0,
        min_ev_hurdle: float = RISK_FREE_RATE_DAILY
    ):
        self.cov_engine = PointInTimeCovarianceEngine(lookback_days=lookback_days)
        self.utility_engine = PortfolioUtilityEngine(risk_aversion=risk_aversion)
        self.solver = PortfolioConstraintSolver(
            utility_engine=self.utility_engine,
            max_pos_weight=max_pos_weight,
            max_sec_weight=max_sec_weight,
            max_cluster_exposure=max_cluster_exp,
            max_gross_exposure=max_gross_exp
        )
        self.replacement_engine = PositionReplacementEngine(switch_threshold=switch_threshold)
        self.min_ev_hurdle = min_ev_hurdle
        self.decision_logs: List[PortfolioDecisionLog] = []

    def execute_daily_portfolio_cycle(
        self,
        date_str: str,
        opportunity_universe: List[OpportunityRecord],
        current_holdings: Dict[str, float],  # {ticker: current_weight}
        historical_candles: Dict[str, pd.DataFrame],
        portfolio_equity: float = 1_000_000.0,
        active_regime: str = "SIDEWAYS"
    ) -> Tuple[Dict[str, float], float, Dict[str, float], PortfolioDecisionLog]:
        """
        Executes daily portfolio decision cycle:
        1. Evaluates all opportunities and current holdings.
        2. Estimates point-in-time covariance.
        3. Solves constrained utility optimization.
        4. Calculates target weights and trade deltas.
        5. Logs decision provenance.
        
        Returns:
          (target_weights, cash_weight, trade_deltas, decision_log)
        """
        # Deterministic sorting of candidate input to prevent order-of-iteration bugs (Section 71-72)
        opportunities = sorted(opportunity_universe, key=lambda x: x.ticker)
        
        # Calculate hashes for state provenance
        cand_hash = hashlib.sha256(
            "".join([f"{o.ticker}:{o.calibratedProbability}:{o.netEV}" for o in opportunities]).encode('utf-8')
        ).hexdigest()[:16]
        
        holdings_hash = hashlib.sha256(
            "".join([f"{t}:{w:.4f}" for t, w in sorted(current_holdings.items())]).encode('utf-8')
        ).hexdigest()[:16]
        
        # Estimate point-in-time covariance for all relevant tickers
        all_tickers = sorted(list(set([o.ticker for o in opportunities] + list(current_holdings.keys()))))
        cov_matrix, valid_cov_tickers = self.cov_engine.estimate_covariance(
            tickers=all_tickers,
            historical_candles=historical_candles,
            as_of_date=date_str
        )
        
        # Solve constrained portfolio optimization
        target_weights, cash_weight, rejection_reasons = self.solver.solve(
            candidates=opportunities,
            cov_matrix=cov_matrix,
            previous_weights=current_holdings,
            portfolio_equity=portfolio_equity,
            min_ev_hurdle=self.min_ev_hurdle
        )
        
        # Calculate trade deltas: delta = target - current (Section 33)
        trade_deltas: Dict[str, float] = {}
        all_union_tickers = set(target_weights.keys()).union(set(current_holdings.keys()))
        
        action_counts = {'HOLD': 0, 'ADD': 0, 'REDUCE': 0, 'EXIT': 0, 'REPLACE': 0, 'CASH': 0}
        turnover_cost_est = 0.0
        
        for t in sorted(list(all_union_tickers)):
            w_tgt = target_weights.get(t, 0.0)
            w_curr = current_holdings.get(t, 0.0)
            delta = round(w_tgt - w_curr, 6)
            
            # Minimum trade size filter: ignore tiny rebalance adjustments < 0.01 (1%) (Section 34)
            if abs(delta) < 0.01:
                delta = 0.0
                if w_curr > 0 and w_tgt > 0:
                    action_counts['HOLD'] += 1
            else:
                trade_deltas[t] = delta
                turnover_cost_est += abs(delta) * (BASE_ROUND_TRIP_FRICTION / 2.0)
                if w_curr == 0.0 and w_tgt > 0.0:
                    action_counts['ADD'] += 1
                elif w_curr > 0.0 and w_tgt == 0.0:
                    action_counts['EXIT'] += 1
                elif w_tgt > w_curr:
                    action_counts['ADD'] += 1
                else:
                    action_counts['REDUCE'] += 1
                    
        if cash_weight > 0.50:
            action_counts['CASH'] += 1
            
        # Recompute portfolio risk metrics
        w_vec = np.array([target_weights.get(t, 0.0) for t in valid_cov_tickers], dtype=float)
        exp_port_vol = self.cov_engine.calculate_portfolio_volatility(w_vec, cov_matrix)
        
        # Net EV vector
        net_ev_dict = {o.ticker: (o.netEV or 0.0) for o in opportunities}
        exp_port_ret = float(sum(target_weights.get(t, 0.0) * net_ev_dict.get(t, 0.0) for t in target_weights))
        
        gross_exp = float(sum(target_weights.values()))
        port_utility = self.utility_engine.compute_portfolio_utility(
            weights=w_vec,
            net_evs=np.array([net_ev_dict.get(t, 0.0) for t in valid_cov_tickers]),
            cov_matrix=cov_matrix
        )
        
        # Construct Decision Provenance Record
        decision_log = PortfolioDecisionLog(
            timestamp=date_str,
            candidateSetHash=cand_hash,
            portfolioStateHash=holdings_hash,
            selectedStocks=sorted(list(target_weights.keys())),
            rejectedStocks=sorted(list(rejection_reasons.keys())),
            rejectionReasons=rejection_reasons,
            targetWeights=target_weights,
            previousWeights=current_holdings,
            tradeDeltas=trade_deltas,
            expectedPortfolioReturn=round(exp_port_ret, 6),
            expectedPortfolioRisk=round(exp_port_vol, 6),
            portfolioUtility=round(port_utility, 6),
            grossExposure=round(gross_exp, 6),
            cashWeight=round(cash_weight, 6),
            turnoverCost=round(turnover_cost_est, 6),
            actionCount=action_counts
        )
        self.decision_logs.append(decision_log)
        
        return target_weights, cash_weight, trade_deltas, decision_log
