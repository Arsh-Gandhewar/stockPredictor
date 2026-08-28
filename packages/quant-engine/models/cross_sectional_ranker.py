import os
import sys
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from universe import TICKER_SECTOR_MAP
from quant_governance_config import (
    BASE_ROUND_TRIP_FRICTION,
    MAX_POSITION_WEIGHT,
    MAX_SECTOR_WEIGHT,
    MAX_GROSS_EXPOSURE,
    RISK_PER_TRADE
)
from models.payoff_profile import (
    TradePayoffProfile,
    build_trade_payoff_profile,
    InvalidPayoffError,
    HorizonMismatchError
)

from research.research_partition_guard import OptimizationLeakageError, ResearchPartitionGuard

class EconomicConstraintViolationError(Exception):
    """Raised when a hard portfolio risk constraint is violated."""
    pass

@dataclass
class OpportunityRecord:
    timestamp: str
    ticker: str
    sector: str
    horizon: str
    calibratedProbability: Optional[float]
    probabilityRank: Optional[int]
    expectedGain: Optional[float]
    expectedLoss: Optional[float]
    expectedReturn: Optional[float]
    stopReturn: Optional[float]
    targetReturn: Optional[float]
    expectedValue: Optional[float]
    expectedRisk: Optional[float]
    riskAdjustedExpectedValue: Optional[float]
    ATR: Optional[float]
    volatility: Optional[float]
    beta: Optional[float]
    liquidity: Optional[float]
    ADV: Optional[float]
    participationRate: Optional[float]
    correlationToPortfolio: Optional[float]
    sectorExposureBefore: float
    sectorExposureAfter: float
    grossExposureBefore: float
    grossExposureAfter: float
    turnoverCost: float
    slippageEstimate: float
    tradeEligible: bool
    ineligibilityReason: Optional[str]
    distributionVersion: Optional[str]
    distributionFitStart: Optional[str]
    distributionFitEnd: Optional[str]
    alphaRank: Optional[int] = None
    opportunityScore: Optional[float] = None
    selectionReason: Optional[str] = None
    executionPrice: Optional[float] = None
    sizedNotional: float = 0.0
    universeVersion: Optional[str] = None
    universeHash: Optional[str] = None
    grossEV: Optional[float] = None
    netEV: Optional[float] = None
    riskAdjustedNetEV: Optional[float] = None
    estimatedExecutionCost: float = 0.0013
    p_up: Optional[float] = None
    p_down: Optional[float] = None
    signalTimestamp: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

def compute_historical_correlation(
    ticker_a: str,
    ticker_b: str,
    historical_candles: Dict[str, pd.DataFrame],
    as_of_date: str,
    lookback_days: int = 60
) -> Optional[float]:
    """
    Computes point-in-time rolling 60-day return correlation between two assets.
    Returns None if insufficient data (< 30 matching trading days).
    """
    if ticker_a == ticker_b:
        return 1.0
        
    df_a = historical_candles.get(ticker_a)
    df_b = historical_candles.get(ticker_b)
    
    if df_a is None or df_b is None or df_a.empty or df_b.empty:
        return None
        
    # Filter strictly prior to or equal to as_of_date (Point-in-time)
    sub_a = df_a[df_a.index <= as_of_date].tail(lookback_days + 1)
    sub_b = df_b[df_b.index <= as_of_date].tail(lookback_days + 1)
    
    if len(sub_a) < 30 or len(sub_b) < 30:
        return None
        
    ret_a = sub_a['Close'].pct_change().dropna()
    ret_b = sub_b['Close'].pct_change().dropna()
    
    # Align on common dates
    common_idx = ret_a.index.intersection(ret_b.index)
    if len(common_idx) < 30:
        return None
        
    s_a = ret_a.loc[common_idx]
    s_b = ret_b.loc[common_idx]
    
    std_a = s_a.std()
    std_b = s_b.std()
    if std_a < 1e-8 or std_b < 1e-8:
        return 0.0
        
    corr = float(s_a.corr(s_b))
    return corr if not np.isnan(corr) else 0.0

