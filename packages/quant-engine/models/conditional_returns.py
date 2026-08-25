"""
Empirical Conditional Return Distribution Engine.
Fits return quantiles (15th, 50th, 85th percentiles) conditioned on model state (calibrated probability buckets,
market regime, horizon) with strict sample-size gating (N >= 15) and hierarchical fallback.
"""
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple

class LeakageError(Exception):
    """Raised when causal data lineage or point-in-time invariant is violated."""
    pass

MIN_BUCKET_SAMPLE_COUNT = 100

PROBABILITY_BUCKETS: List[Tuple[str, float, float]] = [
    ('DOWNSIDE_LOW', 0.00, 0.35),
    ('DOWNSIDE_MID', 0.35, 0.45),
    ('NEUTRAL_DOWN', 0.45, 0.50),
    ('NEUTRAL_UP', 0.50, 0.55),
    ('MODERATE_BULL', 0.55, 0.65),
    ('STRONG_BULL', 0.65, 0.75),
    ('HIGH_CONVICTION_BULL', 0.75, 1.01),
]

def verify_causal_invariance(prediction_timestamp: str, fit_end_timestamp: str) -> None:
    """
    Enforces distributionFitEndTimestamp < predictionTimestamp.
    Raises LeakageError if any future return data contaminated the prediction.
    """
    if not fit_end_timestamp or not prediction_timestamp:
        return
    p_ts = str(prediction_timestamp)[:10]
    f_ts = str(fit_end_timestamp)[:10]
    if f_ts >= p_ts:
        raise LeakageError(
            f"CRITICAL CAUSAL LEAKAGE: distributionFitEndTimestamp ({f_ts}) >= predictionTimestamp ({p_ts})"
        )

def get_bucket_name(prob: float) -> str:
    prob = float(np.clip(prob, 0.0, 1.0))
    for name, low, high in PROBABILITY_BUCKETS:
        if low <= prob < high or (high >= 1.0 and prob == 1.0):
            return name
    return 'NEUTRAL_UP'

def compute_distribution_metrics(returns: np.ndarray, method_name: str, start_date: str = "", end_date: str = "") -> Dict[str, Any]:
    """
    Computes empirical quantiles and statistical parameters for a sample of forward returns.
    """
    returns = np.asarray(returns, dtype=float)
    returns = returns[~np.isnan(returns)]
    n = len(returns)
    
    if n < MIN_BUCKET_SAMPLE_COUNT:
        return {
            'sampleCount': n,
            'p15': None,
            'p50': None,
            'p85': None,
            'mean': None,
            'median': None,
            'std': None,
            'standardError': None,
            'confidenceInterval': None,
            'fittedStart': start_date,
            'fittedEnd': end_date,
            'method': 'INSUFFICIENT_DATA'
        }
        
    p15 = float(round(np.percentile(returns, 15), 4))
    p50 = float(round(np.percentile(returns, 50), 4))
    p85 = float(round(np.percentile(returns, 85), 4))
    mean_val = float(round(np.mean(returns), 4))
    median_val = float(round(np.median(returns), 4))
    std_val = float(round(np.std(returns, ddof=1) if n > 1 else 0.0, 4))
    se_val = float(round(std_val / np.sqrt(n), 4)) if n > 0 else 0.0
    ci = [float(round(mean_val - 1.96 * se_val, 4)), float(round(mean_val + 1.96 * se_val, 4))]
    
    return {
        'sampleCount': n,
        'p15': p15,
        'p50': p50,
        'p85': p85,
        'mean': mean_val,
        'median': median_val,
        'std': std_val,
        'standardError': se_val,
        'confidenceInterval': ci,
        'fittedStart': start_date,
        'fittedEnd': end_date,
        'fitEndTimestamp': end_date,
        'method': method_name
    }

