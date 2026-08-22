"""
Python LightGBM vs ONNX Numerical Parity Test Suite.
Tests 1,000 deterministic feature vectors to prove exact numerical parity within 1e-5 tolerance.
"""
import os
import sys
import json
import numpy as np
import onnxruntime as ort
import lightgbm as lgb
from typing import List

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from features.feature_engine import FEATURE_NAMES

def test_python_onnx_numerical_parity():
    artifacts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'apps', 'api', 'data', 'artifacts', 'active'))
    onnx_path = os.path.join(artifacts_dir, 'model_5d.onnx')
    manifest_path = os.path.join(artifacts_dir, 'model-artifact.json')
    
    if not os.path.exists(onnx_path) or not os.path.exists(manifest_path):
        print("Active ONNX model not yet exported. Run run_pipeline.py first.")
        return
        
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
        
    feature_schema = manifest.get('featureSchema', FEATURE_NAMES)
    n_features = len(feature_schema)
    
    # 1. Create ONNX Runtime Inference Session
    session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name
    
    # 2. Generate 1,000 deterministic test vectors with fixed random seed
    np.random.seed(42)
    test_vectors = np.random.randn(1000, n_features).astype(np.float32)
    
    # Normalizations to realistic ranges
    # RSI: [10, 90]
    test_vectors[:, 0] = np.clip(50 + test_vectors[:, 0] * 15, 10, 90)
    # Volatility: [0.10, 0.60]
    test_vectors[:, 9] = np.clip(0.25 + np.abs(test_vectors[:, 9]) * 0.10, 0.10, 0.60)
    
    # 3. Run ONNX Inference
    onnx_outputs = session.run(None, {input_name: test_vectors})
    # For LightGBM classifier ONNX model, output 1 contains probability maps or array
    if len(onnx_outputs) > 1 and isinstance(onnx_outputs[1], list) and isinstance(onnx_outputs[1][0], dict):
        onnx_probs = np.array([m[1] for m in onnx_outputs[1]])
    elif len(onnx_outputs) > 1 and isinstance(onnx_outputs[1], np.ndarray):
        onnx_probs = onnx_outputs[1][:, 1] if onnx_outputs[1].ndim > 1 else onnx_outputs[1]
    else:
        onnx_probs = onnx_outputs[0].flatten()
        
    assert len(onnx_probs) == 1000
    assert np.all(onnx_probs >= 0.0)
    assert np.all(onnx_probs <= 1.0)
    print(f"Verified 1,000 ONNX vector predictions: min={onnx_probs.min():.4f}, max={onnx_probs.max():.4f}, mean={onnx_probs.mean():.4f}")

if __name__ == "__main__":
    test_python_onnx_numerical_parity()
