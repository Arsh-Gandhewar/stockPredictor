import pandas as pd
import numpy as np
import yaml
import os

def load_config():
    with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.yaml'), 'r') as f:
        return yaml.safe_load(f)

def run_backtest(df, predictions, horizon):
    config = load_config()
    tc = config['transaction_costs']
    # Total costs: Entry + Exit
    # (Brokerage + STT + Exch + Stamp + SEBI) + GST on brokerage
    entry_tc = tc['brokerage'] * (1 + tc['gst_on_brokerage']) + tc['exchange'] + tc['stamp_duty'] + tc['sebi']
    exit_tc = tc['brokerage'] * (1 + tc['gst_on_brokerage']) + tc['stt_sell'] + tc['exchange'] + tc['sebi']
    total_tc = entry_tc + exit_tc
    slippage = (tc['slippage_bps'] / 10000.0) * 2
    
    results = []
    for i, row in df.iterrows():
        prob = predictions.loc[i]
        if prob > 0.6: # Configurable threshold in practice
            ret = row[f'future_ret_{horizon}d'] - total_tc - slippage
            results.append(ret)
            
    win_rate = sum(1 for r in results if r > 0) / len(results) if results else 0
    total_ret = sum(results)
    
    metrics = {
        "win_rate": float(win_rate),
        "total_return": float(total_ret),
        "trades": len(results),
        "profit_factor": float(sum(r for r in results if r > 0) / abs(sum(r for r in results if r < 0))) if sum(r for r in results if r < 0) != 0 else float('inf')
    }
    return metrics
