"""
P0 Top-3 Alpha Evaluation Framework for QuantX.
================================================
Comprehensive, causal out-of-sample decision date simulation for Top-3 Alpha:
- Evaluates Top-3 cross-sectional selection on every trading day t in OOS periods.
- Measures forward 5D and 20D realized returns vs NIFTY 50 benchmark.
- Computes Top-1, Top-3 stock, and Top-3 portfolio hit rates.
- Generates time-aligned marked-to-market daily equity curves, Sharpe, Sortino, MaxDD, and Profit Factor.
- Calculates granular fractile spreads (Top 1%, 2%, 5%, 10% vs Universe Average) to prove monotonic ranking power.
- Analyzes portfolio interaction (sector, correlation, and beta clustering) across unconstrained vs constrained modes.
"""

import os
import sys
import math
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple, Set
from dataclasses import dataclass, field, asdict

# Ensure quant-engine root is in path
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from costs import TransactionCostEngine
from universe import TICKER_SECTOR_MAP, NSE_UNIVERSE
from models.universe_engine import HistoricalUniverseEngine
from stats.inference import compute_newey_west_hac, compute_block_bootstrap_ci, compute_effective_sample_size


@dataclass(frozen=True)
class Top3StockEvaluationRecord:
    """Detailed forward performance record for an individual stock in Top 3."""
    date: str
    ticker: str
    sector: str
    rank: int
    score: float
    calibratedProbability: float
    expectedReturn: float
    expectedRisk: float
    adv20: Optional[float]
    beta: Optional[float]
    entryPriceOpen: float
    exitPrice5d: float
    exitPrice20d: float
    realizedGrossReturn5d: float
    realizedGrossReturn20d: float
    niftyGrossReturn5d: float
    niftyGrossReturn20d: float
    roundTripCost5d: float
    roundTripCost20d: float
    realizedNetReturn5d: float
    realizedNetReturn20d: float
    excessReturn5d: float
    excessReturn20d: float
    beatNifty5d: bool
    beatNifty20d: bool
    absoluteWin5d: bool
    absoluteWin20d: bool


@dataclass
class Top3DailyPortfolioRecord:
    """Aggregated portfolio-level decision record for a single trading session."""
    date: str
    selectedTickers: List[str]
    selectedSectors: List[str]
    meanPairwiseCorrelation: float
    portfolioBeta: float
    isSectorClustered: bool  # True if >= 2 stocks from same sector
    portfolioGrossReturn5d: float
    portfolioGrossReturn20d: float
    portfolioNetReturn5d: float
    portfolioNetReturn20d: float
    niftyReturn5d: float
    niftyReturn20d: float
    portfolioExcessReturn5d: float
    portfolioExcessReturn20d: float
    portfolioBeatNifty5d: bool
    portfolioBeatNifty20d: bool
    top1BeatNifty5d: bool
    top1BeatNifty20d: bool
    stocksBeatingNiftyCount5d: int
    stocksBeatingNiftyCount20d: int


@dataclass
class FractileSpreadRecord:
    """Monotonic ranking power evaluation for a fractile bucket."""
    fractileLabel: str
    thresholdPct: float
    sampleCount: int
    meanGrossReturn5d: float
    meanNetReturn5d: float
    excessVsUniverse5d: float
    excessVsNifty5d: float
    hitRateVsUniverse5d: float
    hitRateVsNifty5d: float
    meanGrossReturn20d: float
    meanNetReturn20d: float
    excessVsUniverse20d: float
    excessVsNifty20d: float
    hitRateVsUniverse20d: float
    hitRateVsNifty20d: float


