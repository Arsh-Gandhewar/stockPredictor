"""
Golden Feature Parity Test Suite (Python Reference Generator & Invariant Tests).
Verifies that all 25 canonical features are computed without synthetic fallbacks during warmup
and exports a golden vector corpus for TypeScript runtime parity verification.
"""
import os
import sys
import json
import math
import numpy as np
import pandas as pd
import pytest

ENGINE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ENGINE_ROOT not in sys.path:
    sys.path.insert(0, ENGINE_ROOT)

from features.feature_engine import FEATURE_NAMES, calculate_features


def generate_synthetic_market_data(n_candles: int = 300, seed: int = 42):
    np.random.seed(seed)
    dates = pd.date_range("2024-01-01", periods=n_candles, freq="B")
    
    # Generate realistic geometric Brownian motion
    dt = 1 / 252
    stock_mu = 0.12
    stock_sigma = 0.25
    bench_mu = 0.10
    bench_sigma = 0.18
    corr = 0.65
    
    z1 = np.random.normal(0, 1, n_candles)
    z2 = corr * z1 + np.sqrt(1 - corr**2) * np.random.normal(0, 1, n_candles)
    
    stock_ret = (stock_mu - 0.5 * stock_sigma**2) * dt + stock_sigma * np.sqrt(dt) * z1
    bench_ret = (bench_mu - 0.5 * bench_sigma**2) * dt + bench_sigma * np.sqrt(dt) * z2
    
    stock_prices = 1000.0 * np.exp(np.cumsum(stock_ret))
    bench_prices = 20000.0 * np.exp(np.cumsum(bench_ret))
    
    # High, Low, Open, Volume
    stock_high = stock_prices * (1 + np.abs(np.random.normal(0, 0.008, n_candles)))
    stock_low = stock_prices * (1 - np.abs(np.random.normal(0, 0.008, n_candles)))
    stock_open = stock_prices * (1 + np.random.normal(0, 0.003, n_candles))
    stock_volume = np.random.uniform(500000, 2000000, n_candles).astype(int)
    
    bench_high = bench_prices * (1 + np.abs(np.random.normal(0, 0.005, n_candles)))
    bench_low = bench_prices * (1 - np.abs(np.random.normal(0, 0.005, n_candles)))
    bench_open = bench_prices * (1 + np.random.normal(0, 0.002, n_candles))
    bench_volume = np.random.uniform(10000000, 50000000, n_candles).astype(int)
    
    stock_df = pd.DataFrame({
        'Open': stock_open,
        'High': stock_high,
        'Low': stock_low,
        'Close': stock_prices,
        'Volume': stock_volume
    }, index=dates)
    
    bench_df = pd.DataFrame({
        'Open': bench_open,
        'High': bench_high,
        'Low': bench_low,
        'Close': bench_prices,
        'Volume': bench_volume
    }, index=dates)
    
    return stock_df, bench_df


class TestFeatureParityGolden:
    def test_25_features_generated_with_zero_lookahead(self):
        stock_df, bench_df = generate_synthetic_market_data(300)
        feat_df = calculate_features(stock_df, bench_df)
        
        assert len(FEATURE_NAMES) == 25
        for feat in FEATURE_NAMES:
            assert feat in feat_df.columns
            
        # Row 0 to 60: beta & vol_60d are NaN
        assert np.isnan(feat_df['beta_nifty'].iloc[10])
        assert np.isnan(feat_df['vol_60d'].iloc[10])
        
        # Row 99 (100 candles): 60d features are ready, but 252d 52-week features must be NaN
        assert not np.isnan(feat_df['beta_nifty'].iloc[99])
        assert np.isnan(feat_df['dist_52w_high'].iloc[99])
        assert np.isnan(feat_df['dist_52w_low'].iloc[99])
        assert bool(feat_df['featureWarmupComplete'].iloc[99]) is False
        
        # Row 299 (300 candles >= 252): all 25 features must be complete non-NaN
        assert bool(feat_df['featureWarmupComplete'].iloc[-1]) is True
        for feat in FEATURE_NAMES:
            val = float(feat_df[feat].iloc[-1])
            assert not np.isnan(val), f"Feature '{feat}' is NaN on row 299"
            assert not np.isinf(val), f"Feature '{feat}' is Inf on row 299"

    def test_export_golden_feature_vector(self):
        stock_df, bench_df = generate_synthetic_market_data(300)
        feat_df = calculate_features(stock_df, bench_df)
        
        last_row = feat_df.iloc[-1]
        golden_vector = {feat: float(last_row[feat]) for feat in FEATURE_NAMES}
        
        stock_candles = [
            {
                "timestamp": str(idx)[:10],
                "open": round(float(row['Open']), 2),
                "high": round(float(row['High']), 2),
                "low": round(float(row['Low']), 2),
                "close": round(float(row['Close']), 2),
                "volume": int(row['Volume'])
            }
            for idx, row in stock_df.iterrows()
        ]
        
        bench_candles = [
            {
                "timestamp": str(idx)[:10],
                "open": round(float(row['Open']), 2),
                "high": round(float(row['High']), 2),
                "low": round(float(row['Low']), 2),
                "close": round(float(row['Close']), 2),
                "volume": int(row['Volume'])
            }
            for idx, row in bench_df.iterrows()
        ]
        
        export_payload = {
            "candleCount": len(stock_candles),
            "stockCandles": stock_candles,
            "benchmarkCandles": bench_candles,
            "expectedFeatures": golden_vector
        }
        
        golden_file = os.path.join(os.path.dirname(__file__), "golden_feature_vector.json")
        with open(golden_file, "w", encoding="utf-8") as f:
            json.dump(export_payload, f, indent=2)
            
        assert os.path.exists(golden_file)
