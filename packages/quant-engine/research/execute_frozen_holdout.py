"""
Cryptographically Sealed Holdout Execution Enforcer (Fold 8: 2025-2026)
========================================================================
Solves P0: Technically Enforced Cryptographic Holdout Freeze.

Guarantees:
1. Single-Shot Execution Lock: Checks holdout_execution_certificate.json. If already
   executed and sealed (SEALED_IMMUTABLE), immediately aborts with HoldoutAlreadyExecutedError.
2. Code & Config Integrity: Verifies protocol_manifest.json and asserts SHA-256 matches.
   Any tampering or post-freeze code modification raises HoldoutIntegrityError.
3. Pre-Registered Strategy Binding: Executes the certified production strategy determined
   by the pre-2025 development protocol (or the robust anchor 'vol_adj_net_excess').
4. Comprehensive Holdout Audit: Evaluates 20D (primary) and 5D (secondary) Top-3 economic
   alpha across Fold 8 out-of-sample data, recording full metrics and sealing the certificate.
"""
import sys
import os
import json
import hashlib
from datetime import datetime
from typing import Dict, List, Any, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backtest.long_history_walk_forward import (
    LongHistoryResearchEngine,
    WALK_FORWARD_FOLDS,
    FEATURE_NAMES
)
from models.alpha_ranker import RegimeConditionedAlphaRanker
from backtest.top3_alpha_evaluator import Top3AlphaEvaluator
from research.protocol_manifest_guard import (
    verify_protocol_integrity,
    compute_monitored_code_hashes,
    get_repo_quant_root,
    ProtocolIntegrityError
)

CERTIFICATE_FILENAME = "holdout_execution_certificate.json"
MANIFEST_FILENAME = "protocol_manifest.json"

class HoldoutAlreadyExecutedError(Exception):
    """Raised when holdout execution is attempted after it has already been sealed."""
    pass

class HoldoutIntegrityError(Exception):
    """Raised when holdout execution integrity check fails."""
    pass

