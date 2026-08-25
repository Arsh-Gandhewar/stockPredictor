"""
Time-Aligned Daily Equity Curve & True OHLC Path Backtesting Engine for QuantX.
Simulates portfolio execution with centralized friction, cash accounting, risk-budgeted position sizing,
and conservative same-candle stop-loss priority.
"""
import os
import sys
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from costs import TransactionCostEngine

def evaluate_trade_ohlc_path(
    entry_price: float,
    stop_loss_price: float,
    target_price: float,
    forward_candles: List[Dict[str, float]],
    round_trip_cost: float
) -> Dict[str, Any]:
    """
    Simulates true intraday forward price path execution candle-by-candle.
    
    Rules:
    - If candle Low <= stopPrice: exit at stop (or open if gap down below stop).
    - Else if candle High >= targetPrice: exit at target (or open if gap up above target).
    - If BOTH touched on same candle: exit at stop (conservative execution priority rule).
    - If horizon expires without stop or target: exit at horizon close.
    """
    if not forward_candles:
        return {
            'exitPrice': entry_price,
            'exitReason': 'HORIZON_EXPIRY',
            'grossReturn': 0.0,
            'netReturn': -round_trip_cost,
            'holdingDays': 0,
            'isWin': False
        }
        
    for day_idx, candle in enumerate(forward_candles, start=1):
        open_p = candle['Open']
        high_p = candle['High']
        low_p = candle['Low']
        close_p = candle['Close']
        
        hit_stop = low_p <= stop_loss_price
        hit_target = high_p >= target_price
        
        # 1. Conservative same-candle collision: STOP-LOSS TRIGGERS FIRST
        if hit_stop and hit_target:
            exec_price = min(open_p, stop_loss_price) if open_p < stop_loss_price else stop_loss_price
            gross_ret = (exec_price - entry_price) / entry_price
            net_ret = gross_ret - round_trip_cost
            return {
                'exitPrice': float(exec_price),
                'exitReason': 'STOP_LOSS_COLLISION',
                'grossReturn': float(gross_ret),
                'netReturn': float(net_ret),
                'holdingDays': day_idx,
                'isWin': bool(net_ret > 0)
            }
            
        # 2. Stop-loss triggered
        if hit_stop:
            exec_price = min(open_p, stop_loss_price) if open_p < stop_loss_price else stop_loss_price
            gross_ret = (exec_price - entry_price) / entry_price
            net_ret = gross_ret - round_trip_cost
            return {
                'exitPrice': float(exec_price),
                'exitReason': 'STOP_LOSS',
                'grossReturn': float(gross_ret),
                'netReturn': float(net_ret),
                'holdingDays': day_idx,
                'isWin': bool(net_ret > 0)
            }
            
        # 3. Target triggered
        if hit_target:
            exec_price = max(open_p, target_price) if open_p > target_price else target_price
            gross_ret = (exec_price - entry_price) / entry_price
            net_ret = gross_ret - round_trip_cost
            return {
                'exitPrice': float(exec_price),
                'exitReason': 'TARGET_HIT',
                'grossReturn': float(gross_ret),
                'netReturn': float(net_ret),
                'holdingDays': day_idx,
                'isWin': bool(net_ret > 0)
            }
            
    # 4. Horizon expiry at final candle close
    final_close = forward_candles[-1]['Close']
    gross_ret = (final_close - entry_price) / entry_price
    net_ret = gross_ret - round_trip_cost
    return {
        'exitPrice': float(final_close),
        'exitReason': 'HORIZON_EXPIRY',
        'grossReturn': float(gross_ret),
        'netReturn': float(net_ret),
        'holdingDays': len(forward_candles),
        'isWin': bool(net_ret > 0)
    }