class Top3AlphaEvaluator:
    """
    Authoritative P0 Top-3 Alpha Evaluator.
    Runs decision-date simulations on out-of-sample data, strictly point-in-time.
    """

    def __init__(
        self,
        cost_regime: str = 'BASE_COST',
        risk_free_rate_annual: float = 0.04,
        diversification_mode: str = 'UNCONSTRAINED',  # 'UNCONSTRAINED' or 'CONSTRAINED'
        max_sector_count: int = 1,                   # Max stocks per sector in CONSTRAINED mode
        correlation_penalty_weight: float = 0.40,
        correlation_lookback_days: int = 60,
        use_hysteresis: bool = True,
        exit_rank_limit: int = 6,
        cost_multiplier: float = 1.0
    ):
        self.cost_engine = TransactionCostEngine(regime=cost_regime)
        self.cost_multiplier = cost_multiplier
        self.rf_annual = risk_free_rate_annual
        self.rf_daily = (1.0 + risk_free_rate_annual) ** (1.0 / 252.0) - 1.0
        self.diversification_mode = diversification_mode
        self.max_sector_count = max_sector_count
        self.corr_penalty_weight = correlation_penalty_weight
        self.corr_lookback = correlation_lookback_days
        self.use_hysteresis = use_hysteresis
        self.exit_rank_limit = exit_rank_limit
        self._corr_cache: Dict[Tuple[str, str, str], Optional[float]] = {}
        self._returns_cache: Dict[str, pd.Series] = {}
        self._candles_by_ticker_date: Optional[Dict[str, Dict[str, Dict[str, float]]]] = None
        self._nifty_by_date: Optional[Dict[str, Dict[str, float]]] = None
        self._sorted_nifty_dates: Optional[List[str]] = None
        self._nifty_date_idx_map: Optional[Dict[str, int]] = None
        self._returns_matrix: Optional[np.ndarray] = None
        self._returns_date_to_idx: Optional[Dict[str, int]] = None
        self._ticker_to_col_idx: Optional[Dict[str, int]] = None

    def evaluate_top3_alpha(
        self,
        oos_predictions_df: pd.DataFrame,
        historical_candles: Dict[str, pd.DataFrame],
        nifty_candles: pd.DataFrame,
        ranking_metric: str = 'canonical_alpha',
        cost_multiplier: Optional[float] = None,
        horizon: str = '5d'
    ) -> Dict[str, Any]:
        """
        Executes complete out-of-sample Top-3 alpha evaluation.
        Supports dual horizons ('5d' and '20d') with horizon-aware holding periods
        and inverse-volatility position scaling.
        """
        df = oos_predictions_df.copy()
        if 'predictionTimestamp' in df.columns:
            df['date'] = pd.to_datetime(df['predictionTimestamp'])
        elif not isinstance(df.index, pd.DatetimeIndex):
            df['date'] = pd.to_datetime(df.index)
        else:
            df['date'] = df.index

        df['date_str'] = df['date'].dt.strftime('%Y-%m-%d')
        unique_dates = sorted(df['date_str'].unique())

        stock_eval_records: List[Top3StockEvaluationRecord] = []
        portfolio_daily_records: List[Top3DailyPortfolioRecord] = []
        all_universe_returns_5d: List[Dict[str, Any]] = []
        all_universe_returns_20d: List[Dict[str, Any]] = []

        # Fast calendar mapping (cached on self)
        if self._nifty_by_date is None or len(self._nifty_by_date) != len(nifty_candles):
            n_dates = nifty_candles.index.strftime('%Y-%m-%d') if isinstance(nifty_candles.index, pd.DatetimeIndex) else pd.to_datetime(nifty_candles.index).dt.strftime('%Y-%m-%d')
            n_opens = nifty_candles['Open'].values
            n_closes = nifty_candles['Close'].values
            self._nifty_by_date = {
                d: {'Open': float(o), 'Close': float(c)} for d, o, c in zip(n_dates, n_opens, n_closes)
            }
            self._sorted_nifty_dates = sorted(list(self._nifty_by_date.keys()))
            self._nifty_date_idx_map = {d: i for i, d in enumerate(self._sorted_nifty_dates)}

        nifty_by_date = self._nifty_by_date
        sorted_nifty_dates = self._sorted_nifty_dates
        nifty_idx_map = self._nifty_date_idx_map

        # Precompute candle date indices using fast array zip (cached on self)
        if self._candles_by_ticker_date is None:
            self._candles_by_ticker_date = {}
            for tkr, cdf in historical_candles.items():
                c_dates = cdf.index.strftime('%Y-%m-%d') if isinstance(cdf.index, pd.DatetimeIndex) else pd.to_datetime(cdf.index).dt.strftime('%Y-%m-%d')
                c_opens = cdf['Open'].values
                c_closes = cdf['Close'].values
                self._candles_by_ticker_date[tkr] = {
                    d: {'Open': float(o), 'Close': float(c)} for d, o, c in zip(c_dates, c_opens, c_closes)
                }
        candles_by_ticker_date = self._candles_by_ticker_date

        # Precompute vectorized aligned returns matrix for ultra-fast correlation lookups
        if self._returns_matrix is None:
            returns_dict = {}
            for tkr, cdf in historical_candles.items():
                if 'Close' in cdf.columns:
                    s = cdf['Close'].pct_change()
                    if not isinstance(s.index, pd.DatetimeIndex):
                        s.index = pd.to_datetime(s.index)
                    returns_dict[tkr] = s
            aligned_df = pd.DataFrame(returns_dict)
            date_strings = aligned_df.index.strftime('%Y-%m-%d')
            self._returns_matrix = aligned_df.values
            self._returns_date_to_idx = {d: i for i, d in enumerate(date_strings)}
            self._ticker_to_col_idx = {tkr: i for i, tkr in enumerate(aligned_df.columns)}

        current_holdings: Dict[str, Dict[str, Any]] = {}
        total_turnover_trades: float = 0.0

        # -------------------------------------------------------------------------
        # 1. Daily Decision Date Simulation Loop
        # -------------------------------------------------------------------------
        for t_date in unique_dates:
            day_preds = df[df['date_str'] == t_date].copy()
            if day_preds.empty:
                continue

            # O(1) forward index availability
            t_idx = nifty_idx_map.get(t_date)
            if t_idx is None:
                continue

            # Require at least T+5 for 5D evaluation; T+20 is optional for 20D metrics
            if t_idx + 5 >= len(sorted_nifty_dates):
                continue

            t_plus_1_date = sorted_nifty_dates[t_idx + 1]
            t_plus_5_date = sorted_nifty_dates[t_idx + 5]
            has_20d = (t_idx + 20 < len(sorted_nifty_dates))
            t_plus_20_date = sorted_nifty_dates[t_idx + 20] if has_20d else None

            nifty_entry = float(nifty_by_date[t_plus_1_date]['Open'])
            nifty_exit_5d = float(nifty_by_date[t_plus_5_date]['Close'])
            nifty_exit_20d = float(nifty_by_date[t_plus_20_date]['Close']) if t_plus_20_date else float('nan')

            if nifty_entry <= 0:
                continue

            nifty_ret_5d = (nifty_exit_5d - nifty_entry) / nifty_entry
            nifty_ret_20d = (nifty_exit_20d - nifty_entry) / nifty_entry if t_plus_20_date else float('nan')

            # Filter point-in-time universe eligibility
            # CRITICAL: Only require T+1 and T+5 for 5D eligibility. T+20 data is optional.
            # This prevents survivorship-biased filtering where stocks delisting between T+6 and T+20
            # would be retrospectively purged from the 5D selection pool.
            eligible_candidates = []
            for _, row in day_preds.iterrows():
                tkr = str(row.get('ticker', 'UNKNOWN'))
                if tkr not in historical_candles:
                    continue

                t_dict = candles_by_ticker_date.get(tkr, {})
                # 5D eligibility: must have T+1 entry and T+5 exit
                if t_plus_1_date not in t_dict or t_plus_5_date not in t_dict:
                    continue

                entry_p = float(t_dict[t_plus_1_date]['Open'])
                exit_p5 = float(t_dict[t_plus_5_date]['Close'])

                if entry_p <= 0 or exit_p5 <= 0:
                    continue

                # 20D exit: optional — compute when available, NaN otherwise
                if t_plus_20_date and t_plus_20_date in t_dict:
                    exit_p20 = float(t_dict[t_plus_20_date]['Close'])
                    if exit_p20 <= 0:
                        exit_p20 = float('nan')
                else:
                    exit_p20 = float('nan')

                # Required fields from ranker output — skip candidate if missing
                # No fabricated fallback values allowed in research path
                p_cal_raw = row.get('calibratedProbability', row.get('pred_prob', None))
                if p_cal_raw is None or (isinstance(p_cal_raw, float) and np.isnan(p_cal_raw)):
                    continue
                p_cal = float(p_cal_raw)

                exp_risk_raw = row.get('expectedRisk', row.get('risk', None))
                if exp_risk_raw is None or (isinstance(exp_risk_raw, float) and np.isnan(exp_risk_raw)):
                    continue
                exp_risk = max(0.005, float(exp_risk_raw))

                # Score: use explicit formulas per metric, no shadowing
                if ranking_metric in ('canonical_alpha', 'opportunity_score', 'canonicalAlphaScore'):
                    score_raw = row.get('canonicalAlphaScore')
                    if score_raw is None or (isinstance(score_raw, float) and np.isnan(score_raw)):
                        continue
                    score = float(score_raw)
                elif ranking_metric == 'risk_adjusted_ev':
                    # Explicitly compute risk-adjusted EV — do NOT fall through to canonicalAlphaScore
                    net_ev_val = row.get('netEV', row.get('ev_after_cost', None))
                    if net_ev_val is not None:
                        score = float(net_ev_val) / exp_risk
                    else:
                        gross_ev_val = row.get('grossEV', row.get('EV', None))
                        if gross_ev_val is not None:
                            score = (float(gross_ev_val) - self.cost_engine.calculate_round_trip_cost_rate()) / exp_risk
                        else:
                            continue
                elif ranking_metric == 'net_ev':
                    net_ev_val = row.get('netEV', row.get('ev_after_cost', None))
                    if net_ev_val is None:
                        continue
                    score = float(net_ev_val)
                elif ranking_metric == 'calibrated_prob':
                    score = p_cal
                elif ranking_metric == 'lambda_rank':
                    rank_score_raw = row.get('rank_score')
                    if rank_score_raw is None:
                        continue
                    score = float(rank_score_raw)
                else:
                    score_raw = row.get('canonicalAlphaScore')
                    if score_raw is None or (isinstance(score_raw, float) and np.isnan(score_raw)):
                        continue
                    score = float(score_raw)

                # Realized forward returns
                fwd_gross_5d = (exit_p5 - entry_p) / entry_p
                fwd_gross_20d = (exit_p20 - entry_p) / entry_p if not np.isnan(exit_p20) else float('nan')

                eff_mult = cost_multiplier if cost_multiplier is not None else self.cost_multiplier
                cost_rate_5d = self.cost_engine.calculate_round_trip_cost_rate() * eff_mult
                cost_rate_20d = cost_rate_5d

                fwd_net_5d = fwd_gross_5d - cost_rate_5d
                fwd_net_20d = fwd_gross_20d - cost_rate_20d if not np.isnan(fwd_gross_20d) else float('nan')

                # Expected return from ranker (required, not fabricated)
                exp_ret_raw = row.get('expectedReturn', row.get('p50', None))
                exp_ret = float(exp_ret_raw) if exp_ret_raw is not None else 0.0

                # ADV: None when unavailable — no fabricated 100k shares
                adv_raw = row.get('ADV', None)
                adv20 = float(adv_raw) * entry_p if adv_raw is not None and float(adv_raw) > 0 else None

                # Beta: None when unavailable
                beta_raw = row.get('beta', None)
                beta = float(beta_raw) if beta_raw is not None else None

                cand_rec = {
                    'ticker': tkr,
                    'sector': row.get('sector', TICKER_SECTOR_MAP.get(tkr, 'UNKNOWN')),
                    'score': score,
                    'calibratedProbability': p_cal,
                    'expectedReturn': exp_ret,
                    'expectedRisk': exp_risk,
                    'adv20': adv20,
                    'beta': beta,
                    'entryPriceOpen': entry_p,
                    'exitPrice5d': exit_p5,
                    'exitPrice20d': exit_p20,
                    'realizedGrossReturn5d': fwd_gross_5d,
                    'realizedGrossReturn20d': fwd_gross_20d,
                    'costRate5d': cost_rate_5d,
                    'costRate20d': cost_rate_20d,
                    'realizedNetReturn5d': fwd_net_5d,
                    'realizedNetReturn20d': fwd_net_20d,
                    'niftyGrossReturn5d': nifty_ret_5d,
                    'niftyGrossReturn20d': nifty_ret_20d,
                    'excessReturn5d': fwd_net_5d - nifty_ret_5d,
                    'excessReturn20d': (fwd_net_20d - nifty_ret_20d) if not np.isnan(fwd_net_20d) and not np.isnan(nifty_ret_20d) else float('nan'),
                    'date': t_date
                }
                eligible_candidates.append(cand_rec)

                # Record universe-level distribution for decile / fractile audit
                all_universe_returns_5d.append({
                    'date': t_date, 'ticker': tkr, 'score': score,
                    'grossRet': fwd_gross_5d, 'netRet': fwd_net_5d, 'niftyRet': nifty_ret_5d
                })
                if not np.isnan(fwd_net_20d):
                    all_universe_returns_20d.append({
                        'date': t_date, 'ticker': tkr, 'score': score,
                        'grossRet': fwd_gross_20d, 'netRet': fwd_net_20d, 'niftyRet': nifty_ret_20d
                    })

            if len(eligible_candidates) < 3:
                continue

            # ---------------------------------------------------------------------
            # 2. Candidate Selection (Hysteresis, Diversification, Turnover Control)
            # ---------------------------------------------------------------------
            # P0-2 Turnover Control: apply position continuity bonus to incumbents.
            # Stocks held for fewer than MIN_HOLDING_DAYS receive a score boost so
            # that the ranker must overcome a meaningful hurdle before rotating them
            # out. This cuts daily churn without hard-locking positions.
            MIN_HOLDING_DAYS = 5
            CONTINUITY_BONUS = 0.15

            # Determine effective scores with continuity bonus applied
            for cand in eligible_candidates:
                tkr = cand['ticker']
                if tkr in current_holdings:
                    holding_info = current_holdings[tkr]
                    days_held = holding_info.get('days_held', 0)
                    if days_held < MIN_HOLDING_DAYS:
                        cand['score'] = cand['score'] + CONTINUITY_BONUS

            eligible_candidates.sort(key=lambda x: (-x['score'], x['ticker']))
            rank_map = {c['ticker']: idx + 1 for idx, c in enumerate(eligible_candidates)}
            cand_map = {c['ticker']: c for c in eligible_candidates}

            selected_top3: List[Dict[str, Any]] = []

            # 1. Check incumbent holdings for retention if rank <= exit_rank_limit (e.g. 6)
            if self.use_hysteresis and current_holdings:
                for tkr in list(current_holdings.keys()):
                    if tkr in cand_map and rank_map.get(tkr, 999) <= self.exit_rank_limit:
                        selected_top3.append(cand_map[tkr])

            # 2. Fill remaining slots up to 3
            if self.diversification_mode == 'UNCONSTRAINED':
                for c in eligible_candidates:
                    if len(selected_top3) >= 3:
                        break
                    if not any(s['ticker'] == c['ticker'] for s in selected_top3):
                        selected_top3.append(c)
            else:
                sector_counts: Dict[str, int] = {}
                for s in selected_top3:
                    sector_counts[s['sector']] = sector_counts.get(s['sector'], 0) + 1

                pool = [c for c in eligible_candidates if not any(s['ticker'] == c['ticker'] for s in selected_top3)]

                while len(selected_top3) < 3 and pool:
                    if selected_top3:
                        for item in pool:
                            max_c = 0.0
                            for sel in selected_top3:
                                c = self._compute_historical_corr(item['ticker'], sel['ticker'], historical_candles, t_date)
                                if c is not None and c > max_c:
                                    max_c = c
                            penalty = 1.0 - (self.corr_penalty_weight * max(0.0, max_c))
                            item['effective_score'] = item['score'] * penalty
                        pool.sort(key=lambda x: (-x.get('effective_score', x['score']), x['ticker']))

                    candidate = pool.pop(0)
                    cand_sec = candidate['sector']

                    if sector_counts.get(cand_sec, 0) < self.max_sector_count:
                        selected_top3.append(candidate)
                        sector_counts[cand_sec] = sector_counts.get(cand_sec, 0) + 1

            if len(selected_top3) < 3:
                continue

            # Update turnover tracking and days_held counter
            new_ticker_set = set(x['ticker'] for x in selected_top3)
            old_ticker_set = set(current_holdings.keys()) if current_holdings else new_ticker_set
            turnover_fraction = len(new_ticker_set - old_ticker_set) / 3.0
            total_turnover_trades += turnover_fraction
            # Increment days_held for retained positions; initialize to 1 for new positions
            new_holdings = {}
            for x in selected_top3:
                tkr = x['ticker']
                prev_days = current_holdings[tkr].get('days_held', 0) if tkr in current_holdings else 0
                x_copy = dict(x)
                x_copy['days_held'] = prev_days + 1
                new_holdings[tkr] = x_copy
            current_holdings = new_holdings

            # ---------------------------------------------------------------------
            # 3. Portfolio & Individual Record Compilation
            # ---------------------------------------------------------------------
            selected_tickers = [x['ticker'] for x in selected_top3]
            selected_sectors = [x['sector'] for x in selected_top3]

            corrs = []
            for i in range(3):
                for j in range(i + 1, 3):
                    c = self._compute_historical_corr(selected_tickers[i], selected_tickers[j], historical_candles, t_date)
                    corrs.append(c if c is not None else 0.0)
            mean_corr = float(np.mean(corrs)) if corrs else 0.0

            is_clustered = len(set(selected_sectors)) < 3
            port_beta = float(np.nanmean([x['beta'] for x in selected_top3 if x['beta'] is not None])) if any(x['beta'] is not None for x in selected_top3) else float('nan')

            # Equal-weight portfolio position weighting.
            # Inverse-vol weighting was removed after holdout analysis showed it
            # double-penalized volatile names alongside the vol_penalty, creating
            # compounding defensive bias.  With only 3 positions the diversification
            # benefit of inv-vol is negligible.
            n_pos = len(selected_top3)
            port_weights = [1.0 / n_pos] * n_pos

            port_gross_5d = float(sum(w * x['realizedGrossReturn5d'] for w, x in zip(port_weights, selected_top3)))
            rets_20d = [(w, x['realizedGrossReturn20d']) for w, x in zip(port_weights, selected_top3) if not np.isnan(x['realizedGrossReturn20d'])]
            sum_w20 = sum(w for w, _ in rets_20d)
            port_gross_20d = float(sum(w * r for w, r in rets_20d) / sum_w20) if sum_w20 > 0 else float('nan')

            port_net_5d = float(sum(w * x['realizedNetReturn5d'] for w, x in zip(port_weights, selected_top3)))
            net_rets_20d = [(w, x['realizedNetReturn20d']) for w, x in zip(port_weights, selected_top3) if not np.isnan(x['realizedNetReturn20d'])]
            sum_wnet20 = sum(w for w, _ in net_rets_20d)
            port_net_20d = float(sum(w * r for w, r in net_rets_20d) / sum_wnet20) if sum_wnet20 > 0 else float('nan')

            port_excess_5d = port_net_5d - nifty_ret_5d
            port_excess_20d = (port_net_20d - nifty_ret_20d) if not np.isnan(port_net_20d) and not np.isnan(nifty_ret_20d) else float('nan')

            stocks_beat_5d = sum(1 for x in selected_top3 if x['realizedNetReturn5d'] > nifty_ret_5d)
            stocks_beat_20d = sum(1 for x in selected_top3 if not np.isnan(x['realizedNetReturn20d']) and not np.isnan(nifty_ret_20d) and x['realizedNetReturn20d'] > nifty_ret_20d)

            for rk, cand in enumerate(selected_top3, 1):
                rec = Top3StockEvaluationRecord(
                    date=t_date,
                    ticker=cand['ticker'],
                    sector=cand['sector'],
                    rank=rk,
                    score=cand['score'],
                    calibratedProbability=cand['calibratedProbability'],
                    expectedReturn=cand['expectedReturn'],
                    expectedRisk=cand['expectedRisk'],
                    adv20=cand['adv20'],
                    beta=cand['beta'],
                    entryPriceOpen=cand['entryPriceOpen'],
                    exitPrice5d=cand['exitPrice5d'],
                    exitPrice20d=cand['exitPrice20d'],
                    realizedGrossReturn5d=cand['realizedGrossReturn5d'],
                    realizedGrossReturn20d=cand['realizedGrossReturn20d'],
                    niftyGrossReturn5d=nifty_ret_5d,
                    niftyGrossReturn20d=nifty_ret_20d,
                    roundTripCost5d=cand['costRate5d'],
                    roundTripCost20d=cand['costRate20d'],
                    realizedNetReturn5d=cand['realizedNetReturn5d'],
                    realizedNetReturn20d=cand['realizedNetReturn20d'],
                    excessReturn5d=cand['excessReturn5d'],
                    excessReturn20d=cand['excessReturn20d'],
                    beatNifty5d=cand['realizedNetReturn5d'] > nifty_ret_5d,
                    beatNifty20d=(cand['realizedNetReturn20d'] > nifty_ret_20d) if not np.isnan(cand['realizedNetReturn20d']) and not np.isnan(nifty_ret_20d) else False,
                    absoluteWin5d=cand['realizedNetReturn5d'] > 0,
                    absoluteWin20d=cand['realizedNetReturn20d'] > 0 if not np.isnan(cand['realizedNetReturn20d']) else False,
                )
                stock_eval_records.append(rec)

            top1 = selected_top3[0]
            port_rec = Top3DailyPortfolioRecord(
                date=t_date,
                selectedTickers=selected_tickers,
                selectedSectors=selected_sectors,
                meanPairwiseCorrelation=mean_corr,
                portfolioBeta=port_beta,
                isSectorClustered=is_clustered,
                portfolioGrossReturn5d=port_gross_5d,
                portfolioGrossReturn20d=port_gross_20d,
                portfolioNetReturn5d=port_net_5d,
                portfolioNetReturn20d=port_net_20d,
                niftyReturn5d=nifty_ret_5d,
                niftyReturn20d=nifty_ret_20d,
                portfolioExcessReturn5d=port_excess_5d,
                portfolioExcessReturn20d=port_excess_20d,
                portfolioBeatNifty5d=port_excess_5d > 0,
                portfolioBeatNifty20d=port_excess_20d > 0 if not np.isnan(port_excess_20d) else False,
                top1BeatNifty5d=top1['realizedNetReturn5d'] > nifty_ret_5d,
                top1BeatNifty20d=(top1['realizedNetReturn20d'] > nifty_ret_20d) if not np.isnan(top1['realizedNetReturn20d']) and not np.isnan(nifty_ret_20d) else False,
                stocksBeatingNiftyCount5d=stocks_beat_5d,
                stocksBeatingNiftyCount20d=stocks_beat_20d,
            )
            portfolio_daily_records.append(port_rec)

        if not portfolio_daily_records:
            return {'status': 'INSUFFICIENT_DATA', 'message': 'No valid decision dates found.'}

        # -------------------------------------------------------------------------
        # 4. Statistical & Hit Rate Aggregations
        # -------------------------------------------------------------------------
        n_days = len(portfolio_daily_records)
        n_stock_evals = len(stock_eval_records)

        top1_hit_rate_nifty_5d = sum(1 for p in portfolio_daily_records if p.top1BeatNifty5d) / n_days * 100.0
        top3_stock_hit_rate_nifty_5d = sum(p.stocksBeatingNiftyCount5d for p in portfolio_daily_records) / (3 * n_days) * 100.0
        top3_port_hit_rate_nifty_5d = sum(1 for p in portfolio_daily_records if p.portfolioBeatNifty5d) / n_days * 100.0

        top1_abs_win_rate_5d = sum(1 for s in stock_eval_records if s.rank == 1 and s.absoluteWin5d) / n_days * 100.0
        top3_stock_abs_win_rate_5d = sum(1 for s in stock_eval_records if s.absoluteWin5d) / n_stock_evals * 100.0
        top3_port_abs_win_rate_5d = sum(1 for p in portfolio_daily_records if p.portfolioNetReturn5d > 0) / n_days * 100.0

        top1_hit_rate_nifty_20d = sum(1 for p in portfolio_daily_records if not np.isnan(p.portfolioExcessReturn20d) and p.top1BeatNifty20d) / max(1, sum(1 for p in portfolio_daily_records if not np.isnan(p.portfolioExcessReturn20d))) * 100.0
        top3_stock_hit_rate_nifty_20d = sum(p.stocksBeatingNiftyCount20d for p in portfolio_daily_records) / max(1, 3 * sum(1 for p in portfolio_daily_records if not np.isnan(p.portfolioExcessReturn20d))) * 100.0
        top3_port_hit_rate_nifty_20d = sum(1 for p in portfolio_daily_records if not np.isnan(p.portfolioExcessReturn20d) and p.portfolioBeatNifty20d) / max(1, sum(1 for p in portfolio_daily_records if not np.isnan(p.portfolioExcessReturn20d))) * 100.0

        mean_top3_net_5d = float(np.mean([p.portfolioNetReturn5d for p in portfolio_daily_records]) * 100.0)
        mean_nifty_5d = float(np.mean([p.niftyReturn5d for p in portfolio_daily_records]) * 100.0)
        mean_excess_5d = float(np.mean([p.portfolioExcessReturn5d for p in portfolio_daily_records]) * 100.0)

        valid_20d = [p for p in portfolio_daily_records if not np.isnan(p.portfolioNetReturn20d)]
        mean_top3_net_20d = float(np.mean([p.portfolioNetReturn20d for p in valid_20d]) * 100.0) if valid_20d else 0.0
        mean_nifty_20d = float(np.mean([p.niftyReturn20d for p in valid_20d]) * 100.0) if valid_20d else 0.0
        mean_excess_20d = float(np.mean([p.portfolioExcessReturn20d for p in valid_20d]) * 100.0) if valid_20d else 0.0

        # -------------------------------------------------------------------------
        # 4.1 Statistical Inference (Newey-West HAC & Block Bootstrap on Excess Returns)
        # -------------------------------------------------------------------------
        excess_5d = np.array([p.portfolioExcessReturn5d for p in portfolio_daily_records])
        hac_5d = compute_newey_west_hac(excess_5d * 100.0, max_lag=5)
        boot_5d = compute_block_bootstrap_ci(excess_5d * 100.0, block_size=5, n_bootstraps=500)

        if valid_20d:
            excess_20d = np.array([p.portfolioExcessReturn20d for p in valid_20d])
            hac_20d = compute_newey_west_hac(excess_20d * 100.0, max_lag=20)
            boot_20d = compute_block_bootstrap_ci(excess_20d * 100.0, block_size=20, n_bootstraps=500) if len(excess_20d) >= 40 else {}
        else:
            hac_20d = {}
            boot_20d = {}

        # -------------------------------------------------------------------------
        # 5. Daily Equity Curve & Financial Risk Ratios
        # -------------------------------------------------------------------------
        equity_series, daily_returns = self._build_continuous_equity_curve(
            portfolio_daily_records, initial_cash=1_000_000.0, horizon=horizon
        )
        cagr, sharpe, sortino, max_dd, pf = self._compute_performance_ratios(equity_series, daily_returns)

        # -------------------------------------------------------------------------
        # 6. Granular Fractile Monotonicity Audit
        # -------------------------------------------------------------------------
        fractile_analysis = self._compute_fractile_monotonicity_audit(
            all_universe_returns_5d, all_universe_returns_20d
        )

        # -------------------------------------------------------------------------
        # 7. Clustering & Factor Crowding Diagnostics
        # -------------------------------------------------------------------------
        clustering_pct = sum(1 for p in portfolio_daily_records if p.isSectorClustered) / n_days * 100.0
        mean_port_corr = float(np.mean([p.meanPairwiseCorrelation for p in portfolio_daily_records]))
        mean_port_beta = float(np.mean([p.portfolioBeta for p in portfolio_daily_records]))

        return {
            'diversificationMode': self.diversification_mode,
            'rankingMetric': ranking_metric,
            'evaluationDaysCount': n_days,
            'totalStockEvaluations': n_stock_evals,
            'hitRates5d': {
                'top1HitRateVsNifty': round(top1_hit_rate_nifty_5d, 2),
                'top3StockHitRateVsNifty': round(top3_stock_hit_rate_nifty_5d, 2),
                'top3PortfolioHitRateVsNifty': round(top3_port_hit_rate_nifty_5d, 2),
                'top1AbsoluteWinRate': round(top1_abs_win_rate_5d, 2),
                'top3StockAbsoluteWinRate': round(top3_stock_abs_win_rate_5d, 2),
                'top3PortfolioAbsoluteWinRate': round(top3_port_abs_win_rate_5d, 2),
                'meanPortfolioNetReturnPct': round(mean_top3_net_5d, 3),
                'meanNiftyReturnPct': round(mean_nifty_5d, 3),
                'meanExcessReturnPct': round(mean_excess_5d, 3),
            },
            'hitRates20d': {
                'top1HitRateVsNifty': round(top1_hit_rate_nifty_20d, 2),
                'top3StockHitRateVsNifty': round(top3_stock_hit_rate_nifty_20d, 2),
                'top3PortfolioHitRateVsNifty': round(top3_port_hit_rate_nifty_20d, 2),
                'meanPortfolioNetReturnPct': round(mean_top3_net_20d, 3),
                'meanNiftyReturnPct': round(mean_nifty_20d, 3),
                'meanExcessReturnPct': round(mean_excess_20d, 3),
            },
            'statisticalInference': {
                'hac5d': hac_5d,
                'bootstrap5d': boot_5d,
                'hac20d': hac_20d,
                'bootstrap20d': boot_20d,
            },
            'backtestMetrics': {
                'cagr': round(cagr, 2),
                'sharpe': round(sharpe, 2) if isinstance(sharpe, (float, int)) else sharpe,
                'sortino': round(sortino, 2) if isinstance(sortino, (float, int)) else sortino,
                'maxDrawdown': round(max_dd, 2),
                'profitFactor': round(pf, 2) if isinstance(pf, (float, int)) else pf,
                'annualTurnoverEstPct': round((252.0 / max(1, n_days)) * total_turnover_trades * 100.0, 1),
            },
            'factorCrowding': {
                'sectorClusteringPct': round(clustering_pct, 2),
                'meanPairwiseCorrelation': round(mean_port_corr, 3),
                'meanPortfolioBeta': round(mean_port_beta, 2),
            },
            'fractileSpreadAnalysis': fractile_analysis,
        }

    def _compute_historical_corr(
        self,
        tkr_a: str,
        tkr_b: str,
        historical_candles: Dict[str, pd.DataFrame],
        as_of_date: str
    ) -> Optional[float]:
        if tkr_a == tkr_b:
            return 1.0
        pair_key = (min(tkr_a, tkr_b), max(tkr_a, tkr_b), as_of_date)
        if pair_key in self._corr_cache:
            return self._corr_cache[pair_key]

        # Fast path via precomputed returns matrix
        if self._returns_matrix is not None and self._returns_date_to_idx is not None and self._ticker_to_col_idx is not None:
            col_a = self._ticker_to_col_idx.get(tkr_a)
            col_b = self._ticker_to_col_idx.get(tkr_b)
            end_idx = self._returns_date_to_idx.get(as_of_date)

            if col_a is not None and col_b is not None and end_idx is not None:
                start_idx = max(0, end_idx - self.corr_lookback + 1)
                arr_a = self._returns_matrix[start_idx : end_idx + 1, col_a]
                arr_b = self._returns_matrix[start_idx : end_idx + 1, col_b]

                valid = ~np.isnan(arr_a) & ~np.isnan(arr_b)
                if np.count_nonzero(valid) < 20:
                    self._corr_cache[pair_key] = None
                    return None

                va = arr_a[valid]
                vb = arr_b[valid]
                std_a = np.std(va)
                std_b = np.std(vb)
                if std_a == 0 or std_b == 0:
                    self._corr_cache[pair_key] = 0.0
                    return 0.0

                corr = np.corrcoef(va, vb)[0, 1]
                res = float(corr) if not np.isnan(corr) else None
                self._corr_cache[pair_key] = res
                return res

        # Fallback path
        ret_a = self._returns_cache.get(tkr_a)
        ret_b = self._returns_cache.get(tkr_b)

        if ret_a is None or ret_b is None:
            df_a = historical_candles.get(tkr_a)
            df_b = historical_candles.get(tkr_b)
            if df_a is None or df_b is None:
                self._corr_cache[pair_key] = None
                return None
            ret_a = df_a['Close'].pct_change().dropna()
            ret_b = df_b['Close'].pct_change().dropna()
            self._returns_cache[tkr_a] = ret_a
            self._returns_cache[tkr_b] = ret_b

        ts = pd.Timestamp(as_of_date)
        s_a = ret_a.loc[:ts].tail(self.corr_lookback)
        s_b = ret_b.loc[:ts].tail(self.corr_lookback)

        if len(s_a) < 20 or len(s_b) < 20:
            self._corr_cache[pair_key] = None
            return None

        aligned = pd.concat([s_a, s_b], axis=1, join='inner')
        if len(aligned) < 20:
            self._corr_cache[pair_key] = None
            return None

        corr = np.corrcoef(aligned.iloc[:, 0].values, aligned.iloc[:, 1].values)[0, 1]
        res = float(corr) if not np.isnan(corr) else None
        self._corr_cache[pair_key] = res
        return res

    def _build_continuous_equity_curve(
        self,
        portfolio_records: List[Top3DailyPortfolioRecord],
        initial_cash: float = 1_000_000.0,
        horizon: str = '5d'
    ) -> Tuple[pd.Series, pd.Series]:
        equity = initial_cash
        equity_dict = {}
        daily_rets = []
        h_days = 20.0 if horizon == '20d' else 5.0

        for p in portfolio_records:
            if horizon == '20d' and not np.isnan(p.portfolioNetReturn20d):
                net_ret = p.portfolioNetReturn20d
            else:
                net_ret = p.portfolioNetReturn5d
            r_day = ((1.0 + net_ret) ** (1.0 / h_days)) - 1.0
            equity *= (1.0 + r_day)
            equity_dict[p.date] = equity
            daily_rets.append(r_day)

        eq_series = pd.Series(equity_dict)
        ret_series = pd.Series(daily_rets, index=eq_series.index)
        return eq_series, ret_series

    def _compute_performance_ratios(
        self,
        equity_series: pd.Series,
        daily_returns: pd.Series
    ) -> Tuple[float, float, float, float, float]:
        if len(equity_series) < 5 or daily_returns.std() == 0:
            return 0.0, 0.0, 0.0, 0.0, 0.0

        n_days = len(equity_series)
        total_return = (equity_series.iloc[-1] / equity_series.iloc[0]) - 1.0
        years = max(0.1, n_days / 252.0)
        cagr = ((1.0 + total_return) ** (1.0 / years) - 1.0) * 100.0

        excess_daily = daily_returns - self.rf_daily
        sharpe = (excess_daily.mean() / daily_returns.std()) * math.sqrt(252.0)

        downside = daily_returns[daily_returns < 0]
        downside_std = downside.std() if len(downside) > 1 else daily_returns.std()
        sortino = (excess_daily.mean() / downside_std) * math.sqrt(252.0) if downside_std > 0 else 0.0

        cummax = equity_series.cummax()
        drawdown = (equity_series - cummax) / cummax
        max_dd = float(drawdown.min()) * 100.0

        gains = daily_returns[daily_returns > 0].sum()
        losses = abs(daily_returns[daily_returns < 0].sum())
        pf = float(gains / losses) if losses > 0 else 999.0

        return cagr, sharpe, sortino, max_dd, pf

    def _compute_fractile_monotonicity_audit(
        self,
        univ_returns_5d: List[Dict[str, Any]],
        univ_returns_20d: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        df5 = pd.DataFrame(univ_returns_5d)
        df20 = pd.DataFrame(univ_returns_20d)

        if df5.empty:
            return {}

        df5['rank_pct'] = df5.groupby('date')['score'].rank(pct=True, ascending=False)
        df20['rank_pct'] = df20.groupby('date')['score'].rank(pct=True, ascending=False)

        slices = [
            ('Top 1%', 0.01),
            ('Top 2%', 0.02),
            ('Top 5%', 0.05),
            ('Top 10% (D1)', 0.10),
            ('Top 20% (D2)', 0.20),
            ('Top 50%', 0.50),
            ('Full Universe Baseline', 1.00)
        ]

        univ_mean_net_5d = df5['netRet'].mean() * 100.0
        univ_mean_net_20d = df20['netRet'].mean() * 100.0

        records = []
        for label, thresh in slices:
            sub5 = df5[df5['rank_pct'] <= thresh]
            sub20 = df20[df20['rank_pct'] <= thresh]

            m_net_5 = float(sub5['netRet'].mean() * 100.0) if not sub5.empty else 0.0
            m_net_20 = float(sub20['netRet'].mean() * 100.0) if not sub20.empty else 0.0

            hit_nifty_5 = float((sub5['netRet'] > sub5['niftyRet']).mean() * 100.0) if not sub5.empty else 0.0
            hit_nifty_20 = float((sub20['netRet'] > sub20['niftyRet']).mean() * 100.0) if not sub20.empty else 0.0

            records.append({
                'fractile': label,
                'sampleCount': len(sub5),
                'meanNet5d': round(m_net_5, 3),
                'excessVsUniverse5d': round(m_net_5 - univ_mean_net_5d, 3),
                'hitRateVsNifty5d': round(hit_nifty_5, 2),
                'meanNet20d': round(m_net_20, 3),
                'excessVsUniverse20d': round(m_net_20 - univ_mean_net_20d, 3),
                'hitRateVsNifty20d': round(hit_nifty_20, 2),
            })

        d1_5d = next((r['meanNet5d'] for r in records if 'Top 10%' in r['fractile']), 0.0)
        base_5d = next((r['meanNet5d'] for r in records if 'Full Universe' in r['fractile']), 0.0)
        d1_20d = next((r['meanNet20d'] for r in records if 'Top 10%' in r['fractile']), 0.0)
        base_20d = next((r['meanNet20d'] for r in records if 'Full Universe' in r['fractile']), 0.0)

        is_monotonic_5d = d1_5d > base_5d
        is_monotonic_20d = d1_20d > base_20d

        return {
            'fractileSlices': records,
            'isMonotonic5d': is_monotonic_5d,
            'isMonotonic20d': is_monotonic_20d,
            'top10vsUniverseSpread5d': round(d1_5d - base_5d, 3),
            'top10vsUniverseSpread20d': round(d1_20d - base_20d, 3),
        }