def build_daily_opportunity_table(
    date_str: str,
    day_signals: pd.DataFrame,
    historical_candles: Dict[str, pd.DataFrame],
    open_positions: List[Dict[str, Any]],
    portfolio_equity: float,
    cash: float,
    horizon_days: int = 5,
    round_trip_cost: float = BASE_ROUND_TRIP_FRICTION,
    minimum_decision_margin: float = 0.0,
    regime: str = 'SIDEWAYS',
    universe_engine: Optional[Any] = None
) -> List[OpportunityRecord]:
    """
    Builds the authoritative Daily Opportunity Table for every available signal on date T.
    Enforces all Section 2, 4, 5, 6, 9 hard eligibility gates and point-in-time properties.
    """
    horizon_str = f"{horizon_days}d"
    opportunities: List[OpportunityRecord] = []
    
    # Current portfolio exposures before new orders
    market_value = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
    total_eq = cash + market_value if (cash + market_value) > 0 else portfolio_equity
    gross_exp_before = market_value / total_eq if total_eq > 0 else 0.0
    
    # Sector breakdown before
    sector_notionals: Dict[str, float] = {}
    for p in open_positions:
        s = p.get('sector', TICKER_SECTOR_MAP.get(p['ticker'], 'UNKNOWN'))
        pos_val = p['notional'] * (p['currentPrice'] / p['entryPrice'])
        sector_notionals[s] = sector_notionals.get(s, 0.0) + pos_val
        
    pit_map = None
    pit_version = getattr(universe_engine, 'universe_version', 'v8.0.0-pit-universe') if universe_engine else None
    if universe_engine is not None:
        pit_recs = universe_engine.get_eligible_securities(date_str, candles_dict=historical_candles)
        pit_map = {r.ticker: r for r in pit_recs}

    for _, sig in day_signals.iterrows():
        ticker = str(sig.get('ticker', 'UNKNOWN'))
        sector = str(sig.get('sector') or TICKER_SECTOR_MAP.get(ticker, 'UNKNOWN'))

        # 0. Point-in-Time Universe Eligibility Gate (Repair #8, Section 20)
        if pit_map is not None:
            pit_rec = pit_map.get(ticker)
            if pit_rec is not None and not pit_rec.eligible:
                rec = OpportunityRecord(
                    timestamp=date_str, ticker=ticker, sector=sector, horizon=horizon_str,
                    calibratedProbability=None, probabilityRank=None, expectedGain=None, expectedLoss=None,
                    expectedReturn=None, stopReturn=None, targetReturn=None, expectedValue=None,
                    expectedRisk=None, riskAdjustedExpectedValue=None, ATR=None, volatility=None, beta=None,
                    liquidity=None, ADV=None, participationRate=None, correlationToPortfolio=None,
                    sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                    sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                    grossExposureBefore=gross_exp_before, grossExposureAfter=gross_exp_before,
                    turnoverCost=round_trip_cost, slippageEstimate=0.0005, tradeEligible=False,
                    ineligibilityReason=pit_rec.eligibilityReason, distributionVersion=None,
                    distributionFitStart=None, distributionFitEnd=None,
                    universeVersion=pit_version, universeHash=pit_rec.universeHash
                )
                opportunities.append(rec)
                continue
        
        # 1. Probability Gate
        prob_val = sig.get('calibratedProbability', sig.get('pred_prob'))
        if prob_val is None or pd.isna(prob_val) or float(prob_val) <= 0.0 or float(prob_val) >= 1.0:
            rec = OpportunityRecord(
                timestamp=date_str, ticker=ticker, sector=sector, horizon=horizon_str,
                calibratedProbability=None, probabilityRank=None, expectedGain=None, expectedLoss=None,
                expectedReturn=None, stopReturn=None, targetReturn=None, expectedValue=None,
                expectedRisk=None, riskAdjustedExpectedValue=None, ATR=None, volatility=None, beta=None,
                liquidity=None, ADV=None, participationRate=None, correlationToPortfolio=None,
                sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                grossExposureBefore=gross_exp_before, grossExposureAfter=gross_exp_before,
                turnoverCost=round_trip_cost, slippageEstimate=0.0005, tradeEligible=False,
                ineligibilityReason='INVALID_PROBABILITY', distributionVersion=None,
                distributionFitStart=None, distributionFitEnd=None
            )
            opportunities.append(rec)
            continue
            
        p_up = float(prob_val)
        p_down = 1.0 - p_up
        
        # Check returnEstimateMethod
        if sig.get('returnEstimateMethod') == 'INSUFFICIENT_DATA':
            rec = OpportunityRecord(
                timestamp=date_str, ticker=ticker, sector=sector, horizon=horizon_str,
                calibratedProbability=p_up, probabilityRank=None, expectedGain=None, expectedLoss=None,
                expectedReturn=None, stopReturn=None, targetReturn=None, expectedValue=None,
                expectedRisk=None, riskAdjustedExpectedValue=None, ATR=None, volatility=None, beta=None,
                liquidity=None, ADV=None, participationRate=None, correlationToPortfolio=None,
                sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                grossExposureBefore=gross_exp_before, grossExposureAfter=gross_exp_before,
                turnoverCost=round_trip_cost, slippageEstimate=0.0005, tradeEligible=False,
                ineligibilityReason='INSUFFICIENT_RISK_DATA', distributionVersion=None,
                distributionFitStart=None, distributionFitEnd=None
            )
            opportunities.append(rec)
            continue
            
        # 2. Payoff Profile Gate (Section 3 & 9)
        try:
            profile = build_trade_payoff_profile(sig, trade_horizon=horizon_str)
        except HorizonMismatchError as e:
            rec = OpportunityRecord(
                timestamp=date_str, ticker=ticker, sector=sector, horizon=horizon_str,
                calibratedProbability=p_up, probabilityRank=None, expectedGain=None, expectedLoss=None,
                expectedReturn=None, stopReturn=None, targetReturn=None, expectedValue=None,
                expectedRisk=None, riskAdjustedExpectedValue=None, ATR=None, volatility=None, beta=None,
                liquidity=None, ADV=None, participationRate=None, correlationToPortfolio=None,
                sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                grossExposureBefore=gross_exp_before, grossExposureAfter=gross_exp_before,
                turnoverCost=round_trip_cost, slippageEstimate=0.0005, tradeEligible=False,
                ineligibilityReason='HORIZON_MISMATCH', distributionVersion=None,
                distributionFitStart=None, distributionFitEnd=None
            )
            opportunities.append(rec)
            continue
        except InvalidPayoffError as e:
            err_msg = str(e)
            reason = 'MISSING_PAYOFF_QUANTILE'
            if 'p85' in err_msg:
                reason = 'MISSING_OR_INVALID_P85'
            elif 'p15' in err_msg:
                reason = 'MISSING_OR_INVALID_P15'
            elif 'gain' in err_msg:
                reason = 'MISSING_EXPECTED_GAIN'
            elif 'loss' in err_msg:
                reason = 'MISSING_EXPECTED_LOSS'
                
            rec = OpportunityRecord(
                timestamp=date_str, ticker=ticker, sector=sector, horizon=horizon_str,
                calibratedProbability=p_up, probabilityRank=None, expectedGain=None, expectedLoss=None,
                expectedReturn=None, stopReturn=None, targetReturn=None, expectedValue=None,
                expectedRisk=None, riskAdjustedExpectedValue=None, ATR=None, volatility=None, beta=None,
                liquidity=None, ADV=None, participationRate=None, correlationToPortfolio=None,
                sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                grossExposureBefore=gross_exp_before, grossExposureAfter=gross_exp_before,
                turnoverCost=round_trip_cost, slippageEstimate=0.0005, tradeEligible=False,
                ineligibilityReason=reason, distributionVersion=None,
                distributionFitStart=None, distributionFitEnd=None
            )
            opportunities.append(rec)
            continue
            
        # 3. Provenance Causal Check (Hard Invariant)
        fit_end = profile.fitEnd
        if fit_end and str(fit_end)[:10] >= str(date_str)[:10]:
            raise ValueError(f"CRITICAL CAUSAL LEAKAGE: distributionFitEnd {fit_end} >= signalDate {date_str}")
            
        # 4. Execution Price Check
        candles_df = historical_candles.get(ticker) if historical_candles else None
        exec_price = None
        if candles_df is not None and 'Open' in candles_df.columns and date_str in candles_df.index and not pd.isna(candles_df.loc[date_str]['Open']):
            exec_price = float(candles_df.loc[date_str]['Open'])
        elif 'Open' in sig and sig['Open'] is not None and not pd.isna(sig['Open']) and float(sig['Open']) > 0:
            exec_price = float(sig['Open'])
            
        if exec_price is None or exec_price <= 0:
            rec = OpportunityRecord(
                timestamp=date_str, ticker=ticker, sector=sector, horizon=horizon_str,
                calibratedProbability=p_up, probabilityRank=None, expectedGain=profile.expectedGain,
                expectedLoss=profile.expectedLoss, expectedReturn=profile.p50, stopReturn=profile.stopReturn,
                targetReturn=profile.targetReturn, expectedValue=None, expectedRisk=None,
                riskAdjustedExpectedValue=None, ATR=None, volatility=None, beta=None, liquidity=None,
                ADV=None, participationRate=None, correlationToPortfolio=None,
                sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                grossExposureBefore=gross_exp_before, grossExposureAfter=gross_exp_before,
                turnoverCost=round_trip_cost, slippageEstimate=0.0005, tradeEligible=False,
                ineligibilityReason='MISSING_EXECUTION_PRICE', distributionVersion=profile.distributionVersion,
                distributionFitStart=profile.fitStart, distributionFitEnd=profile.fitEnd
            )
            opportunities.append(rec)
            continue
            
        # 5. Risk Calculation (Section 4)
        atr_val = sig.get('atr_percent')
        if atr_val is None or pd.isna(atr_val) or float(atr_val) <= 0:
            rec = OpportunityRecord(
                timestamp=date_str, ticker=ticker, sector=sector, horizon=horizon_str,
                calibratedProbability=p_up, probabilityRank=None, expectedGain=profile.expectedGain,
                expectedLoss=profile.expectedLoss, expectedReturn=profile.p50, stopReturn=profile.stopReturn,
                targetReturn=profile.targetReturn, expectedValue=None, expectedRisk=None,
                riskAdjustedExpectedValue=None, ATR=None, volatility=None, beta=None,
                liquidity=None, ADV=None, participationRate=None, correlationToPortfolio=None,
                sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                grossExposureBefore=gross_exp_before, grossExposureAfter=gross_exp_before,
                turnoverCost=round_trip_cost, slippageEstimate=0.0005, tradeEligible=False,
                ineligibilityReason='INSUFFICIENT_RISK_DATA', distributionVersion=profile.distributionVersion,
                distributionFitStart=profile.fitStart, distributionFitEnd=profile.fitEnd
            )
            opportunities.append(rec)
            continue
            
        vol_val = sig.get('annualized_volatility') or atr_val
        beta_val = sig.get('beta_nifty', 1.0)
        
        # Risk must be real downside information: stopReturn magnitude or downside deviation
        expected_risk = max(0.005, abs(profile.stopReturn))
        if 'missingRisk' in sig and sig['missingRisk']:
            expected_risk = None
            
        if expected_risk is None or expected_risk <= 0:
            rec = OpportunityRecord(
                timestamp=date_str, ticker=ticker, sector=sector, horizon=horizon_str,
                calibratedProbability=p_up, probabilityRank=None, expectedGain=profile.expectedGain,
                expectedLoss=profile.expectedLoss, expectedReturn=profile.p50, stopReturn=profile.stopReturn,
                targetReturn=profile.targetReturn, expectedValue=None, expectedRisk=None,
                riskAdjustedExpectedValue=None, ATR=float(atr_val) if atr_val else None,
                volatility=float(vol_val) if vol_val else None, beta=float(beta_val) if beta_val else None,
                liquidity=None, ADV=None, participationRate=None, correlationToPortfolio=None,
                sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
                grossExposureBefore=gross_exp_before, grossExposureAfter=gross_exp_before,
                turnoverCost=round_trip_cost, slippageEstimate=0.0005, tradeEligible=False,
                ineligibilityReason='INSUFFICIENT_RISK_DATA', distributionVersion=profile.distributionVersion,
                distributionFitStart=profile.fitStart, distributionFitEnd=profile.fitEnd
            )
            opportunities.append(rec)
            continue
            
        # 6. Expected Value Calculation (Section 3 & 5)
        ev_before_cost = (p_up * profile.expectedGain) - (p_down * profile.expectedLoss)
        ev_after_cost = ev_before_cost - round_trip_cost
        risk_adj_ev = ev_after_cost / expected_risk
        
        # 7. Liquidity Check (Section 9)
        adv_shares = float(sig.get('Volume', sig.get('adv_20', 100000.0)) or 100000.0)
        adv_val = adv_shares * exec_price
        
        is_insufficient_liquidity = bool(sig.get('insufficientLiquidity', False) or adv_val < 500000.0)
        
        # 8. Portfolio Correlation Check (Section 16)
        max_corr_to_portfolio = 0.0
        if open_positions and historical_candles:
            corr_list = []
            for p in open_positions:
                c = compute_historical_correlation(ticker, p['ticker'], historical_candles, date_str)
                if c is not None:
                    corr_list.append(c)
            if corr_list:
                max_corr_to_portfolio = max(corr_list)
                
        # Check eligibility against minimum margin
        is_eligible = True
        inelig_reason = None
        
        if is_insufficient_liquidity:
            is_eligible = False
            inelig_reason = 'INSUFFICIENT_LIQUIDITY'
        elif ev_after_cost <= minimum_decision_margin or risk_adj_ev <= 0:
            is_eligible = False
            inelig_reason = 'INSUFFICIENT_EDGE' if ev_after_cost <= 0 else 'INSUFFICIENT_DECISION_MARGIN'
            
        rec = OpportunityRecord(
            timestamp=date_str,
            ticker=ticker,
            sector=sector,
            horizon=horizon_str,
            calibratedProbability=p_up,
            probabilityRank=None,
            expectedGain=profile.expectedGain,
            expectedLoss=profile.expectedLoss,
            expectedReturn=profile.p50,
            stopReturn=profile.stopReturn,
            targetReturn=profile.targetReturn,
            expectedValue=ev_after_cost,
            expectedRisk=expected_risk,
            riskAdjustedExpectedValue=risk_adj_ev,
            ATR=float(atr_val) if atr_val else None,
            volatility=float(vol_val) if vol_val else None,
            beta=float(beta_val) if beta_val else None,
            liquidity=adv_val,
            ADV=adv_shares,
            participationRate=0.01,
            correlationToPortfolio=max_corr_to_portfolio,
            sectorExposureBefore=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
            sectorExposureAfter=sector_notionals.get(sector, 0.0) / total_eq if total_eq > 0 else 0.0,
            grossExposureBefore=gross_exp_before,
            grossExposureAfter=gross_exp_before,
            turnoverCost=round_trip_cost,
            slippageEstimate=0.0005,
            tradeEligible=is_eligible,
            ineligibilityReason=inelig_reason,
            distributionVersion=profile.distributionVersion,
            distributionFitStart=profile.fitStart,
            distributionFitEnd=profile.fitEnd,
            executionPrice=exec_price,
            grossEV=ev_before_cost,
            netEV=ev_after_cost,
            riskAdjustedNetEV=risk_adj_ev,
            estimatedExecutionCost=round_trip_cost,
            p_up=p_up,
            p_down=p_down,
            signalTimestamp=date_str
        )
        opportunities.append(rec)
        
    # Assign cross-sectional probability ranks and alpha ranks
    if opportunities:
        # Probability rank (all candidates with valid probability)
        valid_prob = [o for o in opportunities if o.calibratedProbability is not None]
        valid_prob.sort(key=lambda x: x.calibratedProbability or 0.0, reverse=True)
        for rank, o in enumerate(valid_prob, 1):
            o.probabilityRank = rank
            
        # Alpha rank & Opportunity Score (all eligible candidates)
        eligible = [o for o in opportunities if o.tradeEligible and o.riskAdjustedExpectedValue is not None]
        
        # Opportunity score incorporates riskAdjustedEV and correlation penalty
        for o in eligible:
            corr_penalty = 1.0 - (0.3 * max(0.0, o.correlationToPortfolio or 0.0))
            regime_mult = 1.0
            if regime == 'BEAR':
                regime_mult = 0.6
            elif regime == 'HIGH_VOLATILITY':
                regime_mult = 0.8
            o.opportunityScore = (o.riskAdjustedExpectedValue or 0.0) * corr_penalty * regime_mult
            
        eligible.sort(key=lambda x: x.opportunityScore or 0.0, reverse=True)
        for rank, o in enumerate(eligible, 1):
            o.alphaRank = rank
            
    return opportunities

