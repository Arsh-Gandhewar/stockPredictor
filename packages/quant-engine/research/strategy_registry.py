import os
import sys
import glob
import json
import numpy as np
import pandas as pd
from datetime import datetime, timezone

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from universe import NSE_UNIVERSE
from data.download_historical import download_data, DATA_DIR
from features.feature_engine import calculate_features, FEATURE_NAMES
from features.regime_model import compute_market_regimes
from targets.target_definition import compute_targets
from models.train_model import train_horizon_model
from models.cross_sectional_ranker import rank_cross_sectional_opportunities
from backtest.backtest_engine import run_portfolio_backtest
from quant_governance_config import (
    ECONOMIC_CAGR_HURDLE,
    ECONOMIC_SHARPE_HURDLE,
    ECONOMIC_PROFIT_FACTOR_HURDLE,
    ECONOMIC_MAX_DRAWDOWN_HURDLE
)

def run_strategy_experiment_suite():
    print("=" * 70)
    print("PHASE 6: 12-STRATEGY VALIDATION EXPERIMENT REGISTRY")
    print("=" * 70)
    
    # 1. Load Data & Compute Features
    nifty_file = os.path.join(DATA_DIR, "NSEI.parquet")
    nifty_df = pd.read_parquet(nifty_file) if os.path.exists(nifty_file) else None
    benchmark_regimes = compute_market_regimes(nifty_df) if nifty_df is not None else None
    
    files = glob.glob(f"{DATA_DIR}/*.parquet")
    all_processed_dfs = []
    historical_candles_by_ticker = {}
    
    for f in files:
        ticker = os.path.basename(f).replace('.parquet', '')
        if ticker in ['NSEI', 'BSESN', 'NSEBANK', 'INDIAVIX']:
            continue
        try:
            df = pd.read_parquet(f)
            if df.empty or len(df) < 250:
                continue
            df_feat = calculate_features(df, benchmark_df=nifty_df)
            df_tgt = compute_targets(df_feat)
            df_tgt['ticker'] = ticker
            all_processed_dfs.append(df_tgt)
            historical_candles_by_ticker[ticker] = df[['Open', 'High', 'Low', 'Close', 'Volume']].copy()
        except Exception as e:
            pass
            
    panel_df = pd.concat(all_processed_dfs, axis=0)
    panel_df.sort_index(inplace=True)
    panel_df['predictionTimestamp'] = panel_df.index.strftime('%Y-%m-%d')
    
    # Train 5D model walk-forward
    print("\n--- Training Walk-Forward Folds for 5D Model ---")
    h_res = train_horizon_model(panel_df, features=FEATURE_NAMES, horizon_str='5d')
    oos_5d = h_res['oos_predictions_df']
    
    candidates = []
    
    # Candidate 1: Baseline Probability 0.55
    print("\nEvaluating Candidate 1: Baseline Probability 0.55...")
    res1 = run_portfolio_backtest(
        predictions_df=oos_5d,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        prob_threshold=0.55,
        strategy_mode='BASELINE_PROBABILITY_055'
    )
    candidates.append({
        'experimentId': 'CAND_01_BASELINE_PROB_055',
        'description': 'Flat entry on probability >= 0.55 without ranking',
        'topN': None,
        'regimeFilter': False,
        'metrics': res1
    })
    
    # Candidate 2: Raw EV Threshold
    print("Evaluating Candidate 2: Raw EV > 0...")
    res2 = run_portfolio_backtest(
        predictions_df=oos_5d,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    candidates.append({
        'experimentId': 'CAND_02_RAW_EV_THRESHOLD',
        'description': 'Flat entry on EV > 0 without cross-sectional ranking',
        'topN': None,
        'regimeFilter': False,
        'metrics': res2
    })
    
    # Candidate 3 to 6: Top-N Cross-Sectional Ranking (Top 1, 2, 3, 5)
    for n in [1, 2, 3, 5]:
        print(f"Evaluating Candidate (Top {n} Risk-Adjusted EV)...")
        ranked_df = rank_cross_sectional_opportunities(
            oos_5d,
            top_n=n,
            min_ev_hurdle=0.001,
            regime_filter_enabled=False
        )
        res_n = run_portfolio_backtest(
            predictions_df=ranked_df,
            historical_candles_by_ticker=historical_candles_by_ticker,
            horizon_days=5,
            strategy_mode='PRODUCTION_EXPECTED_VALUE'
        )
        candidates.append({
            'experimentId': f'CAND_0{2+n}_TOP_{n}_RISK_ADJ_EV',
            'description': f'Daily cross-sectional Top-{n} opportunity selection by Risk-Adjusted EV',
            'topN': n,
            'regimeFilter': False,
            'metrics': res_n
        })
        
    # Candidate 7: Top 3 with Regime Filter
    print("Evaluating Candidate 7: Top 3 with Regime Filter...")
    ranked_r3 = rank_cross_sectional_opportunities(
        oos_5d,
        top_n=3,
        min_ev_hurdle=0.002,
        regime_filter_enabled=True,
        benchmark_regimes_df=benchmark_regimes
    )
    res7 = run_portfolio_backtest(
        predictions_df=ranked_r3,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    candidates.append({
        'experimentId': 'CAND_07_TOP_3_EV_WITH_REGIME',
        'description': 'Daily Top-3 selection with point-in-time NIFTY regime filter',
        'topN': 3,
        'regimeFilter': True,
        'metrics': res7
    })
    
    # Candidate 8: Top 2 with Regime Filter & Higher EV Hurdle (Selectivity Alpha)
    print("Evaluating Candidate 8: Top 2 with Regime Filter & Strict EV Hurdle...")
    ranked_r2_strict = rank_cross_sectional_opportunities(
        oos_5d,
        top_n=2,
        min_ev_hurdle=0.003,
        regime_filter_enabled=True,
        benchmark_regimes_df=benchmark_regimes
    )
    res8 = run_portfolio_backtest(
        predictions_df=ranked_r2_strict,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    candidates.append({
        'experimentId': 'CAND_08_TOP_2_REGIME_STRICT_EV',
        'description': 'High-selectivity Top-2 with 30 bps net hurdle and regime gating',
        'topN': 2,
        'regimeFilter': True,
        'metrics': res8
    })
    
    # Candidate 9: Top 1 High Conviction with Regime Filter
    print("Evaluating Candidate 9: Top 1 High Conviction with Regime Filter...")
    ranked_r1 = rank_cross_sectional_opportunities(
        oos_5d,
        top_n=1,
        min_ev_hurdle=0.003,
        regime_filter_enabled=True,
        benchmark_regimes_df=benchmark_regimes
    )
    res9 = run_portfolio_backtest(
        predictions_df=ranked_r1,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    candidates.append({
        'experimentId': 'CAND_09_TOP_1_HIGH_CONVICTION',
        'description': 'Highest conviction single asset daily rotation with regime gate',
        'topN': 1,
        'regimeFilter': True,
        'metrics': res9
    })
    
    # Candidate 10: Top 3 with 3D holding horizon
    print("Evaluating Candidate 10: Top 3 with 3D holding horizon...")
    res10 = run_portfolio_backtest(
        predictions_df=ranked_r3,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=3,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    candidates.append({
        'experimentId': 'CAND_10_TOP_3_REGIME_3D_HOLDING',
        'description': 'Top 3 with 3-day holding horizon to capture fast momentum',
        'topN': 3,
        'regimeFilter': True,
        'metrics': res10
    })
    
    # Candidate 11: Top 2 with 3D holding horizon
    print("Evaluating Candidate 11: Top 2 with 3D holding horizon...")
    res11 = run_portfolio_backtest(
        predictions_df=ranked_r2_strict,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=3,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    candidates.append({
        'experimentId': 'CAND_11_TOP_2_REGIME_3D_HOLDING',
        'description': 'Top 2 with 3-day holding horizon',
        'topN': 2,
        'regimeFilter': True,
        'metrics': res11
    })
    
    # Candidate 12: Top 3 Dynamic Sizing (10% max, 25% sector cap)
    print("Evaluating Candidate 12: Top 3 with Dynamic Sizing & Sector Caps...")
    res12 = run_portfolio_backtest(
        predictions_df=ranked_r3,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        initial_cash=1_000_000.0,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    candidates.append({
        'experimentId': 'CAND_12_TOP_3_DYNAMIC_PORTFOLIO',
        'description': 'Top 3 with full dynamic portfolio sizing and sector protection',
        'topN': 3,
        'regimeFilter': True,
        'metrics': res12
    })
    
    print("\n" + "=" * 70)
    print("CANDIDATE STRATEGY COMPARISON TABLE (VALIDATION ONLY)")
    print("=" * 70)
    print(f"{'Experiment ID':<32} | {'CAGR':<8} | {'Sharpe':<8} | {'MaxDD':<8} | {'WinRate':<8} | {'Trades':<8} | {'PF':<8}")
    print("-" * 90)
    
    best_cand = None
    best_score = -999.0
    
    for c in candidates:
        m = c['metrics']
        cagr = m.get('cagr', 0.0)
        sharpe = m.get('sharpe', 0.0)
        maxdd = m.get('maxDrawdown', 0.0)
        wr = m.get('winRate', 0.0)
        trades = m.get('totalTrades', 0)
        pf = m.get('profitFactor', 0.0)
        
        # Economic utility score: 30% Sharpe, 20% CAGR, 15% MaxDD, 10% PF, 10% WinRate
        utility_score = (
            0.30 * max(0.0, sharpe) * 20.0 +
            0.20 * max(0.0, cagr) +
            0.15 * max(0.0, 100.0 + maxdd) * 0.2 +
            0.10 * (pf if isinstance(pf, (int, float)) and pf > 0 else 1.0) * 10.0 +
            0.10 * (wr / 10.0)
        )
        c['economicUtilityScore'] = round(utility_score, 2)
        
        pf_str = f"{pf:.2f}" if isinstance(pf, (int, float)) else str(pf)
        print(f"{c['experimentId']:<32} | {cagr:>6.2f}% | {sharpe:>6.2f} | {maxdd:>6.2f}% | {wr:>6.2f}% | {trades:>6} | {pf_str:>6}")
        
        if utility_score > best_score and trades >= 30:
            best_score = utility_score
            best_cand = c
            
    print("\n" + "=" * 70)
    print(f"SELECTED STRATEGY: {best_cand['experimentId']}")
    print(f"Description: {best_cand['description']}")
    print(f"Validation Performance: CAGR={best_cand['metrics']['cagr']}%, Sharpe={best_cand['metrics']['sharpe']}, MaxDD={best_cand['metrics']['maxDrawdown']}%, Trades={best_cand['metrics']['totalTrades']}")
    print("=" * 70)
    
    registry_payload = {
        'evaluatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'candidateCount': len(candidates),
        'candidates': candidates,
        'selectedStrategy': best_cand
    }
    
    out_file = os.path.join(os.path.dirname(__file__), 'strategy_experiment_registry.json')
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(registry_payload, f, indent=2)
        
    print(f"Saved experiment registry to {out_file}")
    return registry_payload

if __name__ == '__main__':
    run_strategy_experiment_suite()
