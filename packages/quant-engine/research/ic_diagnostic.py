"""
P0-3 / P1-5 IC Diagnostic & Raw Alpha Spread Analysis
=======================================================
Computes:
  1. Daily Spearman IC between canonicalAlphaScore and realized 5D/20D excess return.
  2. IC by era / regime.
  3. IC IR = IC_mean / IC_std (annualized).
  4. Top-decile minus universe spread by era.
  5. Feature-family IC attribution (momentum, volatility, benchmark, oscillator, regime).
  6. Signal decay: IC at 5D and 20D horizons.
  7. Raw ranker top-1/3/5/10 spread BEFORE portfolio constraints (P1-5).

Outputs: packages/quant-engine/research/ic_diagnostic_report.json
Run from repo root: python packages/quant-engine/research/ic_diagnostic.py
"""
import os, sys, json
import numpy as np
import pandas as pd
from scipy import stats
from typing import Dict, List, Any

sys.path.append(os.path.abspath("packages/quant-engine"))

from features.feature_engine import FEATURE_NAMES
from backtest.long_history_walk_forward import LongHistoryResearchEngine, HISTORICAL_ERAS

FEATURE_FAMILIES = {
    "momentum":   ["momentum_5","momentum_20","ret_1d","ret_5d","ret_20d","roc_12","dist_52w_high","dist_52w_low"],
    "oscillator": ["rsi_14","macd_hist","stoch_k"],
    "ma_trend":   ["sma_20_dist","sma_50_dist","ema_20_dist"],
    "volatility": ["atr_percent","bb_width","annualized_volatility","downside_deviation","vol_20d","vol_60d"],
    "volume":     ["volume_z_score","rel_volume"],
    "benchmark":  ["beta_nifty","relative_strength_nifty","gap_pct"],
    "regime":     ["market_vol_regime","market_trend_60d","breadth_pct_above_20ma",
                   "vix_percentile_252d","cross_sec_vol_rank","adv_decline_ratio"],
}

def spearman_ic(scores, returns):
    valid = ~(np.isnan(scores) | np.isnan(returns))
    if valid.sum() < 5: return float("nan")
    r, _ = stats.spearmanr(scores[valid], returns[valid])
    return float(r)

def compute_daily_ic(oos_df, score_col="canonicalAlphaScore", horizon="5d"):
    ret_col = f"target_vol_std_excess_{horizon}"
    if ret_col not in oos_df.columns:
        return pd.Series(dtype=float)
    dc = "predictionTimestamp" if "predictionTimestamp" in oos_df.columns else "date"
    return pd.Series({dt: spearman_ic(g[score_col].values, g[ret_col].values)
                      for dt, g in oos_df.groupby(dc)}, name=f"IC_{horizon}")

def ic_stats(arr):
    valid = arr[~np.isnan(arr)]
    if len(valid) == 0:
        return {"mean": None, "std": None, "ir": None, "pct_positive": None, "n": 0}
    m = float(np.mean(valid))
    s = float(np.std(valid, ddof=1)) if len(valid) > 1 else float("nan")
    ir = (m / s * np.sqrt(252)) if s and s > 0 else None
    return {"mean": round(m, 5), "std": round(s, 5),
            "ir": round(float(ir), 3) if ir else None,
            "pct_positive": round(float(np.mean(valid > 0)), 3), "n": len(valid)}

def compute_ic_by_era(daily_ic_5d, daily_ic_20d):
    era_results = []
    idx5 = pd.to_datetime(daily_ic_5d.index)
    idx20 = pd.to_datetime(daily_ic_20d.index)
    for era in HISTORICAL_ERAS:
        if era["eraId"] == "ERA_8_FROZEN_HOLDOUT": continue
        s, e = pd.to_datetime(era["startDate"]), pd.to_datetime(era["endDate"])
        era_results.append({
            "eraId": era["eraId"], "name": era["name"],
            "ic_5d":  ic_stats(daily_ic_5d.values[(idx5>=s)&(idx5<=e)]),
            "ic_20d": ic_stats(daily_ic_20d.values[(idx20>=s)&(idx20<=e)]),
        })
    return era_results

def compute_feature_family_ic(oos_df, horizon="5d"):
    ret_col = f"target_vol_std_excess_{horizon}"
    if ret_col not in oos_df.columns: return {}
    dc = "predictionTimestamp" if "predictionTimestamp" in oos_df.columns else "date"
    out = {}
    for fam, feats in FEATURE_FAMILIES.items():
        avail = [f for f in feats if f in oos_df.columns]
        if not avail:
            out[fam] = {"n_features": 0, "mean_ic_5d": None}; continue
        feat_ics = []
        for feat in avail:
            vals = [spearman_ic(g[feat].values, g[ret_col].values)
                    for _, g in oos_df.groupby(dc)]
            vals = [v for v in vals if not np.isnan(v)]
            if vals: feat_ics.append(float(np.mean(vals)))
        out[fam] = {
            "n_features": len(avail), "features": avail,
            "mean_ic_5d": round(float(np.mean(feat_ics)), 5) if feat_ics else None,
            "pct_positive_ic": round(float(np.mean([x>0 for x in feat_ics])), 3) if feat_ics else None,
        }
    return out

