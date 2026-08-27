import os
import sys
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from quant_governance_config import MIN_RETURN_BUCKET_SAMPLE_COUNT, MIN_TAIL_SAMPLE_COUNT

class LeakageError(Exception):
    """Raised when causal data lineage or point-in-time invariant is violated."""
    pass

class HorizonMismatchError(Exception):
    """Raised when a conditional return engine receives a request for a different horizon."""
    pass

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

def calculate_block_bootstrap(returns: np.ndarray, block_size: int = 5, n_boot: int = 1000) -> Dict[str, Any]:
    """
    Computes dependence-aware confidence intervals using moving date-block bootstrap (Section AB).
    """
    returns = np.asarray(returns, dtype=float)
    returns = returns[~np.isnan(returns)]
    n = len(returns)
    if n < 10:
        return {
            'CI_low': None,
            'CI_high': None,
            'effectiveSampleSize': n,
            'bootstrapSamples': 0,
            'bootstrapMethod': 'BLOCK_BOOTSTRAP_DATE'
        }
        
    n_blocks = max(1, int(np.ceil(n / block_size)))
    means = []
    np.random.seed(42)
    for _ in range(n_boot):
        starts = np.random.randint(0, max(1, n - block_size + 1), size=n_blocks)
        sample = []
        for s in starts:
            sample.extend(returns[s:s+block_size])
        sample_arr = np.array(sample[:n])
        means.append(np.mean(sample_arr))
        
    ci_low = float(round(np.percentile(means, 2.5), 4))
    ci_high = float(round(np.percentile(means, 97.5), 4))
    eff_n = int(round(n / (1.0 + 2.0 * 0.15)))
    return {
        'CI_low': ci_low,
        'CI_high': ci_high,
        'effectiveSampleSize': eff_n,
        'bootstrapSamples': n_boot,
        'bootstrapMethod': 'BLOCK_BOOTSTRAP_DATE'
    }

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
    
    if n < MIN_RETURN_BUCKET_SAMPLE_COUNT:
        return {
            'sampleCount': n,
            'p10': None,
            'p15': None,
            'p25': None,
            'p50': None,
            'p75': None,
            'p85': None,
            'p90': None,
            'mean': None,
            'median': None,
            'std': None,
            'standardError': None,
            'confidenceInterval': None,
            'conditional_gain': None,
            'conditional_loss': None,
            'bootstrapMethod': 'BLOCK_BOOTSTRAP_DATE',
            'bootstrapSamples': 0,
            'effectiveSampleSize': n,
            'CI_low': None,
            'CI_high': None,
            'fittedStart': start_date,
            'fittedEnd': end_date,
            'fitEndTimestamp': end_date,
            'method': 'INSUFFICIENT_DATA'
        }
        
    p10 = float(round(np.percentile(returns, 10), 4))
    p15 = float(round(np.percentile(returns, 15), 4))
    p25 = float(round(np.percentile(returns, 25), 4))
    p50 = float(round(np.percentile(returns, 50), 4))
    p75 = float(round(np.percentile(returns, 75), 4))
    p85 = float(round(np.percentile(returns, 85), 4))
    p90 = float(round(np.percentile(returns, 90), 4))

    # Section 16 & 60: Strict non-crossing quantile invariant
    if not (p10 <= p15 <= p25 <= p50 <= p75 <= p85 <= p90):
        raise LeakageError(f"QUANTILE_INVALID: Crossing quantiles detected [{p10}, {p15}, {p25}, {p50}, {p75}, {p85}, {p90}]")

    mean_val = float(round(np.mean(returns), 4))
    median_val = float(round(np.median(returns), 4))
    std_val = float(round(np.std(returns, ddof=1) if n > 1 else 0.0, 4))
    se_val = float(round(std_val / np.sqrt(n), 4)) if n > 0 else 0.0
    ci = [float(round(mean_val - 1.96 * se_val, 4)), float(round(mean_val + 1.96 * se_val, 4))]
    
    pos_ret = returns[returns > 0]
    neg_ret = returns[returns < 0]
    cond_gain = float(round(np.mean(pos_ret), 4)) if len(pos_ret) >= 100 else (p85 if n >= 100 else None)
    cond_loss = float(round(abs(np.mean(neg_ret)), 4)) if len(neg_ret) >= 100 else (abs(p15) if n >= 100 else None)
    
    boot_res = calculate_block_bootstrap(returns)
    
    return {
        'sampleCount': n,
        'p10': p10,
        'p15': p15,
        'p25': p25,
        'p50': p50,
        'p75': p75,
        'p85': p85,
        'p90': p90,
        'mean': mean_val,
        'median': median_val,
        'std': std_val,
        'standardError': se_val,
        'confidenceInterval': ci,
        'conditional_gain': cond_gain,
        'conditional_loss': cond_loss,
        'bootstrapMethod': boot_res['bootstrapMethod'],
        'bootstrapSamples': boot_res['bootstrapSamples'],
        'effectiveSampleSize': boot_res['effectiveSampleSize'],
        'CI_low': boot_res['CI_low'],
        'CI_high': boot_res['CI_high'],
        'fittedStart': start_date,
        'fittedEnd': end_date,
        'fitEndTimestamp': end_date,
        'method': method_name
    }