def execute_frozen_holdout(force_override_for_testing: bool = False) -> Dict[str, Any]:
    quant_root = get_repo_quant_root()
    research_dir = os.path.join(quant_root, "research")
    cert_path = os.path.join(research_dir, CERTIFICATE_FILENAME)
    manifest_path = os.path.join(research_dir, MANIFEST_FILENAME)
    
    print("=" * 105)
    print("FROZEN HOLDOUT EXECUTION ENFORCER: FOLD 8 (2025-01-01 TO 2026-02-13)")
    print("=" * 105)
    
    # -------------------------------------------------------------------------
    # Gate 1: Check Execution Lock (Single-Shot Enforcement)
    # -------------------------------------------------------------------------
    if os.path.exists(cert_path) and not force_override_for_testing:
        with open(cert_path, "r") as f:
            existing_cert = json.load(f)
        if existing_cert.get("lockStatus") == "SEALED_IMMUTABLE":
            raise HoldoutAlreadyExecutedError(
                f"CRITICAL VIOLATION: Holdout Fold 8 has ALREADY been executed and sealed (Status: SEALED_IMMUTABLE) on "
                f"{existing_cert.get('executionTimestamp')}. "
                f"Certificate Digest: {existing_cert.get('certificateDigest')}. "
                f"Re-execution, parameter tuning, or repeated evaluation of the frozen holdout "
                f"is strictly prohibited under institutional quant governance."
            )
            
    # -------------------------------------------------------------------------
    # Gate 2: Cryptographic Code & Config Integrity Check
    # -------------------------------------------------------------------------
    print("\n[Gate 1/2] Verifying cryptographic code & protocol integrity against manifest...")
    try:
        manifest = verify_protocol_integrity(manifest_path, quant_root)
    except ProtocolIntegrityError as e:
        raise HoldoutIntegrityError(f"Holdout Execution Blocked: {e}")
        
    protocol_digest = manifest.get("protocolDigest")
    print(f"  Verified! Protocol Digest: {protocol_digest}")
    print(f"  Monitored code files: {len(manifest.get('monitoredCodeHashes', {}))} files verified bitwise identical.")
    
    # -------------------------------------------------------------------------
    # Gate 3: Identify Certified Production Strategy
    # -------------------------------------------------------------------------
    pre2025_nested = manifest.get("pre2025NestedResults") or {}
    certified_strategy = pre2025_nested.get("certifiedProductionStrategy", "vol_adj_net_excess")
    print(f"\n[Gate 2/2] Pre-registered Certified Strategy for Execution: '{certified_strategy}'")
    
    # -------------------------------------------------------------------------
    # Execution: Load Data & Train Strictly on Fold 8 Train Split
    # -------------------------------------------------------------------------
    engine = LongHistoryResearchEngine()
    panel_df = engine.load_and_preprocess_panel()
    evaluator = Top3AlphaEvaluator()
    
    fold_8 = [f for f in WALK_FORWARD_FOLDS if f["foldIndex"] == 8]
    if not fold_8:
        raise ValueError("Fold 8 not found in WALK_FORWARD_FOLDS!")
    f8 = fold_8[0]
    
    tr_start, tr_end = f8["trainStart"], f8["trainEnd"]
    te_start, te_end = f8["testStart"], f8["testEnd"]
    
    train_mask = (panel_df["predictionTimestamp"] >= tr_start) & (panel_df["predictionTimestamp"] <= tr_end)
    test_mask = (panel_df["predictionTimestamp"] >= te_start) & (panel_df["predictionTimestamp"] <= te_end)
    
    train_df = panel_df[train_mask]
    test_df = panel_df[test_mask]
    
    print(f"\nExecuting Single-Shot Evaluation on Fold 8:")
    print(f"  Training Split : {tr_start} to {tr_end} ({len(train_df):,} obs)")
    print(f"  Holdout Split  : {te_start} to {te_end} ({len(test_df):,} obs across {len(test_df['predictionTimestamp'].unique())} days)")
    
    # 1. Primary Horizon (20D)
    print("\nTraining Primary 20D Alpha Ranker...")
    ranker_20d = RegimeConditionedAlphaRanker(horizon_str="20d", target_type=certified_strategy)
    ranker_20d.fit(train_df, features=FEATURE_NAMES)
    preds_20d = ranker_20d.predict(test_df, features=FEATURE_NAMES)
    preds_20d["foldIndex"] = 8
    ev_20d = evaluator.evaluate_top3_alpha(
        preds_20d, engine.historical_candles, engine.benchmark_df, horizon="20d"
    )
    
    # 2. Secondary Horizon (5D)
    print("Training Secondary 5D Alpha Ranker...")
    ranker_5d = RegimeConditionedAlphaRanker(horizon_str="5d", target_type=certified_strategy)
    ranker_5d.fit(train_df, features=FEATURE_NAMES)
    preds_5d = ranker_5d.predict(test_df, features=FEATURE_NAMES)
    preds_5d["foldIndex"] = 8
    ev_5d = evaluator.evaluate_top3_alpha(
        preds_5d, engine.historical_candles, engine.benchmark_df, horizon="5d"
    )
    
    # -------------------------------------------------------------------------
    # Package Execution Certificate & Seal
    # -------------------------------------------------------------------------
    exec_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    current_hashes = compute_monitored_code_hashes(quant_root)
    
    metrics_20d = {
        "meanExcessPct": ev_20d["hitRates20d"]["meanExcessReturnPct"],
        "top3HitRateVsNifty": ev_20d["hitRates20d"]["top3PortfolioHitRateVsNifty"],
        "top1HitRateVsNifty": ev_20d["hitRates20d"]["top1HitRateVsNifty"],
        "sharpe": ev_20d["backtestMetrics"]["sharpe"],
        "sortino": ev_20d["backtestMetrics"]["sortino"],
        "cagr": ev_20d["backtestMetrics"]["cagr"],
        "maxDrawdown": ev_20d["backtestMetrics"]["maxDrawdown"],
        "annualTurnoverEstPct": ev_20d["backtestMetrics"]["annualTurnoverEstPct"],
        "profitFactor": ev_20d["backtestMetrics"]["profitFactor"],
        "evaluationDays": ev_20d["evaluationDaysCount"],
        "monotonicDecileSpread": ev_20d.get("fractileSpreadAnalysis", {}).get("top10vsUniverseSpread20d", 0.0),
        "hacInference": ev_20d["statisticalInference"].get("hac20d", {})
    }
    
    metrics_5d = {
        "meanExcessPct": ev_5d["hitRates5d"]["meanExcessReturnPct"],
        "top3HitRateVsNifty": ev_5d["hitRates5d"]["top3PortfolioHitRateVsNifty"],
        "top1HitRateVsNifty": ev_5d["hitRates5d"]["top1HitRateVsNifty"],
        "sharpe": ev_5d["backtestMetrics"]["sharpe"],
        "sortino": ev_5d["backtestMetrics"]["sortino"],
        "cagr": ev_5d["backtestMetrics"]["cagr"],
        "maxDrawdown": ev_5d["backtestMetrics"]["maxDrawdown"],
        "annualTurnoverEstPct": ev_5d["backtestMetrics"]["annualTurnoverEstPct"],
        "profitFactor": ev_5d["backtestMetrics"]["profitFactor"],
        "evaluationDays": ev_5d["evaluationDaysCount"],
        "monotonicDecileSpread": ev_5d.get("fractileSpreadAnalysis", {}).get("top10vsUniverseSpread5d", 0.0),
        "hacInference": ev_5d["statisticalInference"].get("hac5d", {})
    }
    
    cert_body = {
        "certificateType": "QUANTX_CRYPTO_SEALED_HOLDOUT_EXECUTION",
        "lockStatus": "SEALED_IMMUTABLE",
        "executionTimestamp": exec_timestamp,
        "protocolManifestDigest": protocol_digest,
        "holdoutPeriod": {
            "foldIndex": 8,
            "startDate": te_start,
            "endDate": te_end
        },
        "certifiedProductionStrategy": certified_strategy,
        "metrics20d": metrics_20d,
        "metrics5d": metrics_5d,
        "verifiedCodeHashes": current_hashes,
        "governanceAttestation": (
            "This execution certificate is cryptographically locked and final. "
            "It was generated from a single evaluation run following the pre-registered "
            "protocol manifest. No post-hoc tuning or re-execution is permitted."
        )
    }
    
    cert_canonical_str = json.dumps(cert_body, sort_keys=True)
    cert_digest = hashlib.sha256(cert_canonical_str.encode("utf-8")).hexdigest()
    cert_body["certificateDigest"] = cert_digest
    
    def _json_serial(obj):
        import numpy as np
        if isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        if isinstance(obj, (np.integer, int)):
            return int(obj)
        if isinstance(obj, (np.floating, float)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return str(obj)
        
    with open(cert_path, "w") as f:
        json.dump(cert_body, f, indent=2, default=_json_serial)
        
    print("\n" + "=" * 105)
    print("HOLDOUT EXECUTION COMPLETED & CRYPTOGRAPHICALLY SEALED")
    print("=" * 105)
    print(f"Certificate Path   : {cert_path}")
    print(f"Certificate Digest : {cert_digest}")
    print(f"Lock Status        : SEALED_IMMUTABLE")
    print("-" * 105)
    print(f"{'Metric':<30} | {'20D Primary Strategy':<25} | {'5D Secondary Strategy':<25}")
    print("-" * 105)
    print(f"{'Mean Net Excess vs NIFTY':<30} | {metrics_20d['meanExcessPct']:>+8.3f}%                | {metrics_5d['meanExcessPct']:>+8.3f}%")
    print(f"{'Annualized Sharpe Ratio':<30} | {metrics_20d['sharpe']:>8.2f}                 | {metrics_5d['sharpe']:>8.2f}")
    print(f"{'Annualized Sortino Ratio':<30} | {metrics_20d['sortino']:>8.2f}                 | {metrics_5d['sortino']:>8.2f}")
    print(f"{'Annualized CAGR':<30} | {metrics_20d['cagr']:>7.2f}%                 | {metrics_5d['cagr']:>7.2f}%")
    print(f"{'Maximum Drawdown':<30} | {metrics_20d['maxDrawdown']:>7.2f}%                 | {metrics_5d['maxDrawdown']:>7.2f}%")
    print(f"{'Top-3 Portfolio Win Rate':<30} | {metrics_20d['top3HitRateVsNifty']:>7.1f}%                 | {metrics_5d['top3HitRateVsNifty']:>7.1f}%")
    print(f"{'Annual Turnover Est':<30} | {metrics_20d['annualTurnoverEstPct']:>7.1f}%                 | {metrics_5d['annualTurnoverEstPct']:>7.1f}%")
    print(f"{'Monotonic Decile Spread (D10-D1)':<30} | {metrics_20d['monotonicDecileSpread']:>+8.3f}%                | {metrics_5d['monotonicDecileSpread']:>+8.3f}%")
    print(f"{'HAC t-Statistic':<30} | {metrics_20d['hacInference'].get('tStat', 0.0):>8.2f}                 | {metrics_5d['hacInference'].get('tStat', 0.0):>8.2f}")
    print(f"{'HAC 95% Confidence Interval':<30} | [{metrics_20d['hacInference'].get('ci95Lower', 0.0):+.2f}%, {metrics_20d['hacInference'].get('ci95Upper', 0.0):+.2f}%]   | [{metrics_5d['hacInference'].get('ci95Lower', 0.0):+.2f}%, {metrics_5d['hacInference'].get('ci95Upper', 0.0):+.2f}%]")
    print("=" * 105)
    
    return cert_body

if __name__ == "__main__":
    execute_frozen_holdout()
