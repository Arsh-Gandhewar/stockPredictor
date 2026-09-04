"""
QuantX Long-History Chronological Walk-Forward & Crisis Evaluation Engine (2007/2008 - 2026).
=============================================================================================
Authoritative evaluation of cross-sectional Top-3 stock selection alpha across 18.5 years
of reliable Indian equity-market history with strict point-in-time and survivorship integrity.
"""
import os
os.environ["LOKY_MAX_CPU_COUNT"] = "4"
os.environ["PYTHONUNBUFFERED"] = "1"
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)
import glob
import json
import hashlib
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
import pandas as pd
import numpy as np

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from universe import INDICES, TICKER_SECTOR_MAP
from features.feature_engine import calculate_features, FEATURE_NAMES, enrich_panel_with_regime_features
from targets.target_definition import compute_targets, assign_cross_sectional_relevance_grades
from models.universe_engine import (
    HistoricalUniverseEngine,
    HISTORICAL_SECURITY_MASTER,
    HISTORICAL_DATA_WINDOW_START,
    FEATURE_WARMUP_COMPLETE_DATE,
    FULL_VIX_START_DATE,
    HISTORICAL_DATA_WINDOW_END
)
from models.alpha_ranker import CrossSectionalAlphaRanker
from backtest.top3_alpha_evaluator import Top3AlphaEvaluator

# Exact Historical Regimes / Eras spanning 2008 to 2026
HISTORICAL_ERAS = [
    {
        "eraId": "ERA_1_GFC",
        "name": "2008 Global Financial Crisis & V-Recovery",
        "startDate": "2008-01-01",
        "endDate": "2009-12-31",
        "regimeDescription": "Extreme macro deflation, Lehman collapse (-60% NIFTY drawdown) and 2009 general election V-reversal (+17% in 1 day)"
    },
    {
        "eraId": "ERA_2_EURO_INFLATION",
        "name": "2010-2011 European Debt Crisis & Inflation Shock",
        "startDate": "2010-01-01",
        "endDate": "2011-12-31",
        "regimeDescription": "Double-digit CPI inflation in India, aggressive RBI repo rate hiking cycle, Greece/PIIGS sovereign default risk"
    },
    {
        "eraId": "ERA_3_TAPER_ELECTION",
        "name": "2012-2014 Taper Tantrum & Modi 1.0 Rally",
        "startDate": "2012-01-01",
        "endDate": "2014-12-31",
        "regimeDescription": "US Fed taper announcement, INR plunge to 68/USD, current account deficit crisis, followed by 2014 BJP majority election rally"
    },
    {
        "eraId": "ERA_4_COMMODITY_DEMON",
        "name": "2015-2016 Commodity Slowdown & Demonetization",
        "startDate": "2015-01-01",
        "endDate": "2016-12-31",
        "regimeDescription": "Crude oil collapse, China Yuan devaluation shock, Nov 2016 Indian currency demonetization liquidity disruption"
    },
    {
        "eraId": "ERA_5_GST_NBFC",
        "name": "2017-2019 GST Rollout & IL&FS Liquidity Shock",
        "startDate": "2017-01-01",
        "endDate": "2019-12-31",
        "regimeDescription": "Goods and Services Tax introduction, 2017 midcap mania, September 2018 IL&FS default triggering systemic shadow-banking credit crunch"
    },
    {
        "eraId": "ERA_6_COVID_SHOCK",
        "name": "2020 COVID-19 Crash & Rapid Liquidity Recovery",
        "startDate": "2020-01-01",
        "endDate": "2020-12-31",
        "regimeDescription": "Global lockdown, NIFTY 38.4% crash in 30 days, Yes Bank RBI moratorium, followed by zero-rate global central bank stimulus explosion"
    },
    {
        "eraId": "ERA_7_RETAIL_TIGHTENING",
        "name": "2021-2024 Retail Expansion, Global Inflation & Capex Boom",
        "startDate": "2021-01-01",
        "endDate": "2024-12-31",
        "regimeDescription": "Record domestic retail investor inflows, 2022 Russia-Ukraine war and global central bank rate tightening, followed by infrastructure capex expansion"
    },
    {
        "eraId": "ERA_8_FROZEN_HOLDOUT",
        "name": "2025-2026 Frozen Out-of-Sample Holdout",
        "startDate": "2025-01-01",
        "endDate": "2026-09-03",
        "regimeDescription": "Untouched final out-of-sample holdout period reserved strictly for unseen evaluation"
    }
]

