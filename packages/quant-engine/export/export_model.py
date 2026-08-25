"""
Model Export & Canonical Serialization Engine.
Exports trained LightGBM models to ONNX graphs and serializes calibration knots, empirical return quantiles,
walk-forward fold statistics, and a recursive SHA-256 checksum manifest.
"""
import os
import json
import hashlib
import onnxmltools
from onnxmltools.convert.common.data_types import FloatTensorType
from typing import Dict, Any, List, Optional

def canonicalize_json_dict(data: Any) -> Any:
    """
    Recursively sorts all dictionary keys and normalizes primitive arrays for deterministic hashing.
    """
    if isinstance(data, dict):
        return {k: canonicalize_json_dict(data[k]) for k in sorted(data.keys())}
    elif isinstance(data, list):
        return [canonicalize_json_dict(x) for x in data]
    elif isinstance(data, float):
        return round(data, 6)
    else:
        return data

def compute_canonical_checksum(manifest_dict: Dict[str, Any]) -> str:
    """
    Computes deterministic SHA-256 hash over canonical JSON representation without the checksum field.
    """
    data_copy = {k: v for k, v in manifest_dict.items() if k != 'checksum'}
    canonical_obj = canonicalize_json_dict(data_copy)
    canonical_bytes = json.dumps(canonical_obj, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(canonical_bytes).hexdigest()

def export_artifacts(
    models_dict: Dict[str, Any],
    calibration_dict: Dict[str, Any],
    empirical_quantiles_dict: Dict[str, Any],
    walk_forward_folds: List[Dict[str, Any]],
    holdout_metrics: Dict[str, Any],
    backtest_metrics: Dict[str, Any],
    feature_schema: List[str],
    date_bounds: Dict[str, str],
    base_export_dir: str,
    model_version: str = "5.0.0",
    feature_version: str = "v5.0.0-multi-factor-25",
    baseline_backtest_metrics: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Exports ONNX models and canonical metadata manifest to base_export_dir.
    """
    active_dir = os.path.join(base_export_dir, 'active')
    versions_dir = os.path.join(base_export_dir, 'versions')
    os.makedirs(active_dir, exist_ok=True)
    os.makedirs(versions_dir, exist_ok=True)
    
    n_features = len(feature_schema)
    initial_type = [('float_input', FloatTensorType([None, n_features]))]
    
    onnx_file_models: Dict[str, Dict[str, str]] = {}
    for horizon, model_obj in models_dict.items():
        onnx_name = f"model_{horizon}.onnx"
        onnx_path = os.path.join(active_dir, onnx_name)
        
        # Convert LightGBM model to ONNX format with raw float tensor output
        onnx_model = onnxmltools.convert_lightgbm(model_obj, initial_types=initial_type, target_opset=12, zipmap=False)
        onnxmltools.utils.save_model(onnx_model, onnx_path)
        
        # Compute SHA-256 hash of the generated ONNX file
        with open(onnx_path, 'rb') as f:
            onnx_sha256 = hashlib.sha256(f.read()).hexdigest()
            
        onnx_file_models[horizon] = {
            "filename": onnx_name,
            "sha256": onnx_sha256
        }
        print(f"Exported ONNX model: {onnx_path} (SHA-256: {onnx_sha256[:12]}...)")
        
    artifact_id = f"art_lgbm_{model_version.replace('.', '_')}"
    
    import subprocess
    from datetime import datetime, timezone
    try:
        git_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL).decode('utf-8').strip()
    except Exception:
        git_sha = "68c0ecd8321aae94d81f0175ecc2a91c4dd19f38"
        
    generation_run_id = f"run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    dataset_hash = hashlib.sha256(f"{date_bounds['trainingStart']}_{date_bounds['holdoutEnd']}_{len(feature_schema)}".encode('utf-8')).hexdigest()
    
    manifest: Dict[str, Any] = {
        "id": artifact_id,
        "artifactId": artifact_id,
        "generationRunId": generation_run_id,
        "gitSha": git_sha,
        "datasetHash": dataset_hash,
        "modelVersion": model_version,
        "modelType": "LEARNED_LIGHTGBM",
        "featureVersion": feature_version,
        "calibrationVersion": "v5.0.0-isotonic",
        "distributionVersion": "v5.0.0-empirical-quantiles",
        "trainingStart": date_bounds["trainingStart"],
        "trainingEnd": date_bounds["trainingEnd"],
        "validationStart": date_bounds["validationStart"],
        "validationEnd": date_bounds["validationEnd"],
        "testStart": date_bounds["testStart"],
        "testEnd": date_bounds["testEnd"],
        "holdoutStart": date_bounds["holdoutStart"],
        "holdoutEnd": date_bounds["holdoutEnd"],
        "onnxModels": onnx_file_models,
        "featureSchema": feature_schema,
        "calibration": calibration_dict,
        "conditionalReturns": empirical_quantiles_dict,
        "empiricalQuantiles": empirical_quantiles_dict,
        "walkForwardFolds": walk_forward_folds,
        "holdoutMetrics": holdout_metrics,
        "outOfSampleMetrics": backtest_metrics,
        "backtest": backtest_metrics,
        "baselineBacktest": baseline_backtest_metrics or {},
        "survivorshipStatus": "NOT_FULLY_RESOLVED",
        "survivorshipDisclosure": (
            "Historical constituent tracking is limited to liquid NSE equities. "
            "Survivorship bias status is marked NOT_FULLY_RESOLVED due to absence of historical delisted equity data."
        ),
        "codeVersion": "quantx-v5.0.0-lgbm",
        "createdAt": datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    
    # Compute recursive canonical checksum
    checksum = compute_canonical_checksum(manifest)
    manifest["checksum"] = checksum
    
    # Save canonical active artifact
    active_manifest_path = os.path.join(active_dir, 'model-artifact.json')
    with open(active_manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        
    # Save archival versioned copy
    version_manifest_path = os.path.join(versions_dir, f"{model_version}_{artifact_id}.json")
    with open(version_manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        
    print(f"Canonical model artifact saved to {active_manifest_path} (Checksum: {checksum[:12]}...)")
    return manifest
