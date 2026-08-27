import os
import sys
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from quant_governance_config import (
    BASE_ROUND_TRIP_FRICTION,
    MAX_POSITION_WEIGHT,
    MAX_SECTOR_WEIGHT,
    MAX_GROSS_EXPOSURE
)

def rank_cross_sectional_opportunities(
    predictions_df: pd.DataFrame,
    top_n: int = 3,
    min_ev_hurdle: float = 0.002,
    regime_filter_enabled: bool = True,
    benchmark_regimes_df: Optional[pd.DataFrame] = None
) -> pd.DataFrame:
    """
    Ranks daily universe predictions cross-sectionally by Risk-Adjusted Net Expected Value.
    Selects Top-N opportunities per trading date, filtering out negative alpha and hostile regimes.
    """
    df = predictions_df.copy()
    if df.empty:
        return df
        
    # Map benchmark regime if available
    if benchmark_regimes_df is not None and not benchmark_regimes_df.empty:
        regime_map = {str(d)[:10]: r for d, r in zip(benchmark_regimes_df.index, benchmark_regimes_df['market_regime'])}
        df['market_regime'] = [regime_map.get(str(d)[:10], 'SIDEWAYS') for d in df['predictionTimestamp']]
    else:
        df['market_regime'] = 'SIDEWAYS'
        
    scored_records = []
    
    for idx, row in df.iterrows():
        p_up = row.get('calibratedProbability') or row.get('pred_prob')
        if p_up is None or pd.isna(p_up):
            continue
            
        p_up = float(p_up)
        p_down = 1.0 - p_up
        
        cond_gain = row.get('conditional_gain')
        cond_loss = row.get('conditional_loss')
        
        # If conditional quantiles not available, use empirical P85 / P15 fallback if present
        if cond_gain is None or pd.isna(cond_gain):
            cond_gain = row.get('p85')
        if cond_loss is None or pd.isna(cond_loss):
            cond_loss = abs(row.get('p15')) if row.get('p15') is not None else None
            
        if cond_gain is None or cond_loss is None or pd.isna(cond_gain) or pd.isna(cond_loss):
            continue
            
        cond_gain = float(cond_gain)
        cond_loss = float(cond_loss)
        
        # True Net EV formula
        gross_ev = p_up * cond_gain - p_down * cond_loss
        net_ev = gross_ev - BASE_ROUND_TRIP_FRICTION
        
        atr = row.get('atr_percent', 0.02)
        if atr is None or pd.isna(atr) or float(atr) <= 0:
            atr = 0.02
        atr = float(atr)
        
        risk_adj_ev = net_ev / max(0.005, atr)
        
        regime = row.get('market_regime', 'SIDEWAYS')
        
        # Regime filter: during BEAR or HIGH_VOLATILITY, require higher hurdle or skip
        if regime_filter_enabled:
            if regime == 'BEAR':
                net_ev -= 0.005  # 50 bps penalty in bear market
                risk_adj_ev = net_ev / max(0.005, atr)
            elif regime == 'HIGH_VOLATILITY':
                net_ev -= 0.003  # 30 bps penalty in high vol
                risk_adj_ev = net_ev / max(0.005, atr)
                
        rec = row.to_dict()
        rec['gross_ev'] = gross_ev
        rec['net_ev'] = net_ev
        rec['risk_adj_ev'] = risk_adj_ev
        rec['alpha_score'] = risk_adj_ev
        rec['is_ev_eligible'] = bool(net_ev >= min_ev_hurdle and risk_adj_ev > 0)
        scored_records.append(rec)
        
    if not scored_records:
        return pd.DataFrame()
        
    df_scored = pd.DataFrame(scored_records)
    
    # Select Top-N per prediction date
    selected_dfs = []
    for dt, group in df_scored.groupby('predictionTimestamp'):
        eligible = group[group['is_ev_eligible']].copy()
        if not eligible.empty:
            eligible.sort_values(by='risk_adj_ev', ascending=False, inplace=True)
            top = eligible.head(top_n)
            selected_dfs.append(top)
            
    if selected_dfs:
        df_final = pd.concat(selected_dfs, axis=0)
        df_final.sort_index(inplace=True)
        return df_final
    else:
        return pd.DataFrame()