def run_portfolio_backtest(
    predictions_df: pd.DataFrame,
    historical_candles_by_ticker: Optional[Dict[str, pd.DataFrame]] = None,
    horizon_days: int = 5,
    prob_threshold: float = 0.55,
    initial_cash: float = 1_000_000.0,
    cost_regime: str = 'BASE_COST'
) -> Dict[str, Any]:
    """
    Executes a portfolio backtest tracking daily cash, open positions, marked-to-market equity,
    and performance metrics strictly from the daily equity curve.
    """
    cost_engine = TransactionCostEngine(cost_regime)
    round_trip_cost = cost_engine.calculate_round_trip_cost_rate()
    one_way_cost = round_trip_cost / 2.0
    
    if predictions_df.empty:
        return {
            'totalTrades': 0,
            'winRate': 0.0,
            'cagr': 0.0,
            'annualizedReturn': 0.0,
            'annualizedVol': 0.0,
            'sharpe': 'NOT_MEANINGFUL',
            'sortino': 'NOT_MEANINGFUL',
            'calmar': 0.0,
            'maxDrawdown': 0.0,
            'profitFactor': 'NOT_MEANINGFUL',
            'equityCurve': [initial_cash],
            'dailyEquitySeries': [],
            'trades': [],
            'rejectedSignalsCount': 0
        }
        
    df = predictions_df.copy()
    if 'predictionTimestamp' in df.columns:
        df['date'] = pd.to_datetime(df['predictionTimestamp'])
    elif not isinstance(df.index, pd.DatetimeIndex):
        df['date'] = pd.to_datetime(df.index)
    else:
        df['date'] = df.index
        
    df.sort_values('date', inplace=True)
    
    # Construct complete trading calendar from historical data if available
    unique_dates_set = set(df['date'].unique())
    if historical_candles_by_ticker:
        for cdf in historical_candles_by_ticker.values():
            unique_dates_set.update(cdf.index)
            
    unique_dates = sorted(list(unique_dates_set))
    if df['date'].empty:
        return {'totalTrades': 0, 'winRate': 0.0, 'cagr': 0.0, 'sharpe': 0.0, 'maxDrawdown': 0.0}
        
    # Bound the calendar to the first and last prediction dates
    min_date, max_date = df['date'].min(), df['date'].max()
    unique_dates = [d for d in unique_dates if min_date <= d <= max_date]
        
    cash = float(initial_cash)
    open_positions: List[Dict[str, Any]] = []
    completed_trades: List[Dict[str, Any]] = []
    pending_signals: List[pd.Series] = []
    rejected_signals_count = 0
    
    daily_equity_records: List[Dict[str, Any]] = []
    
    MAX_CONCURRENT_POSITIONS = 10
    MAX_POSITION_WEIGHT = 0.15      # Max 15% allocation per stock
    RISK_BUDGET_PCT = 0.01          # 1.0% portfolio equity risk budget
    
    for current_date in unique_dates:
        start_of_day_cash = cash
        date_str = str(current_date)[:10]
        
        # 1. Check / Update / Close Existing Open Positions
        surviving_positions = []
        for pos in open_positions:
            ticker = pos['ticker']
            candles_df = historical_candles_by_ticker.get(ticker) if historical_candles_by_ticker else None
            
            # Lookup today's candle for this ticker
            today_candle = None
            if candles_df is not None and current_date in candles_df.index:
                row = candles_df.loc[current_date]
                today_candle = {
                    'Open': float(row['Open']),
                    'High': float(row['High']),
                    'Low': float(row['Low']),
                    'Close': float(row['Close']),
                }
            else:
                today_candle = {
                    'Open': pos['currentPrice'],
                    'High': pos['currentPrice'],
                    'Low': pos['currentPrice'],
                    'Close': pos['currentPrice'],
                }
                
            pos['daysHeld'] += 1
            
            # Check Stop / Target on today's candle
            hit_stop = today_candle['Low'] <= pos['stopLossPrice']
            hit_target = today_candle['High'] >= pos['targetPrice']
            is_horizon_expired = pos['daysHeld'] >= horizon_days
            
            if hit_stop or hit_target or is_horizon_expired:
                # Close position
                if hit_stop and hit_target:
                    exec_price = min(today_candle['Open'], pos['stopLossPrice']) if today_candle['Open'] < pos['stopLossPrice'] else pos['stopLossPrice']
                    reason = 'STOP_LOSS_COLLISION'
                elif hit_stop:
                    exec_price = min(today_candle['Open'], pos['stopLossPrice']) if today_candle['Open'] < pos['stopLossPrice'] else pos['stopLossPrice']
                    reason = 'STOP_LOSS'
                elif hit_target:
                    exec_price = max(today_candle['Open'], pos['targetPrice']) if today_candle['Open'] > pos['targetPrice'] else pos['targetPrice']
                    reason = 'TARGET_HIT'
                else:
                    exec_price = today_candle['Close']
                    reason = 'HORIZON_EXPIRY'
                    
                exec_value = pos['notional'] * (exec_price / pos['entryPrice'])
                exit_friction = exec_value * one_way_cost
                
                net_pnl = exec_value - pos['notional'] - exit_friction - pos['entryFriction']
                gross_ret = (exec_price - pos['entryPrice']) / pos['entryPrice']
                net_ret = net_pnl / pos['notional']
                
                cash += (exec_value - exit_friction)
                
                completed_trades.append({
                    'positionId': pos['id'],
                    'ticker': ticker,
                    'entryDate': pos['entryDate'],
                    'exitDate': date_str,
                    'entryPrice': pos['entryPrice'],
                    'exitPrice': float(exec_price),
                    'notional': pos['notional'],
                    'grossReturn': float(gross_ret),
                    'netReturn': float(net_ret),
                    'pnl': float(net_pnl),
                    'exitReason': reason,
                    'isWin': bool(net_pnl > 0),
                    'daysHeld': pos['daysHeld'],
                })
            else:
                # Position remains open, mark to market
                pos['currentPrice'] = today_candle['Close']
                current_value = pos['notional'] * (today_candle['Close'] / pos['entryPrice'])
                pos['unrealizedPnl'] = current_value - pos['notional'] - pos['entryFriction']
                surviving_positions.append(pos)
                
        open_positions = surviving_positions
        
        # 2. Process Pending Signals (Entry at Open(T+1))
        market_value = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
        total_equity = cash + market_value
        
        for sig in pending_signals:
            ticker = sig.get('ticker', 'UNKNOWN')
            
            if len(open_positions) >= MAX_CONCURRENT_POSITIONS:
                rejected_signals_count += 1
                continue
                
            if any(p['ticker'] == ticker for p in open_positions):
                continue
                
            # Entry at Open
            candles_df = historical_candles_by_ticker.get(ticker) if historical_candles_by_ticker else None
            if candles_df is not None and current_date in candles_df.index:
                entry_price = float(candles_df.loc[current_date]['Open'])
            else:
                entry_price = float(sig.get('Close', 100.0))
                
            vol = float(sig.get('atr_percent', 0.02))
            
            stop_dist = max(0.01, 1.5 * vol)
            stop_loss_price = entry_price * (1.0 - stop_dist)
            target_price = entry_price * (1.0 + 2.25 * vol)
            
            # Position sizing
            risk_budget = total_equity * RISK_BUDGET_PCT
            sized_notional = min(
                risk_budget / stop_dist,
                total_equity * MAX_POSITION_WEIGHT,
                cash
            )
            
            entry_friction = sized_notional * one_way_cost
            
            if sized_notional <= 0 or cash < (sized_notional + entry_friction) or (total_equity > 0 and sized_notional < (total_equity * 0.01)):
                rejected_signals_count += 1
                continue
                
            # Open position
            cash -= (sized_notional + entry_friction)
            pos_id = f"pos_{ticker}_{date_str}_{len(open_positions)+1}"
            open_positions.append({
                'id': pos_id,
                'ticker': ticker,
                'entryDate': date_str,
                'entryPrice': entry_price,
                'stopLossPrice': stop_loss_price,
                'targetPrice': target_price,
                'notional': float(sized_notional),
                'entryFriction': entry_friction,
                'daysHeld': 0,
                'currentPrice': entry_price,
                'unrealizedPnl': -entry_friction,
            })
            
        # 3. Generate New Signals for tomorrow (Close(T))
        day_signals = df[df['date'] == current_date]
        active_signals = day_signals[day_signals['pred_prob'] >= prob_threshold]
        pending_signals = [sig for _, sig in active_signals.iterrows()]
            
        # 4. Mark to Market & Record Daily Equity State
        market_value = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
        end_equity = cash + market_value
        gross_exp = market_value / end_equity if end_equity > 0 else 0.0
        
        prev_eq = daily_equity_records[-1]['portfolioValue'] if daily_equity_records else initial_cash
        daily_ret = (end_equity - prev_eq) / prev_eq if prev_eq > 0 else 0.0
        
        daily_equity_records.append({
            'date': date_str,
            'startingCash': round(start_of_day_cash, 2),
            'endingCash': round(cash, 2),
            'openPositions': len(open_positions),
            'grossExposure': round(gross_exp, 4),
            'marketValue': round(market_value, 2),
            'portfolioValue': round(end_equity, 2),
            'dailyReturn': round(daily_ret, 6),
            'cumulativeReturn': round((end_equity - initial_cash) / initial_cash, 6) if initial_cash > 0 else 0.0,
        })
        
    # Calculate Final Out-of-Sample Performance Metrics from Daily Equity Curve
    equity_values = np.array([r['portfolioValue'] for r in daily_equity_records])
    daily_returns = np.array([r['dailyReturn'] for r in daily_equity_records[1:]])
    
    final_equity = equity_values[-1] if len(equity_values) > 0 else initial_cash
    n_days = len(daily_equity_records)
    calendar_days = max(1, (unique_dates[-1] - unique_dates[0]).days) if len(unique_dates) > 1 else 1
    
    # 1. CAGR
    total_ret_ratio = final_equity / initial_cash if initial_cash > 0 else 0.0
    cagr = (pow(total_ret_ratio, 365.0 / calendar_days) - 1.0) * 100.0 if total_ret_ratio > 0 and calendar_days >= 30 else ((total_ret_ratio - 1.0) * 100.0)
    
    # 2. Sharpe (vs 6.5% risk-free rate)
    rf_daily = 0.065 / 252.0
    excess_returns = daily_returns - rf_daily if len(daily_returns) > 0 else np.array([0.0])
    mean_excess = float(np.mean(excess_returns)) if len(excess_returns) > 0 else 0.0
    std_ret = float(np.std(daily_returns, ddof=1)) if len(daily_returns) > 1 else 0.0
    
    if std_ret > 1e-6 and len(daily_returns) > 1:
        annualized_vol = std_ret * np.sqrt(252.0)
        sharpe = (mean_excess * np.sqrt(252.0)) / std_ret
    else:
        annualized_vol = 0.0
        sharpe = 'NOT_MEANINGFUL'
        
    annualized_return = float(np.mean(daily_returns) * 252.0) if len(daily_returns) > 0 else 0.0
    
    # 3. Sortino (vs 6.5% risk-free rate)
    downside_rets = daily_returns[daily_returns < rf_daily]
    downside_dev = float(np.std(downside_rets, ddof=1) * np.sqrt(252.0)) if len(downside_rets) > 1 else 0.0
    if downside_dev > 1e-6 and len(downside_rets) > 1:
        sortino = (mean_excess * np.sqrt(252.0)) / downside_dev
    else:
        sortino = 'NOT_MEANINGFUL'
    
    # 4. Max Drawdown
    peak = equity_values[0] if len(equity_values) > 0 else 0.0
    max_dd = 0.0
    for val in equity_values:
        if val > peak:
            peak = val
        dd = (val - peak) / peak if peak > 0 else 0.0
        if dd < max_dd:
            max_dd = dd
            
    calmar = abs(cagr / (max_dd * 100.0)) if max_dd < 0 else 0.0
    
    # 5. Profit Factor (Never fabricated 99 or 999)
    if completed_trades:
        trade_pnls = [t['pnl'] for t in completed_trades]
        positive_pnl = sum(p for p in trade_pnls if p > 0)
        negative_pnl = abs(sum(p for p in trade_pnls if p < 0))
        if negative_pnl > 0:
            profit_factor = round(float(positive_pnl / negative_pnl), 2)
        elif positive_pnl > 0:
            profit_factor = 'NOT_MEANINGFUL'
        else:
            profit_factor = 0.0
            
        win_rate = round(float(sum(1 for t in completed_trades if t['isWin']) / len(completed_trades) * 100.0), 2)
    else:
        profit_factor = 'NOT_MEANINGFUL'
        win_rate = 0.0
        
    return {
        'totalTrades': len(completed_trades),
        'winRate': win_rate,
        'cagr': round(float(cagr), 2),
        'annualizedReturn': round(float(annualized_return * 100.0), 2),
        'annualizedVol': round(float(annualized_vol * 100.0), 2),
        'sharpe': round(float(sharpe), 2) if isinstance(sharpe, float) else sharpe,
        'sortino': round(float(sortino), 2) if isinstance(sortino, float) else sortino,
        'calmar': round(float(calmar), 2),
        'maxDrawdown': round(float(max_dd * 100.0), 2),
        'profitFactor': profit_factor,
        'rejectedSignalsCount': rejected_signals_count,
        'frictionRateBps': round(round_trip_cost * 10000, 1),
        'costRegime': cost_regime,
        'dailyEquitySeries': daily_equity_records[:100],
        'equityCurve': [round(r['portfolioValue'] / initial_cash * 100.0, 2) if initial_cash > 0 else 0.0 for r in daily_equity_records],
        'trades': completed_trades[:50],
    }

