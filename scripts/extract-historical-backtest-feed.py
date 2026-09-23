#!/usr/bin/env python3
"""
Real Historical OOS Market Feed & ONNX Inference Extractor for QuantX.
Ingests true historical parquet daily tape from packages/quant-engine/data/historical,
extracts 25 canonical point-in-time features, runs inference through the active frozen
production ONNX models (1d, 5d, 20d), applies frozen monotonic isotonic calibration,
and exports structured session tape & order intents to real-oos-feed.json.
"""
import os
import sys
import glob
import json
import math
import numpy as np
import pandas as pd
import onnxruntime as ort

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
QUANT_ENGINE_DIR = os.path.join(REPO_ROOT, "packages", "quant-engine")
HISTORICAL_DATA_DIR = os.path.join(QUANT_ENGINE_DIR, "data", "historical")
ARTIFACT_PATH = os.path.join(REPO_ROOT, "apps", "api", "data", "artifacts", "active", "model-artifact.json")
OUTPUT_FEED_PATH = os.path.join(REPO_ROOT, "apps", "api", "data", "artifacts", "governance", "real-oos-feed.json")

sys.path.insert(0, QUANT_ENGINE_DIR)
from features.feature_engine import calculate_features

# Ticker to Sector Mapping for Liquid Universe
TICKER_SECTORS = {
    'RELIANCE.NS': 'Energy',
    'TCS.NS': 'Technology',
    'HDFCBANK.NS': 'Financial Services',
    'ICICIBANK.NS': 'Financial Services',
    'INFY.NS': 'Technology',
    'ITC.NS': 'Consumer Goods',
    'BHARTIARTL.NS': 'Telecommunication',
    'SBIN.NS': 'Financial Services',
    'LT.NS': 'Construction',
    'TATAMOTORS.NS': 'Automobile',
    'SUNPHARMA.NS': 'Healthcare',
    'TITAN.NS': 'Consumer Goods',
    'BAJFINANCE.NS': 'Financial Services',
    'MARUTI.NS': 'Automobile',
    'KOTAKBANK.NS': 'Financial Services',
    'AXISBANK.NS': 'Financial Services',
    'NTPC.NS': 'Utilities',
    'POWERGRID.NS': 'Utilities',
    'TATASTEEL.NS': 'Metals',
    'COALINDIA.NS': 'Energy',
}

def apply_isotonic_calibration(prob: float, knots: list) -> float:
    """Piecewise linear interpolation on monotonic knots."""
    if not knots or len(knots) < 2:
        return prob
    p = max(0.0, min(1.0, prob))
    if p <= knots[0][0]:
        return float(knots[0][1])
    if p >= knots[-1][0]:
        return float(knots[-1][1])
    for i in range(len(knots) - 1):
        x0, y0 = knots[i]
        x1, y1 = knots[i + 1]
        if x0 <= p <= x1:
            if x1 == x0:
                return float(y0)
            slope = (y1 - y0) / (x1 - x0)
            return float(y0 + slope * (p - x0))
    return p

