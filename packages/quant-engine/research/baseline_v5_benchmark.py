import os
import sys
import glob
import json
import numpy as np
import pandas as pd
from scipy.stats import spearmanr, pearsonr
from datetime import datetime, timezone

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from universe import NSE_UNIVERSE, INDICES
from data.download_historical import download_data, DATA_DIR
from features.feature_engine import calculate_features, FEATURE_NAMES
from targets.target_definition import compute_targets
from models.train_model import train_horizon_model
from backtest.backtest_engine import run_portfolio_backtest
from costs import TransactionCostEngine
from quant_governance_config import (
    MIN_TEST_CALIBRATION_SAMPLE_COUNT,
    MIN_RETURN_BUCKET_SAMPLE_COUNT,
    MIN_TAIL_SAMPLE_COUNT
)

def run_baseline_v5_and_signal_diagnosis():
    print("=" * 70)
    print("PHASE 1: BASELINE V5 FREEZE & SIGNAL INFORMATION CONTENT ANALYSIS")
    print("=" * 70)
    
    # 1. Ingest market data
    download_data(period="5y", force_refresh=False)
    nifty_file = os.path.join(DATA_DIR, "NSEI.parquet")
    nifty_df = pd.read_parquet(nifty_file) if os.path.exists(nifty_file) else None
    
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
            print(f"Skipping {ticker}: {e}")
            
    panel_df = pd.concat(all_processed_dfs, axis=0)
    panel_df.sort_index(inplace=True)
    panel_df['predictionTimestamp'] = panel_df.index.strftime('%Y-%m-%d')
    print(f"Total processed observations: {len(panel_df)}")
    
    # 2. Train models across 1d, 5d, 20d horizons and collect OOS predictions
    oos_by_horizon = {}
    for h in ['1d', '5d', '20d']:
        print(f"--- Training Walk-Forward Models for {h} ---")
        h_res = train_horizon_model(panel_df, features=FEATURE_NAMES, horizon_str=h)
        oos_by_horizon[h] = h_res['oos_predictions_df']
        
    # 3. Evaluate BASELINE_V5 on 5d OOS ledger using PRODUCTION_EXPECTED_VALUE
    oos_5d = oos_by_horizon['5d']
    bt_v5 = run_portfolio_backtest(
        predictions_df=oos_5d,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        initial_cash=1_000_000.0,
        strategy_mode='PRODUCTION_EXPECTED_VALUE'
    )
    
    # 4. Evaluate Baseline Benchmarks
    # 4a. Baseline Probability 0.55
    bt_p055 = run_portfolio_backtest(
        predictions_df=oos_5d,
        historical_candles_by_ticker=historical_candles_by_ticker,
        horizon_days=5,
        prob_threshold=0.55,
        initial_cash=1_000_000.0,
        strategy_mode='BASELINE_PROBABILITY_055'
    )
    
    # 4b. Nifty Buy & Hold benchmark
    if nifty_df is not None and not nifty_df.empty:
        nifty_test = nifty_df.loc[nifty_df.index >= pd.Timestamp(oos_5d['predictionTimestamp'].min())]
        if len(nifty_test) > 1:
            nifty_cagr = float(((nifty_test['Close'].iloc[-1] / nifty_test['Close'].iloc[0]) ** (365.0 / (nifty_test.index[-1] - nifty_test.index[0]).days) - 1.0) * 100.0)
            nifty_ret = nifty_test['Close'].pct_change().dropna()
            nifty_sharpe = float((nifty_ret.mean() * 252.0 - 0.04) / (nifty_ret.std() * np.sqrt(252.0))) if nifty_ret.std() > 0 else 0.0
            nifty_maxdd = float(((nifty_test['Close'] / nifty_test['Close'].cummax() - 1.0).min()) * 100.0)
        else:
            nifty_cagr, nifty_sharpe, nifty_maxdd = 0.0, 0.0, 0.0
    else:
        nifty_cagr, nifty_sharpe, nifty_maxdd = 0.0, 0.0, 0.0
        
    baseline_record = {
        'strategyVersion': 'BASELINE_V5_EXPECTED_VALUE',
        'cagr': bt_v5['cagr'],
        'sharpe': bt_v5['sharpe'],
        'sortino': bt_v5['sortino'],
        'maxDrawdown': bt_v5['maxDrawdown'],
        'profitFactor': bt_v5['profitFactor'],
        'winRate': bt_v5['winRate'],
        'totalTrades': bt_v5['totalTrades'],
        'totalCostsPaid': bt_v5.get('totalCostsPaid', 0.0),
        'benchmarks': {
            'NIFTY_BUY_HOLD': {'cagr': round(nifty_cagr, 2), 'sharpe': round(nifty_sharpe, 2), 'maxDrawdown': round(nifty_maxdd, 2)},
            'BASELINE_PROB_055': {'cagr': bt_p055['cagr'], 'sharpe': bt_p055['sharpe'], 'sortino': bt_p055['sortino'], 'maxDrawdown': bt_p055['maxDrawdown'], 'profitFactor': bt_p055['profitFactor'], 'trades': bt_p055['totalTrades']}
        }
    }
    
    print("\n[BASELINE V5 METRICS]")
    print(json.dumps(baseline_record, indent=2))
    
    # 5. Signal Information Content Analysis across 10 Probability Buckets
    buckets = [
        ('0.40-0.45', 0.40, 0.45),
        ('0.45-0.50', 0.45, 0.50),
        ('0.50-0.55', 0.50, 0.55),
        ('0.55-0.60', 0.55, 0.60),
        ('0.60-0.65', 0.60, 0.65),
        ('0.65-0.70', 0.65, 0.70),
        ('0.70-0.75', 0.70, 0.75),
        ('0.75-0.80', 0.75, 0.80),
        ('0.80-0.90', 0.80, 0.90),
        ('0.90-1.00', 0.90, 1.01),
    ]
    
    signal_diagnosis = {}
    
    for h in ['1d', '5d', '20d']:
        df_h = oos_by_horizon[h].dropna(subset=['calibratedProbability', 'actual_net_return'])
        p = df_h['calibratedProbability'].values
        r = df_h['actual_net_return'].values
        
        sp_corr, sp_p = spearmanr(p, r)
        pe_corr, pe_p = pearsonr(p, r)
        
        bucket_stats = []
        for name, low, high in buckets:
            mask = (p >= low) & (p < high)
            sub_r = r[mask]
            n = len(sub_r)
            if n > 0:
                wins = np.sum(sub_r > 0)
                gains = sub_r[sub_r > 0]
                losses = sub_r[sub_r < 0]
                mean_gain = float(np.mean(gains)) if len(gains) > 0 else 0.0
                mean_loss = float(np.abs(np.mean(losses))) if len(losses) > 0 else 0.0
                p_win = wins / n
                p_loss = 1.0 - p_win
                ev = float(p_win * mean_gain - p_loss * mean_loss)
                
                bucket_stats.append({
                    'bucket': name,
                    'sampleCount': n,
                    'winRate': round(p_win * 100.0, 2),
                    'meanNetReturn': round(float(np.mean(sub_r)) * 100.0, 4),
                    'medianNetReturn': round(float(np.median(sub_r)) * 100.0, 4),
                    'p05': round(float(np.percentile(sub_r, 5)) * 100.0, 4),
                    'p10': round(float(np.percentile(sub_r, 10)) * 100.0, 4),
                    'p25': round(float(np.percentile(sub_r, 25)) * 100.0, 4),
                    'p50': round(float(np.percentile(sub_r, 50)) * 100.0, 4),
                    'p75': round(float(np.percentile(sub_r, 75)) * 100.0, 4),
                    'p90': round(float(np.percentile(sub_r, 90)) * 100.0, 4),
                    'p95': round(float(np.percentile(sub_r, 95)) * 100.0, 4),
                    'meanGain': round(mean_gain * 100.0, 4),
                    'meanLoss': round(mean_loss * 100.0, 4),
                    'expectedValue': round(ev * 100.0, 4),
                    'profitFactor': round(float(np.sum(gains) / np.abs(np.sum(losses))), 2) if len(losses) > 0 and np.sum(losses) != 0 else None
                })
            else:
                bucket_stats.append({'bucket': name, 'sampleCount': 0})
                
        # Signal Quality Classification
        # Monotonicity test: does higher probability bucket yield higher mean net return?
        valid_b = [b for b in bucket_stats if b.get('sampleCount', 0) >= 30]
        monotonic = True
        if len(valid_b) >= 3:
            returns = [b['meanNetReturn'] for b in valid_b]
            monotonic = all(returns[i] <= returns[i+1] for i in range(len(returns)-1))
            
        if sp_corr > 0.05 and sp_p < 0.01:
            sig_class = 'SIGNAL_STRONG_AND_ECONOMIC'
        elif sp_corr > 0.01 and sp_p < 0.05:
            sig_class = 'SIGNAL_PREDICTIVE_BUT_ECONOMICALLY_WEAK'
        elif not monotonic and sp_corr > 0:
            sig_class = 'SIGNAL_CALIBRATED_BUT_NONMONOTONIC'
        else:
            sig_class = 'SIGNAL_WEAK'
            
        signal_diagnosis[h] = {
            'spearmanCorrelation': round(float(sp_corr), 4),
            'spearmanPValue': float(sp_p),
            'pearsonCorrelation': round(float(pe_corr), 4),
            'signalClassification': sig_class,
            'bucketAnalysis': bucket_stats
        }
        
    print("\n[SIGNAL INFORMATION CONTENT DIAGNOSIS]")
    for h, diag in signal_diagnosis.items():
        print(f"\n--- Horizon {h} ---")
        print(f"Rank IC (Spearman): {diag['spearmanCorrelation']} (p={diag['spearmanPValue']:.4e})")
        print(f"Classification: {diag['signalClassification']}")
        for b in diag['bucketAnalysis']:
            if b.get('sampleCount', 0) > 0:
                print(f"  Bucket {b['bucket']}: N={b['sampleCount']}, WinRate={b['winRate']}%, MeanRet={b['meanNetReturn']}%, EV={b['expectedValue']}%, PF={b['profitFactor']}")
                
    results_payload = {
        'evaluatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'baseline': baseline_record,
        'signalDiagnosis': signal_diagnosis
    }
    
    out_path = os.path.join(os.path.dirname(__file__), 'baseline_and_signal_diagnosis.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(results_payload, f, indent=2)
    print(f"\nSaved diagnosis to {out_path}")
    return results_payload

if __name__ == '__main__':
    run_baseline_v5_and_signal_diagnosis()
