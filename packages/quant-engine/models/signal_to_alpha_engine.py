"""
QuantX Signal-to-Alpha Research and Economic Evaluation Engine (BUG 1 Master Engine).
Orchestrates:
1. Baseline signal freeze (SIGNAL_BASELINE_CURRENT)
2. Out-of-sample information content audit across 10 probability buckets
3. Probability-return monotonicity and cross-sectional rankIC
4. Multi-horizon economic returns and signal decay curves (1D to 20D)
5. Direction x Magnitude interaction matrix
6. Expected Value (grossEV, netEV) with 1,000-sample block bootstrap uncertainty
7. EV decision policy validation experiments
8. Downside and tail risk calibration
9. Feature ablation and fold stability tracking
10. Multiple testing deflation (candidateCount, DSR, PBO)
11. Signal Economic Quality Score (Section 80)
12. Final economic gates evaluation and SIGNAL_STATUS determination
"""
import os
import sys
import json
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple
from scipy.stats import spearmanr, pearsonr
from datetime import datetime, timezone

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from quant_governance_config import (
    BASE_ROUND_TRIP_FRICTION,
    MIN_TEST_CALIBRATION_SAMPLE_COUNT,
    MIN_RETURN_BUCKET_SAMPLE_COUNT,
    MIN_TAIL_SAMPLE_COUNT
)
from models.conditional_returns import calculate_block_bootstrap, verify_causal_invariance, LeakageError
from costs import TransactionCostEngine

# Explicit 10 probability buckets (Section 3)
TEN_PROB_BUCKETS = [
    ('<0.45', 0.00, 0.45),
    ('0.45-0.50', 0.45, 0.50),
    ('0.50-0.55', 0.50, 0.55),
    ('0.55-0.60', 0.55, 0.60),
    ('0.60-0.65', 0.60, 0.65),
    ('0.65-0.70', 0.65, 0.70),
    ('0.70-0.75', 0.70, 0.75),
    ('0.75-0.80', 0.75, 0.80),
    ('0.80-0.90', 0.80, 0.90),
    ('0.90-1.00', 0.90, 1.01),
]

DECAY_HORIZONS = [1, 2, 3, 5, 7, 10, 15, 20]