def compute_top_fractile_spreads(oos_df, horizon="5d"):
    ret_col = f"target_vol_std_excess_{horizon}"
    if ret_col not in oos_df.columns: return []
    dc = "predictionTimestamp" if "predictionTimestamp" in oos_df.columns else "date"
    results = []
    for n in [1, 3, 5, 10]:
        spreads = []
        for _, g in oos_df.groupby(dc):
            if len(g) < n + 1: continue
            gs = g.sort_values("canonicalAlphaScore", ascending=False)
            s = gs[ret_col].iloc[:n].mean() - g[ret_col].mean()
            if not np.isnan(s): spreads.append(s)
        if spreads:
            arr = np.array(spreads)
            results.append({
                "fractile": f"Top-{n}", "n_days": len(arr),
                "mean_excess_vs_universe": round(float(np.mean(arr)), 5),
                "std": round(float(np.std(arr, ddof=1)), 5),
                "ir": round(float(np.mean(arr)/np.std(arr,ddof=1)*np.sqrt(252)), 3)
                       if np.std(arr) > 0 else None,
                "pct_positive": round(float(np.mean(arr > 0)), 3)
            })
    return results

def main():
    print("="*80)
    print("P0-3 / P1-5 IC DIAGNOSTIC & RAW ALPHA SPREAD ANALYSIS")
    print("="*80)
    engine = LongHistoryResearchEngine()
    engine.load_and_preprocess_panel()
    print("\n>>> Running Model B walk-forward for OOS predictions...")
    res_b = engine.run_walk_forward_evaluation("MODEL_B_LONG_EXPANDING")
    oos_df = res_b.get("oos_df", pd.DataFrame())
    if oos_df.empty:
        print("ERROR: No OOS data."); return

    print(f"\nOOS shape: {oos_df.shape}")
    print(">>> Computing daily IC (5D, 20D)...")
    daily_ic_5d = compute_daily_ic(oos_df, horizon="5d")
    daily_ic_20d = compute_daily_ic(oos_df, horizon="20d")

    print(">>> IC by era...")
    ic_by_era = compute_ic_by_era(daily_ic_5d, daily_ic_20d)

    print(">>> Feature-family IC attribution...")
    family_ic = compute_feature_family_ic(oos_df, horizon="5d")

    print(">>> Raw top-N fractile spreads (P1-5)...")
    frac5 = compute_top_fractile_spreads(oos_df, horizon="5d")
    frac20 = compute_top_fractile_spreads(oos_df, horizon="20d")

    vals5  = daily_ic_5d.dropna().values
    vals20 = daily_ic_20d.dropna().values

    overall = {
        "5d":  ic_stats(vals5),
        "20d": ic_stats(vals20),
    }

    report = {
        "description": "P0-3 IC Diagnostic + P1-5 Raw Alpha Spread (pre-2025 OOS only)",
        "oosRows": int(len(oos_df)),
        "overallIC": overall,
        "icByEra": ic_by_era,
        "featureFamilyIC": family_ic,
        "rawFractileSpreads5d": frac5,
        "rawFractileSpreads20d": frac20,
    }

    out = "packages/quant-engine/research/ic_diagnostic_report.json"
    with open(out, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"\n? Saved to {out}")
    print("\n-- Overall IC --------------------------------------")
    print(f"  5D  IC: mean={overall['5d']['mean']}  IR={overall['5d']['ir']}  pct+={overall['5d']['pct_positive']}")
    print(f"  20D IC: mean={overall['20d']['mean']}  IR={overall['20d']['ir']}  pct+={overall['20d']['pct_positive']}")
    print("\n-- IC by Era (5D) ---------------------------------")
    for e in ic_by_era:
        ic5 = e["ic_5d"]
        star = "?" if ic5["mean"] is not None and ic5["mean"] < 0 else "?"
        print(f"  {star} {e['name'][:50]:<50}: IC={ic5['mean']}  IR={ic5['ir']}")
    print("\n-- Feature Family IC (5D) -------------------------")
    for fam, info in family_ic.items():
        print(f"  {fam:<15}: mean_IC={info.get('mean_ic_5d')}  pct+={info.get('pct_positive_ic')}")
    print("\n-- Raw Top-N Spreads (5D, no constraints) ---------")
    for fs in frac5:
        print(f"  {fs['fractile']}: excess={fs['mean_excess_vs_universe']:+.5f}  IR={fs['ir']}")

if __name__ == "__main__":
    main()