def main():
    print("--- QuantX Real Historical OOS Feed & ONNX Inference Extractor ---")
    if not os.path.exists(ARTIFACT_PATH):
        print(f"ERROR: Active artifact not found at {ARTIFACT_PATH}")
        sys.exit(1)

    with open(ARTIFACT_PATH, "r", encoding="utf-8") as f:
        artifact = json.load(f)

    canon_features = artifact.get("featureSchema", [])
    if len(canon_features) != 25:
        print(f"ERROR: Expected 25 canonical features, got {len(canon_features)}")
        sys.exit(1)

    calib_knots = artifact.get("calibrationKnots") or artifact.get("calibration", {}).get("5d", {}).get("knots", [])

    # Load ONNX sessions
    models_dir = os.path.dirname(ARTIFACT_PATH)
    sessions = {}
    for horizon in ["1d", "5d", "20d"]:
        model_file = os.path.join(models_dir, f"model_{horizon}.onnx")
        if not os.path.exists(model_file):
            print(f"ERROR: ONNX model for horizon {horizon} not found at {model_file}")
            sys.exit(1)
        sessions[horizon] = ort.InferenceSession(model_file)
        print(f"Loaded ONNX session for {horizon} from {model_file}")

    # Load Benchmark NIFTY
    nifty_path = os.path.join(HISTORICAL_DATA_DIR, "NSEI.parquet")
    if not os.path.exists(nifty_path):
        print(f"ERROR: Benchmark NIFTY parquet not found at {nifty_path}")
        sys.exit(1)
    nifty_df = pd.read_parquet(nifty_path)
    print(f"Loaded NIFTY benchmark with {len(nifty_df)} sessions")

    # Target Out-of-Sample Window: 2025-01-01 through available historical data (2026)
    OOS_START_DATE = "2025-01-01"

    universe_tickers = sorted(list(TICKER_SECTORS.keys()))
    stock_dfs = {}
    feature_dfs = {}

    for ticker in universe_tickers:
        parquet_path = os.path.join(HISTORICAL_DATA_DIR, f"{ticker}.parquet")
        if not os.path.exists(parquet_path):
            print(f"Warning: {parquet_path} does not exist, skipping.")
            continue
        df = pd.read_parquet(parquet_path)
        if len(df) < 100:
            continue
        stock_dfs[ticker] = df
        # Extract features
        feat_df = calculate_features(df, nifty_df)
        feature_dfs[ticker] = feat_df

    available_tickers = list(stock_dfs.keys())
    print(f"Processed {len(available_tickers)} liquid NIFTY stocks.")

    # Identify all common trading dates in OOS period
    all_dates = set()
    for ticker, df in stock_dfs.items():
        df_dates = [str(d)[:10] for d in df.index]
        all_dates.update([d for d in df_dates if d >= OOS_START_DATE])

    trading_dates = sorted(list(all_dates))
    print(f"Identified {len(trading_dates)} chronological trading dates in OOS evaluation period ({trading_dates[0]} to {trading_dates[-1]}).")

    # Build daily candles and session predictions
    daily_candles = {ticker: [] for ticker in available_tickers}
    daily_opportunities = []

    for ticker in available_tickers:
        df = stock_dfs[ticker]
        feat_df = feature_dfs[ticker]
        sector = TICKER_SECTORS.get(ticker, "General")

        for idx, (dt, row) in enumerate(df.iterrows()):
            date_str = str(dt)[:10]
            if date_str < trading_dates[0]:
                continue

            open_p = float(row['Open'])
            high_p = float(row['High'])
            low_p = float(row['Low'])
            close_p = float(row['Close'])
            vol = float(row['Volume'])

            daily_candles[ticker].append({
                "date": date_str,
                "time": date_str,
                "open": round(open_p, 2),
                "high": round(high_p, 2),
                "low": round(low_p, 2),
                "close": round(close_p, 2),
                "volume": int(vol),
            })

            # Check if features are ready at this session
            if dt not in feat_df.index:
                continue
            feat_row = feat_df.loc[dt]
            if any(pd.isna(feat_row.get(col)) for col in canon_features):
                continue

            feature_vec = feat_row[canon_features].values.astype(np.float32).reshape(1, -1)

            # Evaluate 1D, 5D, 20D ONNX sessions
            probs = {}
            for h in ["1d", "5d", "20d"]:
                sess = sessions[h]
                in_name = sess.get_inputs()[0].name
                out = sess.run(None, {in_name: feature_vec})
                p = float(out[1][0][1]) if len(out) > 1 else float(out[0][0])
                probs[h] = p

            raw_prob_5d = probs["5d"]
            calib_prob_5d = apply_isotonic_calibration(raw_prob_5d, calib_knots)

            # ATR for stop loss and target profit
            atr_val = float(feat_row.get("atr_14", close_p * 0.02))
            if math.isnan(atr_val) or atr_val <= 0:
                atr_val = close_p * 0.02

            stop_loss = round(close_p - 2.0 * atr_val, 2)
            target_price = round(close_p + 3.0 * atr_val, 2)

            decision = "NO_TRADE"
            if calib_prob_5d >= 0.62:
                decision = "STRONG_BUY"
            elif calib_prob_5d >= 0.55:
                decision = "BUY"
            elif calib_prob_5d <= 0.38:
                decision = "SELL"

            if decision in ["BUY", "STRONG_BUY"]:
                daily_opportunities.append({
                    "date": date_str,
                    "ticker": ticker,
                    "sector": sector,
                    "decision": decision,
                    "rawProb5d": round(raw_prob_5d, 4),
                    "calibratedProb": round(calib_prob_5d, 4),
                    "prob1d": round(probs["1d"], 4),
                    "prob20d": round(probs["20d"], 4),
                    "currentPrice": round(close_p, 2),
                    "stopLossPrice": stop_loss,
                    "targetPrice": target_price,
                    "horizonDays": 5,
                })

    # Sort opportunities chronologically then by highest calibrated probability
    daily_opportunities.sort(key=lambda x: (x["date"], -x["calibratedProb"]))

    feed_payload = {
        "sourceDataset": "REAL_HISTORICAL_PARQUET_NSE",
        "universeVersion": "v9.0.0-pit-nifty50-constituency",
        "featureSchemaVersion": "v5.1.0-multi-factor-25",
        "modelType": "PRODUCTION_FROZEN_ONNX",
        "evalPeriodStart": trading_dates[0],
        "evalPeriodEnd": trading_dates[-1],
        "tradingDaysCount": len(trading_dates),
        "stocksCount": len(available_tickers),
        "universe": [{"ticker": t, "sector": TICKER_SECTORS[t]} for t in available_tickers],
        "tradingDates": trading_dates,
        "dailyCandles": daily_candles,
        "opportunities": daily_opportunities,
    }

    os.makedirs(os.path.dirname(OUTPUT_FEED_PATH), exist_ok=True)
    with open(OUTPUT_FEED_PATH, "w", encoding="utf-8") as f:
        json.dump(feed_payload, f, indent=2)

    print(f"Successfully generated real historical OOS feed: {OUTPUT_FEED_PATH}")
    print(f"  Sessions: {len(trading_dates)}")
    print(f"  Total Candidate BUY Opportunities: {len(daily_opportunities)}")

if __name__ == "__main__":
    main()
