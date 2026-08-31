"""
QuantX Runtime Parity Constants & Numerical Tolerances — BUG 5 Mandate.
Centralized thresholds for cross-language, cross-runtime deterministic equivalence.
"""

# Maximum allowable absolute error between Python LightGBM raw output and ONNX graph inference
MODEL_PARITY_TOLERANCE: float = 1e-5

# Maximum allowable absolute error between Python Isotonic Regression and NestJS Calibration Engine
CALIBRATION_PARITY_TOLERANCE: float = 1e-6

# Maximum allowable numerical discrepancy in monetary accounting and equity curve calculations
ACCOUNTING_TOLERANCE: float = 1e-8

import os
import json

# Strict feature schema enforcement: zero tolerance for disordered or missing feature keys
SCHEMA_EXACT: bool = True

_SCHEMA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'canonical_features.json')
if os.path.exists(_SCHEMA_FILE):
    with open(_SCHEMA_FILE, 'r', encoding='utf-8') as _f:
        _loaded_schema = json.load(_f)
        CANONICAL_FEATURE_SCHEMA = _loaded_schema.get('features', [])
        CANONICAL_FEATURE_COUNT: int = len(CANONICAL_FEATURE_SCHEMA)
else:
    CANONICAL_FEATURE_COUNT: int = 25
    CANONICAL_FEATURE_SCHEMA = [
        'rsi_14',
        'macd_hist',
        'sma_20_dist',
        'sma_50_dist',
        'ema_20_dist',
        'atr_percent',
        'bb_width',
        'stoch_k',
        'volume_z_score',
        'annualized_volatility',
        'downside_deviation',
        'beta_nifty',
        'relative_strength_nifty',
        'momentum_5',
        'momentum_20',
        'ret_1d',
        'ret_5d',
        'ret_20d',
        'gap_pct',
        'dist_52w_high',
        'dist_52w_low',
        'roc_12',
        'rel_volume',
        'vol_20d',
        'vol_60d',
    ]