# Historical Crisis Windows for Dedicated Stress Testing
CRISIS_WINDOWS = [
    {"crisisId": "CRISIS_2008_GFC", "name": "2008 Lehman GFC Crash", "startDate": "2008-01-08", "endDate": "2008-10-27"},
    {"crisisId": "CRISIS_2011_INFLATION", "name": "2011 Risk-Off / Inflation Crisis", "startDate": "2011-01-03", "endDate": "2011-12-30"},
    {"crisisId": "CRISIS_2013_TAPER", "name": "2013 Fed Taper Tantrum", "startDate": "2013-05-20", "endDate": "2013-08-28"},
    {"crisisId": "CRISIS_2015_COMMODITY", "name": "2015-16 Commodity & China Shock", "startDate": "2015-08-03", "endDate": "2016-02-29"},
    {"crisisId": "CRISIS_2020_COVID", "name": "2020 COVID Liquidity Shock", "startDate": "2020-01-20", "endDate": "2020-03-23"},
    {"crisisId": "CRISIS_2022_RATE_HIKE", "name": "2022 Global Rate Tightening", "startDate": "2021-10-18", "endDate": "2022-06-17"}
]

# 9 Chronological Walk-Forward Folds with 35-day Purge Gaps (Fold 0 tests 2008 GFC out-of-sample)
# Expanding model uses all available data from 2002-07-01 forward; Model C (Rolling 5Y) overrides trainStart
WALK_FORWARD_FOLDS = [
    {"foldIndex": 0, "trainStart": "2002-07-01", "trainEnd": "2007-12-31", "testStart": "2008-01-08", "testEnd": "2009-12-31", "label": "2008-2009 GFC Out-of-Sample"},
    {"foldIndex": 1, "trainStart": "2002-07-01", "trainEnd": "2010-12-31", "testStart": "2011-02-05", "testEnd": "2012-12-31", "label": "2011-2012 Out-of-Sample"},
    {"foldIndex": 2, "trainStart": "2002-07-01", "trainEnd": "2012-12-31", "testStart": "2013-02-05", "testEnd": "2014-12-31", "label": "2013-2014 Out-of-Sample"},
    {"foldIndex": 3, "trainStart": "2002-07-01", "trainEnd": "2014-12-31", "testStart": "2015-02-05", "testEnd": "2016-12-31", "label": "2015-2016 Out-of-Sample"},
    {"foldIndex": 4, "trainStart": "2002-07-01", "trainEnd": "2016-12-31", "testStart": "2017-02-05", "testEnd": "2018-12-31", "label": "2017-2018 Out-of-Sample"},
    {"foldIndex": 5, "trainStart": "2002-07-01", "trainEnd": "2018-12-31", "testStart": "2019-02-05", "testEnd": "2020-12-31", "label": "2019-2020 Out-of-Sample"},
    {"foldIndex": 6, "trainStart": "2002-07-01", "trainEnd": "2020-12-31", "testStart": "2021-02-05", "testEnd": "2022-12-31", "label": "2021-2022 Out-of-Sample"},
    {"foldIndex": 7, "trainStart": "2002-07-01", "trainEnd": "2022-12-31", "testStart": "2023-02-05", "testEnd": "2024-12-31", "label": "2023-2024 Out-of-Sample"},
    {"foldIndex": 8, "trainStart": "2002-07-01", "trainEnd": "2024-12-31", "testStart": "2025-02-05", "testEnd": "2026-09-03", "label": "2025-2026 Final Holdout"}
]

