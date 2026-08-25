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
    Enforces sampleCount >= 100. Returns None and INSUFFICIENT_DATA for all fields when sampleCount < 100.
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
            'conditional_gain': None,
            'conditional_loss': None,
            'fittedStart': start_date,
            'fittedEnd': end_date,
            'fitEndTimestamp': end_date,
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
    
    pos_ret = returns[returns > 0]
    neg_ret = returns[returns < 0]
    cond_gain = float(round(np.mean(pos_ret), 4)) if len(pos_ret) > 0 else p85
    cond_loss = float(round(abs(np.mean(neg_ret)), 4)) if len(neg_ret) > 0 else abs(p15)
    
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
        'conditional_gain': cond_gain,
        'conditional_loss': cond_loss,
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
        Fits empirical conditional distribution for a specific horizon using only historical data strictly preceding fit_end_timestamp.
        SEMANTIC CONTRACT:
        1. Convert predictionTimestamp to pandas datetime.
        2. Convert fit_end_timestamp to pandas Timestamp.
        3. Create eligible_df = history_df[predictionTimestamp < fit_end_timestamp]
        4. If eligible_df is empty: return without fitting.
        5. FIT ONLY on eligible_df.
        6. Compute actualFitStart = min(predictionTimestamp of eligible_df)
        7. Compute actualFitEnd = max(predictionTimestamp of eligible_df)
        8. Store: fittedStart = actualFitStart, fittedEnd = actualFitEnd, fitEndTimestamp = actualFitEnd
        9. Assert: actualFitEnd < fit_end_timestamp
        10. If ANY row used in the fit has predictionTimestamp >= fit_end_timestamp, raise LeakageError.
        """
        if history_df is None or history_df.empty or not fit_end_timestamp:
            return
            
        df = history_df.copy()
        if 'predictionTimestamp' in df.columns:
            df['dt'] = pd.to_datetime(df['predictionTimestamp'])
        elif isinstance(df.index, pd.DatetimeIndex):
            df['dt'] = df.index
        elif 'date' in df.columns:
            df['dt'] = pd.to_datetime(df['date'])
        else:
            df['dt'] = pd.to_datetime(df.index)
            
        fit_end_ts = pd.Timestamp(str(fit_end_timestamp)[:10])
        
        # 3. Create eligible_df strictly before fit_end_timestamp
        eligible_df = df[df['dt'] < fit_end_ts].copy()
        
        # 4. If empty: return without fitting
        if eligible_df.empty:
            return
            
        # 6 & 7. Compute actualFitStart and actualFitEnd
        actual_fit_start = str(eligible_df['dt'].min())[:10]
        actual_fit_end = str(eligible_df['dt'].max())[:10]
        
        # 9 & 10. Causal Invariant Assertions
        if pd.Timestamp(actual_fit_end) >= fit_end_ts:
            raise LeakageError(f"CRITICAL CAUSAL LEAKAGE: actualFitEnd ({actual_fit_end}) >= fit_end_timestamp ({fit_end_timestamp})")
            
        if (eligible_df['dt'] >= fit_end_ts).any():
            raise LeakageError(f"CRITICAL CAUSAL LEAKAGE: eligible_df contains rows on/after fit_end_timestamp ({fit_end_timestamp})")
            
        # 5. Fit ONLY on eligible_df
        self._fit_horizon_data(eligible_df, horizon, actual_fit_start, actual_fit_end)

    def _fit_horizon_data(self, df: pd.DataFrame, h: str, start_date: str, end_date: str):
        h_days = 1 if h == '1d' else (5 if h == '5d' else 20)
        ret_col = f'actual_net_return_{h}'
        if ret_col not in df.columns:
            ret_col = f'future_net_ret_{h_days}d'
        if ret_col not in df.columns:
            return
            
        h_df = df.dropna(subset=[ret_col]).copy()
        if h_df.empty:
            return
            
        # 1. Horizon-Wide Fallback (Only requires return column)
        h_returns = h_df[ret_col].values
        self.tables[h]['HORIZON_WIDE'] = compute_distribution_metrics(h_returns, 'HORIZON_WIDE_FALLBACK', start_date, end_date)
        
        # 2. Probability Buckets (if probability column available)
        prob_col = 'calibratedProbability' if 'calibratedProbability' in h_df.columns else ('pred_prob' if 'pred_prob' in h_df.columns else None)
        if prob_col:
            h_df_prob = h_df.dropna(subset=[prob_col]).copy()
            if not h_df_prob.empty:
                h_df_prob['prob_bucket'] = h_df_prob[prob_col].apply(get_bucket_name)
                for bucket_name, group in h_df_prob.groupby('prob_bucket'):
                    self.tables[h][f"PROB_{bucket_name}"] = compute_distribution_metrics(group[ret_col].values, 'PROBABILITY_BUCKET', start_date, end_date)
                    
                # 3. Probability + Regime Buckets (if regime column available)
                if 'regime' in h_df_prob.columns:
                    for (b_name, reg), group in h_df_prob.groupby(['prob_bucket', 'regime']):
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
        if pr_key in h_table and h_table[pr_key]['method'] == 'PROBABILITY_REGIME_BUCKET' and h_table[pr_key]['sampleCount'] >= MIN_BUCKET_SAMPLE_COUNT:
            return h_table[pr_key]
            
        # 2. Try Probability Bucket
        p_key = f"PROB_{bucket_name}"
        if p_key in h_table and h_table[p_key]['method'] == 'PROBABILITY_BUCKET' and h_table[p_key]['sampleCount'] >= MIN_BUCKET_SAMPLE_COUNT:
            return h_table[p_key]
            
        # 3. Try Regime-Wide Fallback
        r_key = f"REGIME_{regime}"
        if r_key in h_table and h_table[r_key]['method'] == 'REGIME_BUCKET' and h_table[r_key]['sampleCount'] >= MIN_BUCKET_SAMPLE_COUNT:
            return h_table[r_key]

        # 4. Try Horizon-Wide Fallback
        if 'HORIZON_WIDE' in h_table and h_table['HORIZON_WIDE']['method'] == 'HORIZON_WIDE_FALLBACK' and h_table['HORIZON_WIDE']['sampleCount'] >= MIN_BUCKET_SAMPLE_COUNT:
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
            'conditional_gain': None,
            'conditional_loss': None,
            'fittedStart': "",
            'fittedEnd': "",
            'fitEndTimestamp': "",
            'method': 'INSUFFICIENT_DATA'
        }
        
    def to_dict(self) -> Dict[str, Any]:
        return self.tables