def select_and_allocate_portfolio(
    opportunities: List[OpportunityRecord],
    open_positions: List[Dict[str, Any]],
    portfolio_equity: float,
    available_cash: float,
    historical_candles: Dict[str, pd.DataFrame],
    as_of_date: str,
    top_n: int = 3,
    risk_per_trade: float = RISK_PER_TRADE,
    max_position_weight: float = MAX_POSITION_WEIGHT,
    max_sector_weight: float = MAX_SECTOR_WEIGHT,
    max_gross_exposure: float = MAX_GROSS_EXPOSURE,
    max_cluster_exposure: float = 0.50,
    round_trip_cost: float = BASE_ROUND_TRIP_FRICTION,
    allocation_mode: str = 'DEFAULT',
    portfolio_optimizer: Optional[Any] = None
) -> Tuple[List[OpportunityRecord], List[OpportunityRecord]]:
    """
    Selects Top-N opportunities and computes risk-budgeted, exposure-capped capital allocation.
    Returns:
    (selected_orders, rejected_opportunities)
    """
    total_eq = portfolio_equity if portfolio_equity > 0 else 1_000_000.0
    
    if allocation_mode in ['CONSTRAINED_OPTIMIZER', 'PRODUCTION_PORTFOLIO_OPTIMIZER']:
        from portfolio.portfolio_optimizer import PortfolioOptimizer
        opt = portfolio_optimizer or PortfolioOptimizer(
            max_pos_weight=max_position_weight,
            max_sec_weight=max_sector_weight,
            max_cluster_exp=max_cluster_exposure,
            max_gross_exp=max_gross_exposure
        )
        current_holdings = {}
        for p in open_positions:
            pval = p['notional'] * (p['currentPrice'] / p['entryPrice'])
            current_holdings[p['ticker']] = pval / total_eq if total_eq > 0 else 0.0
            
        target_weights, cash_w, trade_deltas, decision_log = opt.execute_daily_portfolio_cycle(
            date_str=as_of_date,
            opportunity_universe=opportunities,
            current_holdings=current_holdings,
            historical_candles=historical_candles,
            portfolio_equity=total_eq
        )
        
        selected_orders: List[OpportunityRecord] = []
        rejected: List[OpportunityRecord] = []
        
        for cand in opportunities:
            if cand.ticker in target_weights and target_weights[cand.ticker] > 0:
                tgt_w = target_weights[cand.ticker]
                curr_w = current_holdings.get(cand.ticker, 0.0)
                delta_w = max(0.0, tgt_w - curr_w)
                if delta_w > 0.01 and not any(p['ticker'] == cand.ticker for p in open_positions):
                    sized_notional = min(delta_w * total_eq, available_cash)
                    if sized_notional > 0:
                        cand.sizedNotional = sized_notional
                        cand.targetWeight = tgt_w
                        cand.selectionReason = f"OPTIMIZER_TARGET_WEIGHT_{tgt_w:.4f}"
                        cand.tradeEligible = True
                        selected_orders.append(cand)
                    else:
                        cand.tradeEligible = False
                        cand.ineligibilityReason = 'INSUFFICIENT_CASH'
                        rejected.append(cand)
                elif any(p['ticker'] == cand.ticker for p in open_positions):
                    cand.tradeEligible = False
                    cand.ineligibilityReason = 'ALREADY_IN_PORTFOLIO'
                    rejected.append(cand)
            elif not cand.tradeEligible:
                rejected.append(cand)
            else:
                cand.tradeEligible = False
                cand.ineligibilityReason = decision_log.rejectionReasons.get(cand.ticker, 'OPTIMIZER_ZERO_WEIGHT')
                rejected.append(cand)
                
        return selected_orders, rejected

    eligible_cands = [o for o in opportunities if o.tradeEligible and o.alphaRank is not None]
    eligible_cands.sort(key=lambda x: x.alphaRank or 9999)
    
    selected_orders: List[OpportunityRecord] = []
    rejected: List[OpportunityRecord] = [o for o in opportunities if not o.tradeEligible]
    
    current_cash = available_cash
    
    # Calculate current sector & gross exposures
    total_eq = portfolio_equity if portfolio_equity > 0 else 1_000_000.0
    current_market_val = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
    
    current_sectors: Dict[str, float] = {}
    for p in open_positions:
        s = p.get('sector', TICKER_SECTOR_MAP.get(p['ticker'], 'UNKNOWN'))
        pval = p['notional'] * (p['currentPrice'] / p['entryPrice'])
        current_sectors[s] = current_sectors.get(s, 0.0) + pval
        
    for cand in eligible_cands:
        # Check Top-N cutoff (Section 10)
        if len(selected_orders) >= top_n:
            cand.tradeEligible = False
            cand.ineligibilityReason = f'BEYOND_TOP_{top_n}_CUTOFF'
            rejected.append(cand)
            continue
            
        # Check already open ticker
        if any(p['ticker'] == cand.ticker for p in open_positions):
            cand.tradeEligible = False
            cand.ineligibilityReason = 'ALREADY_IN_PORTFOLIO'
            rejected.append(cand)
            continue
            
        # Sizing from Risk Budget (Section 11)
        stop_dist = max(0.005, abs(cand.stopReturn or 0.02))
        risk_budget = total_eq * risk_per_trade
        raw_notional = risk_budget / stop_dist
        max_notional_pos = total_eq * max_position_weight
        ideal_notional = min(raw_notional, max_notional_pos)
        
        # Check Gross Exposure Cap (100%) (Section 15)
        projected_gross = (current_market_val + ideal_notional) / total_eq
        if projected_gross > max_gross_exposure:
            cand.tradeEligible = False
            cand.ineligibilityReason = 'GROSS_EXPOSURE_LIMIT_EXCEEDED'
            rejected.append(cand)
            continue
            
        # Check Sector Cap (25%) (Section 15)
        projected_sec = (current_sectors.get(cand.sector, 0.0) + ideal_notional) / total_eq
        if projected_sec > max_sector_weight:
            cand.tradeEligible = False
            cand.ineligibilityReason = 'SECTOR_EXPOSURE_LIMIT_EXCEEDED'
            rejected.append(cand)
            continue
            
        sized_notional = min(ideal_notional, max(0.0, current_cash))
        entry_friction = sized_notional * (round_trip_cost / 2.0)
        
        # Check if cash sufficient
        if sized_notional <= 0 or current_cash < (sized_notional + entry_friction):
            cand.tradeEligible = False
            cand.ineligibilityReason = 'INSUFFICIENT_CASH'
            rejected.append(cand)
            continue
            
        # Check Correlated Cluster Exposure (50%) (Section 16)
        cluster_notional = sized_notional
        for p in open_positions:
            corr = compute_historical_correlation(cand.ticker, p['ticker'], historical_candles, as_of_date)
            if corr is not None and corr >= 0.75:
                pos_val = p['notional'] * (p['currentPrice'] / p['entryPrice'])
                cluster_notional += pos_val
                
        if (cluster_notional / total_eq) > max_cluster_exposure:
            cand.tradeEligible = False
            cand.ineligibilityReason = 'CORRELATED_CLUSTER_LIMIT_EXCEEDED'
            rejected.append(cand)
            continue
            
        # Candidate approved
        cand.sizedNotional = sized_notional
        cand.sectorExposureBefore = current_sectors.get(cand.sector, 0.0) / total_eq
        cand.sectorExposureAfter = projected_sec
        cand.grossExposureBefore = current_market_val / total_eq
        cand.grossExposureAfter = projected_gross
        cand.selectionReason = f"ALPHA_RANK_{cand.alphaRank}_SELECTED_TOP_{top_n}"
        
        # Update running state
        current_cash -= (sized_notional + entry_friction)
        current_market_val += sized_notional
        current_sectors[cand.sector] = current_sectors.get(cand.sector, 0.0) + sized_notional
        selected_orders.append(cand)
        
    return selected_orders, rejected