class ConditionalReturnEngine:
    def __init__(self, horizon: Optional[str] = None):
        # Structure: horizon -> bucket_key -> metrics
        self.horizon = horizon
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

    def fit_horizon_causal(self, horizon: str, history_df: pd.DataFrame, fit_end_timestamp: str) -> Dict[str, Any]:
        """
        Fits empirical conditional distribution for a specific horizon using only historical data strictly preceding fit_end_timestamp.
        SEMANTIC CONTRACT (Section F):
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
        if horizon not in ['1d', '5d', '20d']:
            raise HorizonMismatchError(f"Invalid horizon: {horizon}")
            
        if self.horizon is not None and self.horizon != horizon:
            raise HorizonMismatchError(f"Engine bound to horizon {self.horizon}, received {horizon}")
            
        if history_df is None or history_df.empty or not fit_end_timestamp:
            return {
                'actualFitStart': None,
                'actualFitEnd': None,
                'fitEndBoundary': str(fit_end_timestamp)[:10] if fit_end_timestamp else None,
                'sampleCount': 0,
                'distribution': {},
                'status': 'INSUFFICIENT_DATA'
            }
            
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
            return {
                'actualFitStart': None,
                'actualFitEnd': None,
                'fitEndBoundary': str(fit_end_timestamp)[:10],
                'sampleCount': 0,
                'distribution': {},
                'status': 'INSUFFICIENT_DATA'
            }
            
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
        
        return {
            'actualFitStart': actual_fit_start,
            'actualFitEnd': actual_fit_end,
            'fitEndBoundary': str(fit_end_timestamp)[:10],
            'sampleCount': len(eligible_df),
            'distribution': self.tables.get(horizon, {}),
            'status': 'FITTED_CAUSAL'
        }

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
        if horizon not in ['1d', '5d', '20d']:
            raise HorizonMismatchError(f"Invalid horizon: {horizon}")
            
        if self.horizon is not None and self.horizon != horizon:
            raise HorizonMismatchError(f"HORIZON_MISMATCH_ERROR: Engine bound to horizon {self.horizon}, received {horizon}")
            
        h_table = self.tables.get(horizon, {})
        bucket_name = get_bucket_name(prob)
        
        # 1. Try Probability + Regime
        pr_key = f"PROB_REGIME_{bucket_name}_{regime}"
        if pr_key in h_table and h_table[pr_key]['method'] == 'PROBABILITY_REGIME_BUCKET' and h_table[pr_key]['sampleCount'] >= MIN_RETURN_BUCKET_SAMPLE_COUNT:
            return h_table[pr_key]
            
        # 2. Try Probability Bucket
        p_key = f"PROB_{bucket_name}"
        if p_key in h_table and h_table[p_key]['method'] == 'PROBABILITY_BUCKET' and h_table[p_key]['sampleCount'] >= MIN_RETURN_BUCKET_SAMPLE_COUNT:
            return h_table[p_key]
            
        # 3. Try Regime-Wide Fallback
        r_key = f"REGIME_{regime}"
        if r_key in h_table and h_table[r_key]['method'] == 'REGIME_BUCKET' and h_table[r_key]['sampleCount'] >= MIN_RETURN_BUCKET_SAMPLE_COUNT:
            return h_table[r_key]

        # 4. Try Horizon-Wide Fallback
        if 'HORIZON_WIDE' in h_table and h_table['HORIZON_WIDE']['method'] == 'HORIZON_WIDE_FALLBACK' and h_table['HORIZON_WIDE']['sampleCount'] >= MIN_RETURN_BUCKET_SAMPLE_COUNT:
            return h_table['HORIZON_WIDE']
            
        # 5. Strictly Insufficient Data (Zero fabricated numbers)
        return {
            'sampleCount': 0,
            'p10': None,
            'p15': None,
            'p25': None,
            'p50': None,
            'p75': None,
            'p85': None,
            'p90': None,
            'mean': None,
            'median': None,
            'std': None,
            'standardError': None,
            'confidenceInterval': None,
            'conditional_gain': None,
            'conditional_loss': None,
            'bootstrapMethod': 'BLOCK_BOOTSTRAP_DATE',
            'bootstrapSamples': 0,
            'effectiveSampleSize': 0,
            'CI_low': None,
            'CI_high': None,
            'fittedStart': "",
            'fittedEnd': "",
            'fitEndTimestamp': "",
            'method': 'INSUFFICIENT_DATA'
        }
        
    def to_dict(self) -> Dict[str, Any]:
        return self.tables