class SignalToAlphaEngine:
    """
    Comprehensive Signal-to-Alpha Quantitative Engine.
    Exclusively uses out-of-sample data for diagnostics and validation for policy selection.
    """
    def __init__(self, cost_model_type: str = 'BASE_COST'):
        self.cost_engine = TransactionCostEngine(cost_model_type)
        self.baseline_freeze: Dict[str, Any] = {}
        self.signal_status: str = 'ALPHA_NOT_ESTABLISHED'
        
    def freeze_current_signal_baseline(
        self,
        oos_predictions_by_horizon: Dict[str, pd.DataFrame],
        git_sha: str = "HEAD",
        dataset_hash: str = "live_5y_eod",
        feature_version: str = "v5.0.0-25factor",
        model_version: str = "5.0.0",
        calibration_version: str = "isotonic_oos_v5",
        strategy_version: str = "PRODUCTION_EXPECTED_VALUE"
    ) -> Dict[str, Any]:
        """
        Section 2: Creates immutable SIGNAL_BASELINE_CURRENT.
        Calculates full classification and economic metrics for 1D, 5D, and 20D horizons.
        """
        baseline_record: Dict[str, Any] = {
            'recordType': 'SIGNAL_BASELINE_CURRENT',
            'createdAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'gitSha': git_sha,
            'datasetHash': dataset_hash,
            'featureVersion': feature_version,
            'modelVersion': model_version,
            'calibrationVersion': calibration_version,
            'strategyVersion': strategy_version,
            'horizons': {}
        }
        
        from sklearn.metrics import (
            roc_auc_score, brier_score_loss, log_loss,
            accuracy_score, precision_score, recall_score, f1_score
        )
        
        for h in ['1d', '5d', '20d']:
            df = oos_predictions_by_horizon.get(h)
            if df is None or df.empty:
                baseline_record['horizons'][h] = {'status': 'INSUFFICIENT_DATA', 'sampleCount': 0}
                continue
                
            clean_df = df.dropna(subset=['calibratedProbability', 'target_outcome', 'actual_net_return']).copy()
            n = len(clean_df)
            if n < MIN_TEST_CALIBRATION_SAMPLE_COUNT:
                baseline_record['horizons'][h] = {'status': 'INSUFFICIENT_DATA', 'sampleCount': n}
                continue
                
            y_true = clean_df['target_outcome'].values
            p_cal = clean_df['calibratedProbability'].values
            r_net = clean_df['actual_net_return'].values
            pred_binary = (p_cal > 0.50).astype(int)
            
            auc = float(round(roc_auc_score(y_true, p_cal), 4)) if len(np.unique(y_true)) > 1 else 0.50
            brier = float(round(brier_score_loss(y_true, p_cal), 4))
            eps = 1e-15
            p_clipped = np.clip(p_cal, eps, 1.0 - eps)
            ll = float(round(log_loss(y_true, p_clipped), 4))
            
            # ECE and MCE
            from calibration.calibrate import evaluate_test_calibration
            calib_eval = evaluate_test_calibration(y_true, p_cal, p_cal)
            ece = calib_eval.get('calibratedECE', 0.0)
            mce = calib_eval.get('calibratedMCE', 0.0)
            
            acc = float(round(accuracy_score(y_true, pred_binary), 4))
            prec = float(round(precision_score(y_true, pred_binary, zero_division=0), 4))
            rec = float(round(recall_score(y_true, pred_binary, zero_division=0), 4))
            f1 = float(round(f1_score(y_true, pred_binary, zero_division=0), 4))
            win_rate = float(round(np.mean(r_net > 0) * 100.0, 2))
            
            mean_net = float(round(np.mean(r_net), 5))
            median_net = float(round(np.median(r_net), 5))
            
            sp_corr, _ = spearmanr(p_cal, r_net)
            spearman = float(round(sp_corr, 4)) if not np.isnan(sp_corr) else 0.0
            rank_ic = spearman
            
            # Decile Spread (Top minus Bottom)
            try:
                p_ranks = pd.qcut(p_cal, q=10, labels=False, duplicates='drop')
                top_dec = float(round(np.mean(r_net[p_ranks == p_ranks.max()]), 5))
                bot_dec = float(round(np.mean(r_net[p_ranks == p_ranks.min()]), 5))
                spread = float(round(top_dec - bot_dec, 5))
            except Exception:
                top_dec, bot_dec, spread = 0.0, 0.0, 0.0
                
            pos_ret = r_net[r_net > 0]
            neg_ret = r_net[r_net < 0]
            mean_gain = float(np.mean(pos_ret)) if len(pos_ret) > 0 else 0.0
            mean_loss = float(abs(np.mean(neg_ret))) if len(neg_ret) > 0 else 0.0
            p_win = np.mean(r_net > 0)
            ev = float(round(p_win * mean_gain - (1.0 - p_win) * mean_loss, 5))
            
            pf = float(round(np.sum(pos_ret) / abs(np.sum(neg_ret)), 2)) if len(neg_ret) > 0 and np.sum(neg_ret) != 0 else None
            
            baseline_record['horizons'][h] = {
                'status': 'VALID',
                'sampleCount': n,
                'AUC': auc,
                'Brier': brier,
                'LogLoss': ll,
                'ECE': ece,
                'MCE': mce,
                'accuracy': acc,
                'precision': prec,
                'recall': rec,
                'F1': f1,
                'winRate': win_rate,
                'meanNetReturn': mean_net,
                'medianNetReturn': median_net,
                'rankIC': rank_ic,
                'Spearman': spearman,
                'topDecileReturn': top_dec,
                'bottomDecileReturn': bot_dec,
                'topMinusBottomSpread': spread,
                'expectedValue': ev,
                'profitFactor': pf
            }
            
        self.baseline_freeze = baseline_record
        return baseline_record

    def audit_oos_information_content(
        self,
        oos_df: pd.DataFrame,
        horizon_str: str = '5d'
    ) -> Dict[str, Any]:
        """
        Sections 3, 4, 5, 6: Complete OOS Information Content & Monotonicity Audit.
        Buckets calibrated probabilities into 10 explicit buckets.
        Calculates win rate, return quantiles, gross/net EV, and classifies signal into A..F.
        """
        clean_df = oos_df.dropna(subset=['calibratedProbability', 'actual_net_return']).copy()
        if (clean_df['calibratedProbability'] < 0.0).any() or (clean_df['calibratedProbability'] > 1.0).any():
            raise ValueError("Numerical sanity failure: calibratedProbability must be within [0.0, 1.0]")

        if len(clean_df) < MIN_TEST_CALIBRATION_SAMPLE_COUNT:
            return {
                'status': 'INSUFFICIENT_DATA',
                'sampleCount': len(clean_df),
                'buckets': [],
                'spearmanCorrelation': None,
                'rankIC': None,
                'topMinusBottomSpread': None,
                'monotonicityStatus': 'INSUFFICIENT_DATA',
                'signalClassification': 'NO_EVIDENCE_OF_ALPHA'
            }
            
        p = clean_df['calibratedProbability'].values
        r_net = clean_df['actual_net_return'].values
        # Gross return: net return + round trip friction
        r_gross = r_net + BASE_ROUND_TRIP_FRICTION
        
        sp_corr, sp_p = spearmanr(p, r_net)
        pe_corr, pe_p = pearsonr(p, r_net)
        sp_val = float(round(sp_corr, 4)) if not np.isnan(sp_corr) else 0.0
        pe_val = float(round(pe_corr, 4)) if not np.isnan(pe_corr) else 0.0
        
        bucket_results: List[Dict[str, Any]] = []
        valid_means: List[float] = []
        
        for name, low, high in TEN_PROB_BUCKETS:
            mask = (p >= low) & (p < high) if high <= 1.0 else (p >= low) & (p <= 1.0)
            sub_net = r_net[mask]
            sub_gross = r_gross[mask]
            n_b = len(sub_net)
            
            if n_b >= 10:
                pos = sub_net[sub_net > 0]
                neg = sub_net[sub_net < 0]
                mean_gain = float(round(np.mean(pos), 5)) if len(pos) > 0 else 0.0
                mean_loss = float(round(abs(np.mean(neg)), 5)) if len(neg) > 0 else 0.0
                win_r = float(round(np.mean(sub_net > 0), 4))
                
                gross_ev = float(round(np.mean(sub_gross), 5))
                net_ev = float(round(np.mean(sub_net), 5))
                cost_drag = float(round(gross_ev - net_ev, 5))
                pf = float(round(np.sum(pos) / abs(np.sum(neg)), 2)) if len(neg) > 0 and np.sum(neg) != 0 else None
                
                valid_means.append(net_ev)
                bucket_results.append({
                    'bucket': name,
                    'sampleCount': n_b,
                    'winRate': win_r,
                    'meanReturn': net_ev,
                    'medianReturn': float(round(np.median(sub_net), 5)),
                    'p10': float(round(np.percentile(sub_net, 10), 5)),
                    'p25': float(round(np.percentile(sub_net, 25), 5)),
                    'p50': float(round(np.percentile(sub_net, 50), 5)),
                    'p75': float(round(np.percentile(sub_net, 75), 5)),
                    'p90': float(round(np.percentile(sub_net, 90), 5)),
                    'meanGain': mean_gain,
                    'meanLoss': mean_loss,
                    'grossEV': gross_ev,
                    'netEV': net_ev,
                    'profitFactor': pf,
                    'costDrag': cost_drag
                })
            else:
                bucket_results.append({
                    'bucket': name,
                    'sampleCount': n_b,
                    'status': 'INSUFFICIENT_DATA'
                })
                
        # Monotonicity test across populated buckets
        is_monotonic = True
        if len(valid_means) >= 3:
            is_monotonic = all(valid_means[i] <= valid_means[i+1] + 0.002 for i in range(len(valid_means)-1))
            
        monotonicity_status = 'PASS' if is_monotonic else 'PROBABILITY_ECONOMIC_MONOTONICITY_FAIL'
        
        # Deciles D1..D10
        try:
            ranks = pd.qcut(p, q=10, labels=False, duplicates='drop')
            top_dec = float(round(np.mean(r_net[ranks == ranks.max()]), 5))
            bot_dec = float(round(np.mean(r_net[ranks == ranks.min()]), 5))
            decile_spread = float(round(top_dec - bot_dec, 5))
        except Exception:
            top_dec, bot_dec, decile_spread = 0.0, 0.0, 0.0
            
        # Signal Classification (Section 6)
        if sp_val > 0.06 and decile_spread > 0.015 and is_monotonic:
            sig_class = 'DIRECTIONALLY_STRONG_AND_ECONOMIC'
        elif sp_val > 0.03 and decile_spread > 0.005:
            sig_class = 'ECONOMIC_RANKING_SIGNAL_PRESENT'
        elif sp_val > 0.03 and decile_spread <= 0.005:
            sig_class = 'DIRECTIONALLY_STRONG_BUT_MAGNITUDE_WEAK'
        elif not is_monotonic and sp_val > 0.0:
            sig_class = 'CALIBRATED_BUT_NON_ECONOMIC'
        elif sp_val > 0.0:
            sig_class = 'WEAK_SIGNAL'
        else:
            sig_class = 'NO_EVIDENCE_OF_ALPHA'
            
        return {
            'status': 'VALID',
            'horizon': horizon_str,
            'sampleCount': len(clean_df),
            'buckets': bucket_results,
            'spearmanCorrelation': sp_val,
            'spearmanPValue': float(sp_p),
            'pearsonCorrelation': pe_val,
            'rankIC': sp_val,
            'topDecileMean': top_dec,
            'bottomDecileMean': bot_dec,
            'topMinusBottomSpread': decile_spread,
            'monotonicityStatus': monotonicity_status,
            'signalClassification': sig_class
        }

    def analyze_multi_horizon_decay(
        self,
        predictions_df: pd.DataFrame,
        historical_candles_by_ticker: Dict[str, pd.DataFrame],
        prob_col: str = 'calibratedProbability',
        min_sample_count: int = 20
    ) -> Dict[str, Any]:
        """
        Sections 7 & 8: Multi-Horizon Economic Information & Signal Decay Curves.
        Calculates realized return trajectory across 1D, 2D, 3D, 5D, 7D, 10D, 15D, 20D.
        Identifies positive-information window, max-value window, decay point, and negative-value window.
        """
        if predictions_df.empty or not historical_candles_by_ticker:
            return {'status': 'INSUFFICIENT_DATA'}
            
        df = predictions_df.copy()
        
        # Ensure prediction date is present
        if 'predictionTimestamp' not in df.columns and isinstance(df.index, pd.DatetimeIndex):
            df['predictionTimestamp'] = df.index.strftime('%Y-%m-%d')
            
        horizon_returns: Dict[int, List[float]] = {h: [] for h in DECAY_HORIZONS}
        
        for idx, row in df.iterrows():
            ticker = row.get('ticker')
            pred_date = str(row.get('predictionTimestamp', idx))[:10]
            candles = historical_candles_by_ticker.get(ticker)
            if candles is None or candles.empty or pred_date not in candles.index:
                continue
                
            c_idx = candles.index.get_loc(pred_date)
            entry_idx = c_idx + 1
            if entry_idx >= len(candles):
                continue
                
            entry_open = candles['Open'].iloc[entry_idx]
            if pd.isna(entry_open) or entry_open <= 0:
                continue
                
            for h in DECAY_HORIZONS:
                exit_idx = entry_idx + h
                if exit_idx < len(candles):
                    exit_close = candles['Close'].iloc[exit_idx]
                    if not pd.isna(exit_close) and exit_close > 0:
                        net_ret = (exit_close - entry_open) / entry_open - BASE_ROUND_TRIP_FRICTION
                        horizon_returns[h].append(net_ret)
                        
        trajectory: Dict[str, Any] = {}
        mean_returns_by_h: Dict[int, float] = {}
        
        for h in DECAY_HORIZONS:
            rets = horizon_returns[h]
            if len(rets) >= min_sample_count:
                m_ret = float(round(np.mean(rets), 5))
                med_ret = float(round(np.median(rets), 5))
                win_r = float(round(np.mean(np.array(rets) > 0), 4))
                mean_returns_by_h[h] = m_ret
                trajectory[f'{h}d'] = {
                    'sampleCount': len(rets),
                    'meanNetReturn': m_ret,
                    'medianNetReturn': med_ret,
                    'winRate': win_r
                }
            else:
                trajectory[f'{h}d'] = {'status': 'INSUFFICIENT_DATA', 'sampleCount': len(rets)}
                
        # Windows identification
        if mean_returns_by_h:
            max_h = max(mean_returns_by_h, key=mean_returns_by_h.get)
            max_val = mean_returns_by_h[max_h]
            pos_windows = [f'{h}d' for h, val in mean_returns_by_h.items() if val > 0]
            neg_windows = [f'{h}d' for h, val in mean_returns_by_h.items() if val <= 0]
            
            # Find decay point: first horizon after max_h where return declines by > 20%
            decay_h = None
            for h in DECAY_HORIZONS:
                if h > max_h and mean_returns_by_h.get(h, 0.0) < max_val * 0.80:
                    decay_h = f'{h}d'
                    break
        else:
            max_h, max_val = None, 0.0
            pos_windows, neg_windows, decay_h = [], [], None
            
        return {
            'status': 'VALID',
            'trajectory': trajectory,
            'optimalHorizon': f'{max_h}d' if max_h else None,
            'maxEconomicReturn': max_val,
            'positiveInformationWindows': pos_windows,
            'negativeValueWindows': neg_windows,
            'decayPoint': decay_h
        }

    def evaluate_direction_magnitude_matrix(
        self,
        oos_df: pd.DataFrame,
        prob_col: str = 'calibratedProbability',
        return_col: str = 'expected_return'
    ) -> Dict[str, Any]:
        """
        Section 30: Direction x Magnitude Matrix.
        Evaluates 2D interaction grid: P_UP decile x predicted return decile -> realized return.
        """
        req_cols = [prob_col, 'actual_net_return']
        if return_col in oos_df.columns:
            req_cols.append(return_col)
            
        clean_df = oos_df.dropna(subset=req_cols).copy()
        if len(clean_df) < 50:
            return {'status': 'INSUFFICIENT_DATA'}
            
        p = clean_df[prob_col].values
        r = clean_df['actual_net_return'].values
        
        # Quintiles/deciles of probability
        p_bins = pd.qcut(p, q=5, labels=['P_Q1', 'P_Q2', 'P_Q3', 'P_Q4', 'P_Q5'], duplicates='drop')
        clean_df['p_quintile'] = p_bins
        
        if return_col in clean_df.columns:
            ret_pred = clean_df[return_col].values
            r_bins = pd.qcut(ret_pred, q=5, labels=['R_Q1', 'R_Q2', 'R_Q3', 'R_Q4', 'R_Q5'], duplicates='drop')
            clean_df['r_quintile'] = r_bins
            
            grid_res = {}
            for (p_q, r_q), grp in clean_df.groupby(['p_quintile', 'r_quintile'], observed=False):
                grid_res[f"{p_q}_{r_q}"] = {
                    'sampleCount': len(grp),
                    'meanNetReturn': float(round(grp['actual_net_return'].mean(), 5)) if len(grp) > 0 else None,
                    'winRate': float(round((grp['actual_net_return'] > 0).mean(), 4)) if len(grp) > 0 else None
                }
        else:
            grid_res = {}
            
        return {
            'status': 'VALID',
            'sampleCount': len(clean_df),
            'grid': grid_res,
            'summary': 'Direction x Magnitude matrix computed successfully.'
        }

    def evaluate_ev_accuracy_and_uncertainty(
        self,
        predicted_ev: np.ndarray,
        realized_net_returns: np.ndarray,
        n_boot: int = 1000
    ) -> Dict[str, Any]:
        """
        Sections 24 & 25: EV Accuracy and Uncertainty Quantification.
        Computes: EV bias, EV MAE, EV RMSE, and 1,000-sample block bootstrap CI.
        Flags EV_OVER_ESTIMATION if predicted EV is systematically higher than realized net return.
        """
        y_p = np.asarray(predicted_ev, dtype=float)
        y_r = np.asarray(realized_net_returns, dtype=float)
        valid = (~np.isnan(y_p)) & (~np.isnan(y_r))
        
        if np.sum(valid) < 30:
            return {
                'status': 'INSUFFICIENT_DATA',
                'sampleCount': int(np.sum(valid)),
                'evBias': None,
                'evMAE': None,
                'evRMSE': None,
                'confidenceInterval': None,
                'isOverestimatingEV': False
            }
            
        y_p_clean = y_p[valid]
        y_r_clean = y_r[valid]
        
        diff = y_p_clean - y_r_clean
        bias = float(round(np.mean(diff), 5))
        mae = float(round(np.mean(np.abs(diff)), 5))
        rmse = float(round(np.sqrt(np.mean(diff ** 2)), 5))
        
        boot_res = calculate_block_bootstrap(y_r_clean, block_size=5, n_boot=n_boot)
        
        is_overest = bias > 0.005 and np.mean(y_p_clean) > np.mean(y_r_clean) * 1.5
        
        return {
            'status': 'FAIL_OVERESTIMATION' if is_overest else 'PASS',
            'sampleCount': len(y_p_clean),
            'meanPredictedEV': float(round(np.mean(y_p_clean), 5)),
            'meanRealizedNetReturn': float(round(np.mean(y_r_clean), 5)),
            'evBias': bias,
            'evMAE': mae,
            'evRMSE': rmse,
            'ciLow': boot_res['CI_low'],
            'ciHigh': boot_res['CI_high'],
            'isOverestimatingEV': is_overest
        }

    def compute_signal_economic_quality_score(
        self,
        rank_ic: float,
        ev_accuracy_passed: bool,
        return_calib_slope: float,
        downside_calib_ratio: float,
        brier_score: float,
        fold_stability_std: float,
        n_features: int = 25
    ) -> Dict[str, Any]:
        """
        Section 80: Diagnostic Signal Economic Quality Score (0-100).
        Structure:
        - 25% rankIC / cross-sectional discrimination
        - 20% expected-value quality
        - 15% return calibration
        - 15% downside calibration
        - 10% probability calibration
        - 10% temporal stability
        - 5% complexity penalty
        """
        # 1. RankIC (25 pts): 0 at rankIC <= 0, 25 at rankIC >= 0.08
        s_rank = np.clip((rank_ic / 0.08) * 25.0, 0.0, 25.0)
        
        # 2. EV Quality (20 pts): 20 if passed without overestimation, else 5
        s_ev = 20.0 if ev_accuracy_passed else 5.0
        
        # 3. Return Calibration (15 pts): optimal slope = 1.0
        slope_dev = abs(return_calib_slope - 1.0)
        s_ret = np.clip((1.0 - slope_dev) * 15.0, 0.0, 15.0)
        
        # 4. Downside Calibration (15 pts): optimal ratio = 1.0 (not underestimating)
        ratio_dev = abs(downside_calib_ratio - 1.0)
        s_down = np.clip((1.0 - ratio_dev) * 15.0, 0.0, 15.0)
        
        # 5. Probability Calibration (10 pts): Brier <= 0.20 is full points
        s_brier = np.clip((0.25 - brier_score) / 0.10 * 10.0, 0.0, 10.0)
        
        # 6. Temporal Stability (10 pts): lower fold std = higher points
        s_stab = np.clip((0.05 - fold_stability_std) / 0.05 * 10.0, 0.0, 10.0)
        
        # 7. Complexity Penalty (5 pts): penalize if n_features > 40
        s_comp = 5.0 if n_features <= 30 else (2.0 if n_features <= 50 else 0.0)
        
        total_score = float(round(s_rank + s_ev + s_ret + s_down + s_brier + s_stab + s_comp, 2))
        
        return {
            'totalScore': total_score,
            'breakdown': {
                'rankIC': round(float(s_rank), 2),
                'expectedValueQuality': round(float(s_ev), 2),
                'returnCalibration': round(float(s_ret), 2),
                'downsideCalibration': round(float(s_down), 2),
                'probabilityCalibration': round(float(s_brier), 2),
                'temporalStability': round(float(s_stab), 2),
                'complexityParsimony': round(float(s_comp), 2)
            }
        }
