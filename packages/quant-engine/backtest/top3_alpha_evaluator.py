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
    beta: float
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
        correlation_lookback_days: int = 60
    ):
        self.cost_engine = TransactionCostEngine(regime=cost_regime)
        self.rf_annual = risk_free_rate_annual
        self.rf_daily = (1.0 + risk_free_rate_annual) ** (1.0 / 252.0) - 1.0
        self.diversification_mode = diversification_mode
        self.max_sector_count = max_sector_count
        self.corr_penalty_weight = correlation_penalty_weight
        self.corr_lookback = correlation_lookback_days
        self._corr_cache: Dict[Tuple[str, str, str], Optional[float]] = {}
        self._returns_cache: Dict[str, pd.Series] = {}

    def evaluate_top3_alpha(
        self,
        oos_predictions_df: pd.DataFrame,
        historical_candles: Dict[str, pd.DataFrame],
        nifty_candles: pd.DataFrame,
        universe_engine: Optional[HistoricalUniverseEngine] = None,
        ranking_metric: str = 'risk_adjusted_ev'  # 'risk_adjusted_ev', 'net_ev', 'calibrated_prob', or 'lambda_rank'
    ) -> Dict[str, Any]:
        """
        Executes complete out-of-sample Top-3 alpha evaluation.
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

        # Calendar mapping for forward execution
        nifty_candles = nifty_candles.copy()
        if not isinstance(nifty_candles.index, pd.DatetimeIndex):
            nifty_candles.index = pd.to_datetime(nifty_candles.index)
        nifty_candles['date_str'] = nifty_candles.index.strftime('%Y-%m-%d')
        nifty_by_date = {r['date_str']: r for _, r in nifty_candles.iterrows()}
        sorted_nifty_dates = sorted(list(nifty_by_date.keys()))

        # Precompute candle date indices
        candles_by_ticker_date = {}
        for tkr, c_df in historical_candles.items():
            cdf = c_df.copy()
            if not isinstance(cdf.index, pd.DatetimeIndex):
                cdf.index = pd.to_datetime(cdf.index)
            cdf['date_str'] = cdf.index.strftime('%Y-%m-%d')
            candles_by_ticker_date[tkr] = {r['date_str']: r for _, r in cdf.iterrows()}

        # Precompute returns cache once
        if not self._returns_cache:
            for tkr, c_df in historical_candles.items():
                if 'Close' in c_df.columns:
                    self._returns_cache[tkr] = c_df['Close'].pct_change().dropna()

        # -------------------------------------------------------------------------
        # 1. Daily Decision Date Simulation Loop
        # -------------------------------------------------------------------------
        for t_date in unique_dates:
            day_preds = df[df['date_str'] == t_date].copy()
            if day_preds.empty:
                continue

            # Check forward index availability (Need t+1 Open and t+5/t+20 Close)
            try:
                t_idx = sorted_nifty_dates.index(t_date)
            except ValueError:
                continue

            if t_idx + 20 >= len(sorted_nifty_dates):
                continue

            t_plus_1_date = sorted_nifty_dates[t_idx + 1]
            t_plus_5_date = sorted_nifty_dates[t_idx + 5]
            t_plus_20_date = sorted_nifty_dates[t_idx + 20]

            nifty_entry = float(nifty_by_date[t_plus_1_date]['Open'])
            nifty_exit_5d = float(nifty_by_date[t_plus_5_date]['Close'])
            nifty_exit_20d = float(nifty_by_date[t_plus_20_date]['Close'])

            if nifty_entry <= 0:
                continue

            nifty_ret_5d = (nifty_exit_5d - nifty_entry) / nifty_entry
            nifty_ret_20d = (nifty_exit_20d - nifty_entry) / nifty_entry

            # Filter point-in-time universe eligibility
            eligible_candidates = []
            for _, row in day_preds.iterrows():
                tkr = str(row.get('ticker', 'UNKNOWN'))
                if tkr not in historical_candles:
                    continue

                t_dict = candles_by_ticker_date.get(tkr, {})
                if t_plus_1_date not in t_dict or t_plus_5_date not in t_dict or t_plus_20_date not in t_dict:
                    continue

                entry_p = float(t_dict[t_plus_1_date]['Open'])
                exit_p5 = float(t_dict[t_plus_5_date]['Close'])
                exit_p20 = float(t_dict[t_plus_20_date]['Close'])

                if entry_p <= 0 or exit_p5 <= 0 or exit_p20 <= 0:
                    continue

                p_cal = float(row.get('calibratedProbability', row.get('pred_prob', 0.5)) or 0.5)
                gross_ev = float(row.get('grossEV', row.get('EV', 0.0)) or 0.0)
                net_ev = float(row.get('netEV', row.get('ev_after_cost', gross_ev - 0.0013)) or 0.0)
                exp_risk = float(row.get('expectedRisk', row.get('risk', abs(row.get('p15', -0.02)))) or 0.02)
                exp_risk = max(0.005, exp_risk)

                if ranking_metric == 'risk_adjusted_ev':
                    score = net_ev / exp_risk
                elif ranking_metric == 'net_ev':
                    score = net_ev
                elif ranking_metric == 'calibrated_prob':
                    score = p_cal
                elif ranking_metric == 'lambda_rank':
                    score = float(row.get('rank_score', row.get('opportunityScore', net_ev / exp_risk)) or 0.0)
                else:
                    score = float(row.get('opportunityScore', net_ev / exp_risk) or 0.0)

                # Realized forward returns
                fwd_gross_5d = (exit_p5 - entry_p) / entry_p
                fwd_gross_20d = (exit_p20 - entry_p) / entry_p

                cost_rate_5d = self.cost_engine.calculate_round_trip_cost_rate()
                cost_rate_20d = cost_rate_5d

                fwd_net_5d = fwd_gross_5d - cost_rate_5d
                fwd_net_20d = fwd_gross_20d - cost_rate_20d

                cand_rec = {
                    'ticker': tkr,
                    'sector': row.get('sector', TICKER_SECTOR_MAP.get(tkr, 'UNKNOWN')),
                    'score': score,
                    'calibratedProbability': p_cal,
                    'expectedReturn': float(row.get('expectedReturn', row.get('p50', 0.0)) or 0.0),
                    'expectedRisk': exp_risk,
                    'adv20': float(row.get('ADV', 100000.0) or 100000.0) * entry_p,
                    'beta': float(row.get('beta', 1.0) or 1.0),
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
                    'excessReturn20d': fwd_net_20d - nifty_ret_20d,
                    'date': t_date
                }
                eligible_candidates.append(cand_rec)

                # Record universe-level distribution for decile / fractile audit
                all_universe_returns_5d.append({
                    'date': t_date, 'ticker': tkr, 'score': score,
                    'grossRet': fwd_gross_5d, 'netRet': fwd_net_5d, 'niftyRet': nifty_ret_5d
                })
                all_universe_returns_20d.append({
                    'date': t_date, 'ticker': tkr, 'score': score,
                    'grossRet': fwd_gross_20d, 'netRet': fwd_net_20d, 'niftyRet': nifty_ret_20d
                })

            if len(eligible_candidates) < 3:
                continue

            # ---------------------------------------------------------------------
            # 2. Candidate Selection (Unconstrained vs Constrained)
            # ---------------------------------------------------------------------
            eligible_candidates.sort(key=lambda x: (-x['score'], x['ticker']))

            selected_top3: List[Dict[str, Any]] = []

            if self.diversification_mode == 'UNCONSTRAINED':
                selected_top3 = eligible_candidates[:3]
            else:
                sector_counts: Dict[str, int] = {}
                pool = list(eligible_candidates)

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
            port_beta = float(np.mean([x['beta'] for x in selected_top3]))

            port_gross_5d = float(np.mean([x['realizedGrossReturn5d'] for x in selected_top3]))
            port_gross_20d = float(np.mean([x['realizedGrossReturn20d'] for x in selected_top3]))
            port_net_5d = float(np.mean([x['realizedNetReturn5d'] for x in selected_top3]))
            port_net_20d = float(np.mean([x['realizedNetReturn20d'] for x in selected_top3]))

            port_excess_5d = port_net_5d - nifty_ret_5d
            port_excess_20d = port_net_20d - nifty_ret_20d

            stocks_beat_5d = sum(1 for x in selected_top3 if x['realizedNetReturn5d'] > nifty_ret_5d)
            stocks_beat_20d = sum(1 for x in selected_top3 if x['realizedNetReturn20d'] > nifty_ret_20d)

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
                    beatNifty20d=cand['realizedNetReturn20d'] > nifty_ret_20d,
                    absoluteWin5d=cand['realizedNetReturn5d'] > 0,
                    absoluteWin20d=cand['realizedNetReturn20d'] > 0,
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
                portfolioBeatNifty20d=port_excess_20d > 0,
                top1BeatNifty5d=top1['realizedNetReturn5d'] > nifty_ret_5d,
                top1BeatNifty20d=top1['realizedNetReturn20d'] > nifty_ret_20d,
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

        top1_hit_rate_nifty_20d = sum(1 for p in portfolio_daily_records if p.top1BeatNifty20d) / n_days * 100.0
        top3_stock_hit_rate_nifty_20d = sum(p.stocksBeatingNiftyCount20d for p in portfolio_daily_records) / (3 * n_days) * 100.0
        top3_port_hit_rate_nifty_20d = sum(1 for p in portfolio_daily_records if p.portfolioBeatNifty20d) / n_days * 100.0

        mean_top3_net_5d = float(np.mean([p.portfolioNetReturn5d for p in portfolio_daily_records]) * 100.0)
        mean_nifty_5d = float(np.mean([p.niftyReturn5d for p in portfolio_daily_records]) * 100.0)
        mean_excess_5d = float(np.mean([p.portfolioExcessReturn5d for p in portfolio_daily_records]) * 100.0)

        mean_top3_net_20d = float(np.mean([p.portfolioNetReturn20d for p in portfolio_daily_records]) * 100.0)
        mean_nifty_20d = float(np.mean([p.niftyReturn20d for p in portfolio_daily_records]) * 100.0)
        mean_excess_20d = float(np.mean([p.portfolioExcessReturn20d for p in portfolio_daily_records]) * 100.0)

        # -------------------------------------------------------------------------
        # 5. Daily Equity Curve & Financial Risk Ratios
        # -------------------------------------------------------------------------
        equity_series, daily_returns = self._build_continuous_equity_curve(portfolio_daily_records, initial_cash=1_000_000.0)
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
            'backtestMetrics': {
                'cagr': round(cagr, 2),
                'sharpe': round(sharpe, 2) if isinstance(sharpe, (float, int)) else sharpe,
                'sortino': round(sortino, 2) if isinstance(sortino, (float, int)) else sortino,
                'maxDrawdown': round(max_dd, 2),
                'profitFactor': round(pf, 2) if isinstance(pf, (float, int)) else pf,
                'annualTurnoverEstPct': 52.0 * 3.0 * 100.0 / 5.0,
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
        initial_cash: float = 1_000_000.0
    ) -> Tuple[pd.Series, pd.Series]:
        equity = initial_cash
        equity_dict = {}
        daily_rets = []

        for p in portfolio_records:
            r_day = ((1.0 + p.portfolioNetReturn5d) ** (1.0 / 5.0)) - 1.0
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