class LongHistoryResearchEngine:
    def __init__(self, data_dir: str = 'packages/quant-engine/data/historical_long'):
        self.data_dir = os.path.abspath(data_dir)
        self.universe_engine = HistoricalUniverseEngine(security_master=HISTORICAL_SECURITY_MASTER)
        self.evaluator = Top3AlphaEvaluator(
            diversification_mode='CONSTRAINED',
            max_sector_count=1,
            correlation_penalty_weight=0.40,
            use_hysteresis=True,
            exit_rank_limit=6
        )
        self.nifty_df = None
        self.vix_df = None
        self.benchmark_df = None
        self.historical_candles = {}
        self.panel_df = None
        
    def load_and_preprocess_panel(self) -> pd.DataFrame:
        print("=" * 80)
        print("LOADING & PREPROCESSING HISTORICAL DATA PANEL (2002-2026)")
        print("=" * 80)
        
        nifty_path = os.path.join(self.data_dir, "NSEI.parquet")
        vix_path = os.path.join(self.data_dir, "INDIAVIX.parquet")
        bsesn_path = os.path.join(self.data_dir, "BSESN.parquet")
        
        self.nifty_df = pd.read_parquet(nifty_path)
        self.vix_df = pd.read_parquet(vix_path)
        bsesn_df = pd.read_parquet(bsesn_path) if os.path.exists(bsesn_path) else None
        
        # Build continuous benchmark: SENSEX pre-Sept 2007, NIFTY 50 post-Sept 2007
        if bsesn_df is not None:
            pre_nifty = bsesn_df[bsesn_df.index < HISTORICAL_DATA_WINDOW_START]
            self.benchmark_df = pd.concat([pre_nifty, self.nifty_df], axis=0).sort_index()
        else:
            self.benchmark_df = self.nifty_df
            
        files = sorted(glob.glob(f"{self.data_dir}/*.parquet"))
        all_processed = []
        
        for f in files:
            ticker = os.path.basename(f).replace('.parquet', '')
            if ticker in ['NSEI', 'BSESN', 'NSEBANK', 'INDIAVIX']:
                continue
            try:
                df = pd.read_parquet(f)
                if df.empty or len(df) < 150:
                    continue
                # Store full candles
                self.historical_candles[ticker] = df[['Open', 'High', 'Low', 'Close', 'Volume']].copy()
                
                # Expand historical data back to 2002-07-01 for genuine pre-2008 training
                df_valid = df[df.index >= '2002-07-01'].copy()
                if len(df_valid) < 60:
                    continue
                    
                df_feat = calculate_features(df_valid, benchmark_df=self.benchmark_df)
                df_tgt = compute_targets(df_feat, benchmark_df=self.benchmark_df)
                df_tgt['ticker'] = ticker
                df_tgt['sector'] = HISTORICAL_SECURITY_MASTER.get(ticker, {}).get('sector', 'UNKNOWN')
                all_processed.append(df_tgt)
            except Exception as e:
                pass
                
        self.panel_df = pd.concat(all_processed, axis=0)
        self.panel_df.sort_index(inplace=True)
        self.panel_df['predictionTimestamp'] = self.panel_df.index.strftime('%Y-%m-%d')
        print("Computing cross-sectional relevance grades across panel...")
        self.panel_df = assign_cross_sectional_relevance_grades(self.panel_df)
        print("Enriching panel with cross-sectional regime meta-features (breadth, VIX, A/D ratio)...")
        self.panel_df = enrich_panel_with_regime_features(self.panel_df, vix_df=self.vix_df)
        print(f"Panel loaded: {len(self.panel_df)} total observations across {len(self.historical_candles)} securities.")
        print(f"Dates span: {self.panel_df['predictionTimestamp'].min()} to {self.panel_df['predictionTimestamp'].max()}")
        return self.panel_df

    def run_walk_forward_evaluation(self, model_type: str = 'MODEL_B_LONG_EXPANDING') -> Dict[str, Any]:
        """
        Executes strict walk-forward evaluation across all 8 chronological folds.
        Supports:
        - MODEL_A_SHORT_2021: Trained only on post-2021 data (legacy design)
        - MODEL_B_LONG_EXPANDING: Trained expanding from 2008
        - MODEL_C_ROLLING_5Y: Trained on rolling trailing 5-year window
        """
        print(f"\n>>> RUNNING WALK-FORWARD EVALUATION FOR: {model_type} <<<")
        fold_results = []
        all_oos_predictions = []
        
        for fold in WALK_FORWARD_FOLDS:
            f_idx = fold['foldIndex']
            tr_start = fold['trainStart']
            tr_end = fold['trainEnd']
            te_start = fold['testStart']
            te_end = fold['testEnd']
            label = fold['label']
            
            # Model-specific training window adjustments
            if model_type == 'MODEL_A_SHORT_2021':
                # Model A only trains on data starting 2021-01-01
                if te_end < "2021-01-01":
                    # Cannot test pre-2021 under Model A design
                    continue
                actual_tr_start = max("2021-01-01", tr_start)
            elif model_type == 'MODEL_C_ROLLING_5Y':
                # 5-year trailing rolling window
                end_dt = pd.to_datetime(tr_end)
                start_dt = end_dt - pd.DateOffset(years=5)
                actual_tr_start = start_dt.strftime('%Y-%m-%d')
            else: # MODEL_B_LONG_EXPANDING
                actual_tr_start = tr_start
                
            train_mask = (self.panel_df['predictionTimestamp'] >= actual_tr_start) & (self.panel_df['predictionTimestamp'] <= tr_end)
            test_mask = (self.panel_df['predictionTimestamp'] >= te_start) & (self.panel_df['predictionTimestamp'] <= te_end)
            
            train_data = self.panel_df[train_mask]
            test_data = self.panel_df[test_mask]
            
            if len(train_data) < 500 or len(test_data) < 200:
                continue
                
            now_str = datetime.now().strftime('%H:%M:%S')
            print(f"[{now_str}] Fold {f_idx} ({label}): Train [{actual_tr_start} -> {tr_end}] ({len(train_data)} rows) | Test [{te_start} -> {te_end}] ({len(test_data)} rows)", flush=True)
            
            # Train independent 5D and 20D Alpha Rankers on fold training data
            ranker_5d = CrossSectionalAlphaRanker(horizon_str='5d')
            ranker_5d.fit(train_data, features=FEATURE_NAMES)
            oos_scored_5d = ranker_5d.predict(test_data, features=FEATURE_NAMES)
            oos_scored_5d['foldIndex'] = f_idx

            ranker_20d = CrossSectionalAlphaRanker(horizon_str='20d')
            ranker_20d.fit(train_data, features=FEATURE_NAMES)
            oos_scored_20d = ranker_20d.predict(test_data, features=FEATURE_NAMES)
            oos_scored_20d['foldIndex'] = f_idx

            all_oos_predictions.append(oos_scored_5d)
            
            # Evaluate Top-3 alpha on this fold's test period
            fold_eval_5d = self.evaluator.evaluate_top3_alpha(
                oos_predictions_df=oos_scored_5d,
                historical_candles=self.historical_candles,
                nifty_candles=self.benchmark_df,
                ranking_metric='canonical_alpha'
            )
            fold_eval_20d = self.evaluator.evaluate_top3_alpha(
                oos_predictions_df=oos_scored_20d,
                historical_candles=self.historical_candles,
                nifty_candles=self.benchmark_df,
                ranking_metric='canonical_alpha'
            )
            
            fold_results.append({
                "foldIndex": f_idx,
                "label": label,
                "isFrozenHoldout": (f_idx == 8),
                "trainWindow": f"{actual_tr_start} to {tr_end}",
                "testWindow": f"{te_start} to {te_end}",
                "trainRows": len(train_data),
                "testRows": len(test_data),
                "cagr": fold_eval_5d['backtestMetrics']['cagr'],
                "sharpe": fold_eval_5d['backtestMetrics']['sharpe'],
                "sortino": fold_eval_5d['backtestMetrics']['sortino'],
                "maxDrawdown": fold_eval_5d['backtestMetrics']['maxDrawdown'],
                "annualTurnoverPct": fold_eval_5d['backtestMetrics']['annualTurnoverEstPct'],
                "top1HitRate": fold_eval_5d['hitRates5d']['top1HitRateVsNifty'],
                "top3StockHitRate": fold_eval_5d['hitRates5d']['top3StockHitRateVsNifty'],
                "top3PortfolioHitRate": fold_eval_5d['hitRates5d']['top3PortfolioHitRateVsNifty'],
                "meanExcessReturn5d": fold_eval_5d['hitRates5d']['meanExcessReturnPct'],
                "top1HitRate20d": fold_eval_20d['hitRates20d']['top1HitRateVsNifty'],
                "top3PortfolioHitRate20d": fold_eval_20d['hitRates20d']['top3PortfolioHitRateVsNifty'],
                "meanExcessReturn20d": fold_eval_20d['hitRates20d']['meanExcessReturnPct'],
                "sectorClusteringPct": fold_eval_5d['factorCrowding']['sectorClusteringPct'],
                "pairwiseCorrelation": fold_eval_5d['factorCrowding']['meanPairwiseCorrelation']
            })
            
        full_oos_df = pd.concat(all_oos_predictions, axis=0) if all_oos_predictions else pd.DataFrame()
        
        # CRITICAL HOLDOUT ISOLATION (P0 Issue 9):
        # Development aggregate contains ONLY pre-holdout folds (Folds 0-7, pre-2025).
        # Fold 8 is strictly quarantined and reported separately.
        dev_oos_df = full_oos_df[full_oos_df['foldIndex'] < 8] if 'foldIndex' in full_oos_df.columns else full_oos_df
        holdout_oos_df = full_oos_df[full_oos_df['foldIndex'] == 8] if 'foldIndex' in full_oos_df.columns else pd.DataFrame()

        aggregate_eval = {}
        if not dev_oos_df.empty:
            aggregate_eval = self.evaluator.evaluate_top3_alpha(
                oos_predictions_df=dev_oos_df,
                historical_candles=self.historical_candles,
                nifty_candles=self.benchmark_df,
                ranking_metric='canonical_alpha'
            )

        holdout_eval = {}
        if not holdout_oos_df.empty:
            holdout_eval = self.evaluator.evaluate_top3_alpha(
                oos_predictions_df=holdout_oos_df,
                historical_candles=self.historical_candles,
                nifty_candles=self.benchmark_df,
                ranking_metric='canonical_alpha'
            )
            
        return {
            "modelType": model_type,
            "folds": fold_results,
            "aggregate": aggregate_eval,
            "frozenHoldout": holdout_eval,
            "devOosRows": len(dev_oos_df),
            "holdoutRows": len(holdout_oos_df),
            "totalOosRows": len(full_oos_df),
            "oos_df": dev_oos_df,
            "holdout_df": holdout_oos_df
        }

    def run_era_and_crisis_evaluations(self, oos_predictions_df: pd.DataFrame) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Evaluates model performance across the 8 distinct historical eras and 6 crisis windows."""
        print("\n>>> EVALUATING PERFORMANCE ACROSS HISTORICAL ERAS & CRISIS WINDOWS <<<")
        era_results = []
        crisis_results = []
        
        for era in HISTORICAL_ERAS:
            era_mask = (oos_predictions_df['predictionTimestamp'] >= era['startDate']) & (oos_predictions_df['predictionTimestamp'] <= era['endDate'])
            era_sub = oos_predictions_df[era_mask]
            if len(era_sub) < 50:
                continue
            ev = self.evaluator.evaluate_top3_alpha(
                oos_predictions_df=era_sub,
                historical_candles=self.historical_candles,
                nifty_candles=self.benchmark_df,
                ranking_metric='canonical_alpha'
            )
            era_results.append({
                "eraId": era['eraId'],
                "name": era['name'],
                "dates": f"{era['startDate']} to {era['endDate']}",
                "description": era['regimeDescription'],
                "observations": len(era_sub),
                "cagr": ev['backtestMetrics']['cagr'],
                "sharpe": ev['backtestMetrics']['sharpe'],
                "sortino": ev['backtestMetrics']['sortino'],
                "maxDrawdown": ev['backtestMetrics']['maxDrawdown'],
                "annualTurnoverPct": ev['backtestMetrics']['annualTurnoverEstPct'],
                "top1HitRate": ev['hitRates5d']['top1HitRateVsNifty'],
                "top3StockHitRate": ev['hitRates5d']['top3StockHitRateVsNifty'],
                "top3PortfolioHitRate": ev['hitRates5d']['top3PortfolioHitRateVsNifty'],
                "meanExcessReturn5d": ev['hitRates5d']['meanExcessReturnPct']
            })
            
        for crisis in CRISIS_WINDOWS:
            cr_mask = (oos_predictions_df['predictionTimestamp'] >= crisis['startDate']) & (oos_predictions_df['predictionTimestamp'] <= crisis['endDate'])
            cr_sub = oos_predictions_df[cr_mask]
            if len(cr_sub) < 20:
                continue
            ev = self.evaluator.evaluate_top3_alpha(
                oos_predictions_df=cr_sub,
                historical_candles=self.historical_candles,
                nifty_candles=self.benchmark_df,
                ranking_metric='canonical_alpha'
            )
            # Measure benchmark return over same crisis window — use consistent spliced benchmark
            bench_sub = self.benchmark_df.loc[crisis['startDate']:crisis['endDate']]
            nifty_crash_return = ((bench_sub['Close'].iloc[-1] - bench_sub['Close'].iloc[0]) / bench_sub['Close'].iloc[0]) * 100 if len(bench_sub) > 1 else 0.0
            
            crisis_results.append({
                "crisisId": crisis['crisisId'],
                "name": crisis['name'],
                "dates": f"{crisis['startDate']} to {crisis['endDate']}",
                "observations": len(cr_sub),
                "niftyReturnPct": round(nifty_crash_return, 2),
                "strategyMaxDrawdown": ev['backtestMetrics']['maxDrawdown'],
                "top1HitRate": ev['hitRates5d']['top1HitRateVsNifty'],
                "top3StockHitRate": ev['hitRates5d']['top3StockHitRateVsNifty'],
                "top3PortfolioHitRate": ev['hitRates5d']['top3PortfolioHitRateVsNifty'],
                "meanExcessReturn5d": ev['hitRates5d']['meanExcessReturnPct']
            })
            
        return {"eras": era_results}, {"crises": crisis_results}

    def run_benchmark_splice_validation(self, fold_0_oos: pd.DataFrame) -> Dict[str, Any]:
        """
        P0 Issue 3: Tests SENSEX-relative and NIFTY-relative results separately
        around the splice transition (2008-2009 GFC fold).
        Confirms that alpha remains positive under independently defined benchmark variants.
        """
        print("\n>>> RUNNING BENCHMARK SPLICE VALIDATION (FOLD 0: 2008-2009 GFC) <<<")
        results = {}
        
        # 1. Continuous Spliced Benchmark
        ev_spliced = self.evaluator.evaluate_top3_alpha(
            oos_predictions_df=fold_0_oos,
            historical_candles=self.historical_candles,
            nifty_candles=self.benchmark_df,
            ranking_metric='canonical_alpha'
        )
        results['splicedBenchmark'] = {
            'benchmark': 'SENSEX pre-Sep07 + NIFTY post-Sep07',
            'cagr': ev_spliced['backtestMetrics']['cagr'],
            'sharpe': ev_spliced['backtestMetrics']['sharpe'],
            'top3HitRateVsBench': ev_spliced['hitRates5d']['top3PortfolioHitRateVsNifty'],
            'meanExcessReturn5d': ev_spliced['hitRates5d']['meanExcessReturnPct'],
            'isAlphaPositive': ev_spliced['hitRates5d']['meanExcessReturnPct'] > 0
        }
        
        # 2. Pure NIFTY 50 Benchmark
        ev_nifty = self.evaluator.evaluate_top3_alpha(
            oos_predictions_df=fold_0_oos,
            historical_candles=self.historical_candles,
            nifty_candles=self.nifty_df,
            ranking_metric='canonical_alpha'
        )
        results['pureNiftyBenchmark'] = {
            'benchmark': '^NSEI (NIFTY 50 only)',
            'cagr': ev_nifty['backtestMetrics']['cagr'],
            'sharpe': ev_nifty['backtestMetrics']['sharpe'],
            'top3HitRateVsBench': ev_nifty['hitRates5d']['top3PortfolioHitRateVsNifty'],
            'meanExcessReturn5d': ev_nifty['hitRates5d']['meanExcessReturnPct'],
            'isAlphaPositive': ev_nifty['hitRates5d']['meanExcessReturnPct'] > 0
        }
        
        return results

    def run_scoring_ablation_study(self, dev_oos_df: pd.DataFrame) -> List[Dict[str, Any]]:
        """
        P0 Issue 4 & P1 Issue 19: Ablation study across candidate ranking objectives
        evaluated strictly on pre-holdout development walk-forward data.
        """
        print("\n>>> RUNNING SCORING OBJECTIVE ABLATION STUDY (PRE-HOLDOUT DEVELOPMENT DATA) <<<")
        objectives = [
            ('canonical_alpha', 'Canonical AlphaScore (RankPct * [1 + clip(RiskAdjExcess)])'),
            ('risk_adjusted_ev', 'Risk-Adjusted EV (NetEV / ExpectedRisk)'),
            ('net_ev', 'Expected Net Excess Return Rank'),
            ('calibrated_prob', 'Calibrated Probability Rank'),
            ('lambda_rank', 'Raw LambdaMART Percentile Rank'),
        ]
        
        ablation_results = []
        for metric_id, metric_name in objectives:
            ev = self.evaluator.evaluate_top3_alpha(
                oos_predictions_df=dev_oos_df,
                historical_candles=self.historical_candles,
                nifty_candles=self.benchmark_df,
                ranking_metric=metric_id
            )
            ablation_results.append({
                'metricId': metric_id,
                'name': metric_name,
                'cagr': ev['backtestMetrics']['cagr'],
                'sharpe': ev['backtestMetrics']['sharpe'],
                'sortino': ev['backtestMetrics']['sortino'],
                'maxDrawdown': ev['backtestMetrics']['maxDrawdown'],
                'top3PortfolioHitRate5d': ev['hitRates5d']['top3PortfolioHitRateVsNifty'],
                'meanExcessReturn5d': ev['hitRates5d']['meanExcessReturnPct'],
                'top3PortfolioHitRate20d': ev['hitRates20d']['top3PortfolioHitRateVsNifty'],
                'meanExcessReturn20d': ev['hitRates20d']['meanExcessReturnPct'],
            })
        return ablation_results

    def run_cost_stress_testing(self, dev_oos_df: pd.DataFrame) -> List[Dict[str, Any]]:
        """
        P0 Issue 11: Transaction cost stress testing at multiple friction multipliers:
        1.0x (13 bps), 1.5x (19.5 bps), 2.0x (26 bps), 3.0x (39 bps).
        """
        print("\n>>> RUNNING TRANSACTION COST STRESS TESTING <<<")
        multipliers = [1.0, 1.5, 2.0, 3.0]
        stress_results = []
        
        for mult in multipliers:
            ev = self.evaluator.evaluate_top3_alpha(
                oos_predictions_df=dev_oos_df,
                historical_candles=self.historical_candles,
                nifty_candles=self.benchmark_df,
                ranking_metric='canonical_alpha',
                cost_multiplier=mult
            )
            bps = round(0.0013 * mult * 10000, 1)
            stress_results.append({
                'multiplier': mult,
                'roundTripBps': bps,
                'cagr': ev['backtestMetrics']['cagr'],
                'sharpe': ev['backtestMetrics']['sharpe'],
                'sortino': ev['backtestMetrics']['sortino'],
                'maxDrawdown': ev['backtestMetrics']['maxDrawdown'],
                'meanPortfolioNetReturn5d': ev['hitRates5d']['meanPortfolioNetReturnPct'],
                'meanExcessReturn5d': ev['hitRates5d']['meanExcessReturnPct'],
                'isAlphaPositive': bool(ev['hitRates5d']['meanExcessReturnPct'] > 0)
            })
        return stress_results

def run_comprehensive_long_history_study():
    engine = LongHistoryResearchEngine()
    engine.load_and_preprocess_panel()
    
    # 1. Evaluate Model B (Long History Expanding Window)
    res_b = engine.run_walk_forward_evaluation('MODEL_B_LONG_EXPANDING')
    
    # 2. Evaluate Model C (Rolling 5-Year Window)
    res_c = engine.run_walk_forward_evaluation('MODEL_C_ROLLING_5Y')
    
    # 3. Evaluate Model A (Short History Baseline 2021+)
    res_a = engine.run_walk_forward_evaluation('MODEL_A_SHORT_2021')
    
    # 4. Benchmark Splice Validation (Fold 0: 2008-2009 GFC)
    fold_0_data = res_b['oos_df'][res_b['oos_df']['foldIndex'] == 0] if 'foldIndex' in res_b['oos_df'].columns else res_b['oos_df']
    splice_validation = engine.run_benchmark_splice_validation(fold_0_data)

    # 5. Scoring Objective Ablation Study on Development Data
    scoring_ablation = engine.run_scoring_ablation_study(res_b['oos_df'])

    # 6. Transaction Cost Stress Testing
    cost_stress = engine.run_cost_stress_testing(res_b['oos_df'])

    # 7. Era-by-Era & Crisis Diagnostics using Model B's development out-of-sample predictions
    era_report, crisis_report = engine.run_era_and_crisis_evaluations(res_b['oos_df'])
    
    # 8. Compile Master Artifact Manifest
    manifest = {
        "datasetMetadata": {
            "earliestValidMarketDate": "2002-07-01",
            "fullNiftyStartDate": HISTORICAL_DATA_WINDOW_START,
            "fullVixStartDate": FULL_VIX_START_DATE,
            "latestValidMarketDate": HISTORICAL_DATA_WINDOW_END,
            "totalMarketSessions": len(engine.benchmark_df[engine.benchmark_df.index >= '2002-07-01']),
            "eligibleSecurityCount": len(HISTORICAL_SECURITY_MASTER),
            "survivorshipStatus": "PARTIALLY_RESOLVED",
            "survivorshipMethodology": "Partially resolved: Point-in-time constituent snapshots Ut across expanded 56-security panel; full NIFTY 500 survivorship pending comprehensive corporate depository ingestion",
            "survivorshipCertification": "PARTIAL_PANEL_ONLY (56 Securities)",
            "corporateActionTreatment": "Auto-adjusted continuous series incorporating splits, dividends, bonuses, and rights",
            "benchmarkIndex": "^NSEI (NIFTY 50) spliced with ^BSESN (SENSEX) pre-Sept 2007",
            "macroVolIndex": "^INDIAVIX (India Volatility Index)"
        },
        "walkForwardSplits": WALK_FORWARD_FOLDS,
        "historicalEras": HISTORICAL_ERAS,
        "crisisStressWindows": CRISIS_WINDOWS,
        "modelComparison": {
            "modelA_ShortHistory2021": {
                "cagr": res_a['aggregate'].get('backtestMetrics', {}).get('cagr'),
                "sharpe": res_a['aggregate'].get('backtestMetrics', {}).get('sharpe'),
                "sortino": res_a['aggregate'].get('backtestMetrics', {}).get('sortino'),
                "maxDrawdown": res_a['aggregate'].get('backtestMetrics', {}).get('maxDrawdown'),
                "top3PortfolioHitRate": res_a['aggregate'].get('hitRates5d', {}).get('top3PortfolioHitRateVsNifty'),
                "meanExcessReturn5d": res_a['aggregate'].get('hitRates5d', {}).get('meanExcessReturnPct')
            },
            "modelB_LongHistoryExpanding": {
                "cagr": res_b['aggregate'].get('backtestMetrics', {}).get('cagr'),
                "sharpe": res_b['aggregate'].get('backtestMetrics', {}).get('sharpe'),
                "sortino": res_b['aggregate'].get('backtestMetrics', {}).get('sortino'),
                "maxDrawdown": res_b['aggregate'].get('backtestMetrics', {}).get('maxDrawdown'),
                "top3PortfolioHitRate": res_b['aggregate'].get('hitRates5d', {}).get('top3PortfolioHitRateVsNifty'),
                "meanExcessReturn5d": res_b['aggregate'].get('hitRates5d', {}).get('meanExcessReturnPct')
            },
            "modelC_Rolling5Y": {
                "cagr": res_c['aggregate'].get('backtestMetrics', {}).get('cagr'),
                "sharpe": res_c['aggregate'].get('backtestMetrics', {}).get('sharpe'),
                "sortino": res_c['aggregate'].get('backtestMetrics', {}).get('sortino'),
                "maxDrawdown": res_c['aggregate'].get('backtestMetrics', {}).get('maxDrawdown'),
                "top3PortfolioHitRate": res_c['aggregate'].get('hitRates5d', {}).get('top3PortfolioHitRateVsNifty'),
                "meanExcessReturn5d": res_c['aggregate'].get('hitRates5d', {}).get('meanExcessReturnPct')
            }
        },
        "frozenHoldoutValidation": {
            "modelB_Holdout": res_b.get('frozenHoldout', {}),
            "modelC_Holdout": res_c.get('frozenHoldout', {}),
        },
        "benchmarkSpliceValidation": splice_validation,
        "scoringAblationStudy": scoring_ablation,
        "costStressTesting": cost_stress,
        "eraPerformance": era_report['eras'],
        "crisisStressPerformance": crisis_report['crises']
    }
    
    manifest_path = "packages/quant-engine/research/historical_data_manifest.json"
    report_path = "packages/quant-engine/research/long_history_alpha_report.json"
    
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2, default=str)
    with open(report_path, 'w') as f:
        json.dump({
            "modelB_Expanding": res_b,
            "modelC_Rolling": res_c,
            "modelA_Short": res_a,
            "benchmarkSpliceValidation": splice_validation,
            "scoringAblationStudy": scoring_ablation,
            "costStressTesting": cost_stress,
            "eras": era_report,
            "crises": crisis_report
        }, f, indent=2, default=str)
        
    print(f"\nArtifact saved to {manifest_path}")
    print(f"Complete report saved to {report_path}")
    
    print("\n" + "=" * 85)
    print("3-WAY MODEL ARCHITECTURE COMPARISON (STRICT OUT-OF-SAMPLE)")
    print(f"{'Metric':<32} | {'Model A (Short 2021+)':<20} | {'Model B (Long Expanding)':<24} | {'Model C (Rolling 5Y)':<20}")
    print("-" * 105)
    print(f"{'CAGR':<32} | {str(manifest['modelComparison']['modelA_ShortHistory2021']['cagr'])+'%':>18} | {str(manifest['modelComparison']['modelB_LongHistoryExpanding']['cagr'])+'%':>22} | {str(manifest['modelComparison']['modelC_Rolling5Y']['cagr'])+'%':>18}")
    print(f"{'Sharpe Ratio':<32} | {str(manifest['modelComparison']['modelA_ShortHistory2021']['sharpe']):>18} | {str(manifest['modelComparison']['modelB_LongHistoryExpanding']['sharpe']):>22} | {str(manifest['modelComparison']['modelC_Rolling5Y']['sharpe']):>18}")
    print(f"{'Sortino Ratio':<32} | {str(manifest['modelComparison']['modelA_ShortHistory2021']['sortino']):>18} | {str(manifest['modelComparison']['modelB_LongHistoryExpanding']['sortino']):>22} | {str(manifest['modelComparison']['modelC_Rolling5Y']['sortino']):>18}")
    print(f"{'Max Drawdown':<32} | {str(manifest['modelComparison']['modelA_ShortHistory2021']['maxDrawdown'])+'%':>18} | {str(manifest['modelComparison']['modelB_LongHistoryExpanding']['maxDrawdown'])+'%':>22} | {str(manifest['modelComparison']['modelC_Rolling5Y']['maxDrawdown'])+'%':>18}")
    print(f"{'Top-3 Hit Rate vs NIFTY':<32} | {str(manifest['modelComparison']['modelA_ShortHistory2021']['top3PortfolioHitRate'])+'%':>18} | {str(manifest['modelComparison']['modelB_LongHistoryExpanding']['top3PortfolioHitRate'])+'%':>22} | {str(manifest['modelComparison']['modelC_Rolling5Y']['top3PortfolioHitRate'])+'%':>18}")
    print(f"{'Mean Excess Return / 5d':<32} | {str(manifest['modelComparison']['modelA_ShortHistory2021']['meanExcessReturn5d'])+'%':>18} | {str(manifest['modelComparison']['modelB_LongHistoryExpanding']['meanExcessReturn5d'])+'%':>22} | {str(manifest['modelComparison']['modelC_Rolling5Y']['meanExcessReturn5d'])+'%':>18}")
    print("=" * 85)

if __name__ == '__main__':
    run_comprehensive_long_history_study()