def rank_cross_sectional_opportunities(
    predictions_df: pd.DataFrame,
    top_n: int = 3,
    min_ev_hurdle: float = 0.002,
    regime_filter_enabled: bool = True,
    benchmark_regimes_df: Optional[pd.DataFrame] = None
) -> pd.DataFrame:
    """
    Backward-compatible ranking function for experiment registry scripts.
    Ranks daily universe predictions cross-sectionally by Risk-Adjusted Net Expected Value.
    Selects Top-N opportunities per trading date.
    """
    df = predictions_df.copy()
    if df.empty:
        return df
        
    if benchmark_regimes_df is not None and not benchmark_regimes_df.empty:
        regime_map = {str(d)[:10]: r for d, r in zip(benchmark_regimes_df.index, benchmark_regimes_df['market_regime'])}
        df['market_regime'] = [regime_map.get(str(d)[:10], 'SIDEWAYS') for d in df['predictionTimestamp']]
    else:
        df['market_regime'] = 'SIDEWAYS'
        
    scored_records = []
    
    for idx, row in df.iterrows():
        prob_val = row.get('calibratedProbability', row.get('pred_prob'))
        if prob_val is None or pd.isna(prob_val):
            continue
        p_up = float(prob_val)
        p_down = 1.0 - p_up
        
        try:
            profile = build_trade_payoff_profile(row.to_dict(), trade_horizon='5d')
            e_gain = profile.expectedGain
            e_loss = profile.expectedLoss
            stop_ret = profile.stopReturn
        except Exception:
            e_gain_raw = row.get('conditional_gain')
            e_loss_raw = row.get('conditional_loss')
            if e_gain_raw is None or e_loss_raw is None or pd.isna(e_gain_raw) or pd.isna(e_loss_raw):
                continue
            e_gain = float(e_gain_raw)
            e_loss = float(e_loss_raw)
            stop_ret = -0.025
            
        gross_ev = (p_up * e_gain) - (p_down * e_loss)
        net_ev = gross_ev - BASE_ROUND_TRIP_FRICTION
        exp_risk = max(0.005, abs(stop_ret))
        risk_adj_ev = net_ev / exp_risk
        
        regime = row.get('market_regime', 'SIDEWAYS')
        if regime_filter_enabled:
            if regime == 'BEAR':
                net_ev -= 0.005
                risk_adj_ev = net_ev / exp_risk
            elif regime == 'HIGH_VOLATILITY':
                net_ev -= 0.003
                risk_adj_ev = net_ev / exp_risk
                
        rec = row.to_dict()
        rec['gross_ev'] = gross_ev
        rec['net_ev'] = net_ev
        rec['expectedValue'] = net_ev
        rec['risk_adj_ev'] = risk_adj_ev
        rec['riskAdjustedExpectedValue'] = risk_adj_ev
        rec['alpha_score'] = risk_adj_ev
        rec['is_ev_eligible'] = bool(net_ev >= min_ev_hurdle and risk_adj_ev > 0)
        scored_records.append(rec)
        
    if not scored_records:
        return pd.DataFrame()
        
    df_scored = pd.DataFrame(scored_records)
    selected_dfs = []
    for dt, group in df_scored.groupby('predictionTimestamp'):
        eligible = group[group['is_ev_eligible']].copy()
        if not eligible.empty:
            eligible.sort_values(by='risk_adj_ev', ascending=False, inplace=True)
            top = eligible.head(top_n)
            selected_dfs.append(top)
            
    if selected_dfs:
        df_final = pd.concat(selected_dfs, axis=0)
        df_final.sort_index(inplace=True)
        return df_final
    else:
        return pd.DataFrame()