class ConditionalReturnEngine:
    def __init__(self):
        # Structure: horizon -> bucket_key -> metrics
        self.tables: Dict[str, Dict[str, Any]] = {
            '1d': {},
            '5d': {},
            '20d': {}
        }
        
    def fit_from_oos_predictions(self, oos_data: Any):
        """
        Fits empirical conditional distributions from out-of-sample prediction and outcome ledger.
        """
        if isinstance(oos_data, dict):
            for h, df in oos_data.items():
                if df.empty:
                    continue
                start_date = str(df['predictionTimestamp'].min())[:10] if 'predictionTimestamp' in df.columns else ""
                end_date = str(df['predictionTimestamp'].max())[:10] if 'predictionTimestamp' in df.columns else ""
                self._fit_horizon_data(df, h, start_date, end_date)
            return

        oos_df = oos_data
        if oos_df.empty:
            return
            
        start_date = str(oos_df['predictionTimestamp'].min())[:10] if 'predictionTimestamp' in oos_df.columns else ""
        end_date = str(oos_df['predictionTimestamp'].max())[:10] if 'predictionTimestamp' in oos_df.columns else ""
        
        for h in ['1d', '5d', '20d']:
            self._fit_horizon_data(oos_df, h, start_date, end_date)

    def fit_horizon_causal(self, horizon: str, history_df: pd.DataFrame, fit_end_timestamp: str):
        """
        Fits empirical conditional distribution for a specific horizon using only historical data up to fit_end_timestamp.
        """
        if history_df.empty:
            return
        start_date = str(history_df['predictionTimestamp'].min())[:10] if 'predictionTimestamp' in history_df.columns else ""
        end_date = str(fit_end_timestamp)[:10]
        self._fit_horizon_data(history_df, horizon, start_date, end_date)

    def _fit_horizon_data(self, df: pd.DataFrame, h: str, start_date: str, end_date: str):
        h_days = 1 if h == '1d' else (5 if h == '5d' else 20)
        ret_col = f'actual_net_return_{h}'
        if ret_col not in df.columns:
            ret_col = f'future_net_ret_{h_days}d'
        if ret_col not in df.columns:
            return
            
        h_df = df.dropna(subset=[ret_col, 'calibratedProbability']).copy()
        if h_df.empty:
            return
            
        # 1. Horizon-Wide Fallback
        h_returns = h_df[ret_col].values
        self.tables[h]['HORIZON_WIDE'] = compute_distribution_metrics(h_returns, 'HORIZON_WIDE_FALLBACK', start_date, end_date)
        
        # 2. Probability Buckets
        h_df['prob_bucket'] = h_df['calibratedProbability'].apply(get_bucket_name)
        for bucket_name, group in h_df.groupby('prob_bucket'):
            self.tables[h][f"PROB_{bucket_name}"] = compute_distribution_metrics(group[ret_col].values, 'PROBABILITY_BUCKET', start_date, end_date)
            
        # 3. Probability + Regime Buckets (if regime column available)
        if 'regime' in h_df.columns:
            for (b_name, reg), group in h_df.groupby(['prob_bucket', 'regime']):
                self.tables[h][f"PROB_REGIME_{b_name}_{reg}"] = compute_distribution_metrics(
                    group[ret_col].values, 'PROBABILITY_REGIME_BUCKET', start_date, end_date
                )
                    
    def get_distribution(self, horizon: str, prob: float, regime: str = 'SIDEWAYS') -> Dict[str, Any]:
        """
        Retrieves empirical conditional return distribution following strict fallback hierarchy:
        1. Probability + Regime Bucket
        2. Probability Bucket
        3. Horizon-Wide Fallback
        4. Insufficient Data
        """
        h_table = self.tables.get(horizon, {})
        bucket_name = get_bucket_name(prob)
        
        # 1. Try Probability + Regime
        pr_key = f"PROB_REGIME_{bucket_name}_{regime}"
        if pr_key in h_table and h_table[pr_key]['method'] == 'PROBABILITY_REGIME_BUCKET':
            return h_table[pr_key]
            
        # 2. Try Probability Bucket
        p_key = f"PROB_{bucket_name}"
        if p_key in h_table and h_table[p_key]['method'] == 'PROBABILITY_BUCKET':
            return h_table[p_key]
            
        # 3. Try Regime-Wide Fallback
        r_key = f"REGIME_{regime}"
        if r_key in h_table and h_table[r_key]['method'] == 'REGIME_BUCKET':
            return h_table[r_key]

        # 4. Try Horizon-Wide Fallback
        if 'HORIZON_WIDE' in h_table and h_table['HORIZON_WIDE']['method'] == 'HORIZON_WIDE_FALLBACK':
            return h_table['HORIZON_WIDE']
            
        # 5. Strictly Insufficient Data (Zero fabricated numbers)
        return {
            'sampleCount': 0,
            'p15': None,
            'p50': None,
            'p85': None,
            'mean': None,
            'median': None,
            'std': None,
            'standardError': None,
            'confidenceInterval': None,
            'fittedStart': "",
            'fittedEnd': "",
            'fitEndTimestamp': "",
            'method': 'INSUFFICIENT_DATA'
        }
        
    def to_dict(self) -> Dict[str, Any]:
        return self.tables