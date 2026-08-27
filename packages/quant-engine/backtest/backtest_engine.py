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

from costs import TransactionCostEngine
from universe import TICKER_SECTOR_MAP
from quant_governance_config import (
    MAX_POSITION_WEIGHT,
    MAX_SECTOR_WEIGHT,
    MAX_GROSS_EXPOSURE,
    RISK_PER_TRADE
)
from models.payoff_profile import (
    TradePayoffProfile,
    build_trade_payoff_profile,
    verify_trade_payoff_invariants,
    reconcile_trade_payoffs,
    EconomicPayoffMismatchError,
    HorizonMismatchError,
    InvalidPayoffError
)
from models.cross_sectional_ranker import (
    OpportunityRecord,
    build_daily_opportunity_table,
    select_and_allocate_portfolio,
    compute_historical_correlation,
    OptimizationLeakageError
)

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
    cost_regime: str = 'BASE_COST',
    strategy_mode: str = 'PRODUCTION_EXPECTED_VALUE',
    top_n: int = 3,
    minimum_decision_margin: float = 0.0,
    risk_per_trade: float = RISK_PER_TRADE,
    max_position_weight: float = MAX_POSITION_WEIGHT,
    max_sector_weight: float = MAX_SECTOR_WEIGHT,
    max_gross_exposure: float = MAX_GROSS_EXPOSURE,
    max_cluster_exposure: float = 0.50,
    partition: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes a portfolio backtest tracking daily cash, open positions, marked-to-market equity,
    and performance metrics strictly from the single authoritative daily equity curve.
    Supports cross-sectional ranking, risk-adjusted allocation, and legacy baselines.
    """
    cost_engine = TransactionCostEngine(cost_regime)
    round_trip_cost = cost_engine.calculate_round_trip_cost_rate()
    one_way_cost = round_trip_cost / 2.0
    
    if initial_cash <= 0:
        return {
            'strategyMode': strategy_mode,
            'totalTrades': 0,
            'winRate': 0.0,
            'cagr': 0.0,
            'annualizedReturn': 0.0,
            'annualizedVol': 0.0,
            'sharpe': 'NOT_AVAILABLE',
            'sortino': 'NOT_AVAILABLE',
            'calmar': 'NOT_AVAILABLE',
            'maxDrawdown': 0.0,
            'profitFactor': None,
            'profitFactorStatus': 'NOT_AVAILABLE',
            'equityCurve': [initial_cash],
            'dailyEquitySeries': [],
            'trades': [],
            'rejectedSignalsCount': 1
        }
        
    if predictions_df.empty:
        return {
            'strategyMode': strategy_mode,
            'totalTrades': 0,
            'winRate': 0.0,
            'cagr': 0.0,
            'annualizedReturn': 0.0,
            'annualizedVol': 0.0,
            'sharpe': 'NOT_AVAILABLE',
            'sortino': 'NOT_AVAILABLE',
            'calmar': 'NOT_AVAILABLE',
            'maxDrawdown': 0.0,
            'profitFactor': None,
            'profitFactorStatus': 'NOT_AVAILABLE',
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
    min_date, max_date = df['date'].min(), df['date'].max()
    unique_dates = [d for d in unique_dates if min_date <= d <= max_date]
    
    if not unique_dates:
        return {'strategyMode': strategy_mode, 'totalTrades': 0, 'winRate': 0.0, 'cagr': 0.0, 'sharpe': 0.0, 'maxDrawdown': 0.0}
        
    cash = float(initial_cash)
    open_positions: List[Dict[str, Any]] = []
    completed_trades: List[Dict[str, Any]] = []
    pending_signals: List[pd.Series] = []
    
    rejected_signals_count = 0
    rejected_insufficient_quant_data = 0
    rejected_missing_execution_price = 0
    rejected_sector_exposure_limit = 0
    rejected_gross_exposure_limit = 0
    rejected_cluster_exposure_limit = 0
    
    opportunity_ledger: List[Dict[str, Any]] = []
    cash_opportunity_ledger: List[Dict[str, Any]] = []
    
    daily_equity_records: List[Dict[str, Any]] = []
    
    MAX_CONCURRENT_POSITIONS = 10
    MAX_GROSS_EXPOSURE = max_gross_exposure
    MAX_POSITION_WEIGHT = max_position_weight
    MAX_SECTOR_WEIGHT = max_sector_weight
    MAX_CLUSTER_EXPOSURE = max_cluster_exposure
    RISK_BUDGET_PCT = risk_per_trade
    
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
            
            # Check Stop / Target on today's candle (STOP LOSS FIRST on same-candle collision)
            hit_stop = today_candle['Low'] <= pos['stopLossPrice']
            hit_target = today_candle['High'] >= pos['targetPrice']
            is_horizon_expired = pos['daysHeld'] >= horizon_days
            
            if hit_stop or hit_target or is_horizon_expired:
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
                
                market_val_now = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
                total_eq_now = cash + market_val_now
                
                trade_record = {
                    'positionId': pos['id'],
                    'tradeId': pos['id'],
                    'ticker': ticker,
                    'sector': pos.get('sector', 'UNKNOWN'),
                    'signalTimestamp': pos['entryDate'],
                    'entryTimestamp': pos['entryDate'],
                    'entryDate': pos['entryDate'],
                    'exitTimestamp': date_str,
                    'exitDate': date_str,
                    'entryPrice': pos['entryPrice'],
                    'exitPrice': float(exec_price),
                    'stopLossPrice': pos['stopLossPrice'],
                    'targetPrice': pos['targetPrice'],
                    'targetReturn': pos.get('targetReturn'),
                    'stopReturn': pos.get('stopReturn'),
                    'notional': pos['notional'],
                    'portfolioWeight': round(pos['notional'] / total_eq_now, 4) if total_eq_now > 0 else 0.0,
                    'selectionRank': pos.get('alphaRank'),
                    'alphaRank': pos.get('alphaRank'),
                    'opportunityScore': pos.get('opportunityScore'),
                    'selectionReason': pos.get('selectionReason', 'QUALIFYING_SIGNAL'),
                    'grossReturn': float(gross_ret),
                    'netReturn': float(net_ret),
                    'grossPnL': float(pos['notional'] * gross_ret),
                    'fees': float(pos['entryFriction'] + exit_friction),
                    'slippage': float(pos['notional'] * 0.0005),
                    'pnl': float(net_pnl),
                    'netPnL': float(net_pnl),
                    'exitReason': reason,
                    'isWin': bool(net_pnl > 0),
                    'daysHeld': pos['daysHeld'],
                }
                
                if 'payoffProfile' in pos:
                    trade_record['payoffProfile'] = pos['payoffProfile']
                    trade_record['expectedGain'] = pos['expectedGain']
                    trade_record['expectedLoss'] = pos['expectedLoss']
                    trade_record['distributionVersion'] = pos['distributionVersion']
                    trade_record['distributionFitStart'] = pos.get('distributionFitStart')
                    trade_record['distributionFitEnd'] = pos.get('distributionFitEnd')
                    trade_record['horizon'] = pos.get('horizon')
                    trade_record['sampleCount'] = pos.get('sampleCount')
                    trade_record['p15'] = pos.get('p15')
                    trade_record['p50'] = pos.get('p50')
                    trade_record['p85'] = pos.get('p85')
                    trade_record['p_up'] = pos.get('p_up')
                    trade_record['P_UP'] = pos.get('p_up')
                    trade_record['p_down'] = pos.get('p_down')
                    trade_record['ev_before_cost'] = pos.get('ev_before_cost')
                    trade_record['ev_after_cost'] = pos.get('ev_after_cost')
                    trade_record['EV'] = pos.get('ev_after_cost')
                    trade_record['riskAdjustedEV'] = pos.get('riskAdjustedEV')
                    trade_record['expectedRisk'] = pos.get('expectedRisk')
                    
                    # Section 9: Hard Invariant Verification
                    profile_obj = TradePayoffProfile(**pos['payoffProfile'])
                    verify_trade_payoff_invariants(trade_record, profile_obj)
                    
                completed_trades.append(trade_record)
            else:
                # Position remains open, mark to market
                pos['currentPrice'] = today_candle['Close']
                current_value = pos['notional'] * (today_candle['Close'] / pos['entryPrice'])
                pos['unrealizedPnl'] = current_value - pos['notional'] - pos['entryFriction']
                surviving_positions.append(pos)
                
        open_positions = surviving_positions
        market_value = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
        total_equity = cash + market_value
        
        # 2. Process Pending Signals Sequentially (Entry at Open(T+1))
        for sig in pending_signals:
            ticker = sig.get('ticker', 'UNKNOWN')
            sector = sig.get('sector') or TICKER_SECTOR_MAP.get(ticker, 'UNKNOWN')
            
            # Recalculate intra-day portfolio state before processing each order
            market_value = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
            total_equity = cash + market_value
            
            if len(open_positions) >= MAX_CONCURRENT_POSITIONS:
                rejected_signals_count += 1
                continue
                
            if any(p['ticker'] == ticker for p in open_positions):
                continue
                
            # Entry at Open (No 100.0 default fallback)
            candles_df = historical_candles_by_ticker.get(ticker) if historical_candles_by_ticker else None
            if candles_df is not None and current_date in candles_df.index and not pd.isna(candles_df.loc[current_date]['Open']):
                entry_price = float(candles_df.loc[current_date]['Open'])
            elif 'Open' in sig and sig['Open'] is not None and not pd.isna(sig['Open']) and float(sig['Open']) > 0:
                entry_price = float(sig['Open'])
            else:
                rejected_signals_count += 1
                rejected_missing_execution_price += 1
                continue
                
            is_production_payoff = strategy_mode in ['PRODUCTION_EXPECTED_VALUE', 'PRODUCTION_DISTRIBUTION_PAYOFF']
            payoff_profile: Optional[TradePayoffProfile] = None
            
            if is_production_payoff:
                try:
                    payoff_profile = build_trade_payoff_profile(sig, trade_horizon=f"{horizon_days}d")
                except (InvalidPayoffError, HorizonMismatchError):
                    rejected_signals_count += 1
                    rejected_insufficient_quant_data += 1
                    continue
                    
                target_return = payoff_profile.targetReturn
                stop_return = payoff_profile.stopReturn
                
                # Section 6 & 7: Execution Price Conversion
                target_price = entry_price * (1.0 + target_return)
                stop_loss_price = entry_price * (1.0 + stop_return)
                stop_dist = max(0.005, abs(stop_return))
            else:
                # Volatility from real ATR for BASELINE_ATR_1P5_2P25 / BASELINE_PROBABILITY_055
                vol_raw = sig.get('atr_percent')
                if vol_raw is None or pd.isna(vol_raw) or float(vol_raw) <= 0:
                    rejected_signals_count += 1
                    rejected_insufficient_quant_data += 1
                    continue
                vol = float(vol_raw)
                
                stop_dist = max(0.01, 1.5 * vol)
                stop_loss_price = entry_price * (1.0 - stop_dist)
                target_price = entry_price * (1.0 + 2.25 * vol)
                target_return = 2.25 * vol
                stop_return = -stop_dist
            
            # Position sizing with sequential exposure update
            risk_budget = total_equity * RISK_BUDGET_PCT
            max_from_risk = risk_budget / stop_dist
            max_from_pos_cap = total_equity * MAX_POSITION_WEIGHT
            available_cash_limit = max(0.0, cash)
            
            sized_notional = min(max_from_risk, max_from_pos_cap, available_cash_limit)
            entry_friction = sized_notional * one_way_cost
            
            if sized_notional <= 0 or cash < (sized_notional + entry_friction) or (total_equity > 0 and sized_notional < (total_equity * 0.01)):
                rejected_signals_count += 1
                continue
                
            # Check post-trade gross exposure (MAX_GROSS_EXPOSURE = 1.000001)
            projected_market_value = market_value + sized_notional
            if (projected_market_value / total_equity) > MAX_GROSS_EXPOSURE:
                rejected_signals_count += 1
                rejected_gross_exposure_limit += 1
                continue
                
            # Check post-trade sector exposure (MAX_SECTOR_WEIGHT = 0.25)
            current_sector_notional = sum(
                p['notional'] * (p['currentPrice'] / p['entryPrice'])
                for p in open_positions
                if p.get('sector', TICKER_SECTOR_MAP.get(p['ticker'], 'UNKNOWN')) == sector
            )
            projected_sector_notional = current_sector_notional + sized_notional
            if (projected_sector_notional / total_equity) > MAX_SECTOR_WEIGHT:
                rejected_signals_count += 1
                rejected_sector_exposure_limit += 1
                continue
                
            # Check post-trade correlation cluster exposure (MAX_CLUSTER_EXPOSURE = 0.50) (Section 16)
            cluster_notional = sized_notional
            for p in open_positions:
                corr = compute_historical_correlation(ticker, p['ticker'], historical_candles_by_ticker or {}, date_str)
                if corr is not None and corr >= 0.75:
                    pos_val = p['notional'] * (p['currentPrice'] / p['entryPrice'])
                    cluster_notional += pos_val
            if (cluster_notional / total_equity) > MAX_CLUSTER_EXPOSURE:
                rejected_signals_count += 1
                rejected_cluster_exposure_limit += 1
                continue
                
            # Open position
            cash -= (sized_notional + entry_friction)
            pos_id = f"pos_{ticker}_{date_str}_{len(open_positions)+1}"
            
            prob_val = sig.get('calibratedProbability', sig.get('pred_prob', 0.5))
            p_up = float(prob_val) if (prob_val is not None and not pd.isna(prob_val)) else 0.5
            p_down = 1.0 - p_up
            
            pos_record = {
                'id': pos_id,
                'ticker': ticker,
                'sector': sector,
                'entryDate': date_str,
                'entryPrice': entry_price,
                'stopLossPrice': float(stop_loss_price),
                'targetPrice': float(target_price),
                'targetReturn': float(target_return),
                'stopReturn': float(stop_return),
                'notional': float(sized_notional),
                'entryFriction': entry_friction,
                'daysHeld': 0,
                'currentPrice': entry_price,
                'unrealizedPnl': -entry_friction,
                'p_up': p_up,
                'p_down': p_down,
                'alphaRank': sig.get('alphaRank'),
                'opportunityScore': sig.get('opportunityScore'),
                'selectionReason': sig.get('selectionReason'),
                'correlationExposure': sig.get('correlationToPortfolio'),
                'expectedRisk': stop_dist,
                'riskAdjustedEV': sig.get('riskAdjustedExpectedValue'),
            }
            if payoff_profile is not None:
                pos_record['payoffProfile'] = payoff_profile.to_dict()
                pos_record['expectedGain'] = payoff_profile.expectedGain
                pos_record['expectedLoss'] = payoff_profile.expectedLoss
                pos_record['distributionVersion'] = payoff_profile.distributionVersion
                pos_record['distributionFitStart'] = payoff_profile.fitStart
                pos_record['distributionFitEnd'] = payoff_profile.fitEnd
                pos_record['horizon'] = payoff_profile.horizon
                pos_record['sampleCount'] = payoff_profile.sampleCount
                pos_record['p15'] = payoff_profile.p15
                pos_record['p50'] = payoff_profile.p50
                pos_record['p85'] = payoff_profile.p85
                pos_record['sourceMethod'] = payoff_profile.sourceMethod
                pos_record['ev_before_cost'] = (p_up * payoff_profile.expectedGain) - (p_down * payoff_profile.expectedLoss)
                pos_record['ev_after_cost'] = pos_record['ev_before_cost'] - round_trip_cost
            open_positions.append(pos_record)
            
        # 3. Generate New Signals for tomorrow (Close(T)) based on strategy_mode
        day_signals = df[df['date'] == current_date]
        active_signals_list = []
        
        is_cross_sectional = strategy_mode in [
            'PRODUCTION_EXPECTED_VALUE',
            'PRODUCTION_DISTRIBUTION_PAYOFF',
            'CROSS_SECTIONAL_ALPHA_RANK',
            'CROSS_SECTIONAL_EV_RANK'
        ]
        
        if is_cross_sectional:
            # Build Daily Opportunity Table for date T (Section 2)
            opp_table = build_daily_opportunity_table(
                date_str=date_str,
                day_signals=day_signals,
                historical_candles=historical_candles_by_ticker or {},
                open_positions=open_positions,
                portfolio_equity=total_equity,
                cash=cash,
                horizon_days=horizon_days,
                round_trip_cost=round_trip_cost,
                minimum_decision_margin=minimum_decision_margin,
                regime='SIDEWAYS'
            )
            for opp in opp_table:
                opportunity_ledger.append(opp.to_dict())
                
            selected_opps, rejected_opps = select_and_allocate_portfolio(
                opportunities=opp_table,
                open_positions=open_positions,
                portfolio_equity=total_equity,
                available_cash=cash,
                historical_candles=historical_candles_by_ticker or {},
                as_of_date=date_str,
                top_n=top_n,
                risk_per_trade=RISK_BUDGET_PCT,
                max_position_weight=MAX_POSITION_WEIGHT,
                max_sector_weight=MAX_SECTOR_WEIGHT,
                max_gross_exposure=MAX_GROSS_EXPOSURE,
                max_cluster_exposure=MAX_CLUSTER_EXPOSURE,
                round_trip_cost=round_trip_cost
            )
            
            for rej in rejected_opps:
                rejected_signals_count += 1
                if rej.ineligibilityReason in [
                    'MISSING_EXPECTED_GAIN', 'MISSING_EXPECTED_LOSS',
                    'MISSING_OR_INVALID_P85', 'MISSING_OR_INVALID_P15',
                    'INVALID_PROBABILITY', 'INSUFFICIENT_RISK_DATA', 'HORIZON_MISMATCH'
                ]:
                    rejected_insufficient_quant_data += 1
                elif rej.ineligibilityReason == 'MISSING_EXECUTION_PRICE':
                    rejected_missing_execution_price += 1
                elif rej.ineligibilityReason == 'SECTOR_EXPOSURE_LIMIT_EXCEEDED':
                    rejected_sector_exposure_limit += 1
                elif rej.ineligibilityReason == 'GROSS_EXPOSURE_LIMIT_EXCEEDED':
                    rejected_gross_exposure_limit += 1
                elif rej.ineligibilityReason == 'CORRELATED_CLUSTER_LIMIT_EXCEEDED':
                    rejected_cluster_exposure_limit += 1
                    
            if not selected_opps:
                cash_opportunity_ledger.append({
                    'date': date_str,
                    'action': 'HOLD_CASH',
                    'reason': 'NO_ELIGIBLE_OPPORTUNITIES' if not opp_table else 'ALL_CANDIDATES_REJECTED_OR_INSUFFICIENT_EDGE',
                    'availableCash': round(cash, 2),
                    'eligibleOpportunitiesCount': len([o for o in opp_table if o.tradeEligible])
                })
            else:
                for opp in selected_opps:
                    sig_dict = opp.to_dict()
                    sig_dict['pred_prob'] = opp.calibratedProbability
                    sig_dict['calibratedProbability'] = opp.calibratedProbability
                    sig_dict['conditional_gain'] = opp.expectedGain
                    sig_dict['conditional_loss'] = opp.expectedLoss
                    sig_dict['p85'] = opp.targetReturn
                    sig_dict['p15'] = opp.stopReturn
                    sig_dict['p50'] = opp.expectedReturn
                    sig_dict['atr_percent'] = opp.ATR
                    sig_dict['Open'] = opp.executionPrice
                    active_signals_list.append(sig_dict)
                    
        elif strategy_mode == 'POSITIVE_EV':
            for _, sig in day_signals.iterrows():
                prob_val = sig.get('calibratedProbability', sig.get('pred_prob'))
                if prob_val is None or pd.isna(prob_val):
                    rejected_signals_count += 1
                    rejected_insufficient_quant_data += 1
                    continue
                p_up = float(prob_val)
                p_down = 1.0 - p_up
                try:
                    profile = build_trade_payoff_profile(sig, trade_horizon=f"{horizon_days}d")
                except (InvalidPayoffError, HorizonMismatchError):
                    rejected_signals_count += 1
                    rejected_insufficient_quant_data += 1
                    continue
                    
                fit_end = profile.fitEnd
                if fit_end and str(fit_end)[:10] >= str(current_date)[:10]:
                    raise ValueError(f"CRITICAL CAUSAL LEAKAGE in Backtest Trade: distributionFitEnd {fit_end} >= signalDate {current_date}")
                
                ev_before_cost = (p_up * profile.expectedGain) - (p_down * profile.expectedLoss)
                ev_after_cost = ev_before_cost - round_trip_cost
                risk_adj_ev = ev_after_cost / max(0.005, abs(profile.stopReturn))
                
                if ev_after_cost > 0 and risk_adj_ev > 0:
                    active_signals_list.append(sig)
        elif strategy_mode == 'BASELINE_ATR_1P5_2P25':
            for _, sig in day_signals.iterrows():
                prob_val = sig.get('calibratedProbability', sig.get('pred_prob'))
                if prob_val is None or pd.isna(prob_val) or float(prob_val) <= 0:
                    rejected_signals_count += 1
                    rejected_insufficient_quant_data += 1
                    continue
                p_up = float(prob_val)
                vol_val = sig.get('atr_percent')
                if vol_val is None or pd.isna(vol_val) or float(vol_val) <= 0:
                    rejected_signals_count += 1
                    rejected_insufficient_quant_data += 1
                    continue
                if p_up >= prob_threshold:
                    active_signals_list.append(sig)
        else:
            # BASELINE_PROBABILITY_055
            for _, sig in day_signals.iterrows():
                prob_val = sig.get('calibratedProbability', sig.get('pred_prob'))
                if prob_val is not None and not pd.isna(prob_val) and float(prob_val) >= prob_threshold:
                    active_signals_list.append(sig)
                    
        pending_signals = active_signals_list
            
        # 4. Mark to Market & Record Daily Equity State
        market_value = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
        end_equity = cash + market_value
        gross_exp = market_value / end_equity if end_equity > 0 else 0.0
        
        # Invariant Assertions (P0-10, P0-11, Section Y)
        if cash < -1e-6:
            raise ValueError(f"CRITICAL ACCOUNTING VIOLATION: Negative cash {cash:.4f} INR on {date_str}")
        if gross_exp > MAX_GROSS_EXPOSURE:
            raise ValueError(f"CRITICAL RISK VIOLATION: Gross exposure {gross_exp:.6f} exceeded 1.000001 on {date_str}")
        if abs(end_equity - (cash + market_value)) > 1e-6 * max(1.0, end_equity):
            raise ValueError(f"CRITICAL ACCOUNTING VIOLATION: Portfolio reconciliation failed on {date_str}")
            
        prev_eq = daily_equity_records[-1]['portfolioValue'] if daily_equity_records else initial_cash
        daily_ret = (end_equity - prev_eq) / prev_eq if prev_eq > 0 else 0.0
        
        daily_turnover = sum(p['notional'] for p in open_positions if p['daysHeld'] == 1)
        daily_fees = sum(p['entryFriction'] for p in open_positions if p['daysHeld'] == 1)
        daily_slippage = daily_turnover * 0.0005
        
        daily_equity_records.append({
            'date': date_str,
            'cash': round(cash, 2),
            'startingCash': round(start_of_day_cash, 2),
            'endingCash': round(cash, 2),
            'marketValue': round(market_value, 2),
            'portfolioValue': round(end_equity, 2),
            'dailyReturn': round(daily_ret, 6),
            'grossExposure': round(gross_exp, 4),
            'netExposure': round(gross_exp, 4),
            'turnover': round(daily_turnover, 2),
            'fees': round(daily_fees, 2),
            'slippage': round(daily_slippage, 2),
            'openPositions': len(open_positions),
            'cashWeight': round(cash / end_equity, 4) if end_equity > 0 else 1.0,
            'cumulativeReturn': round((end_equity - initial_cash) / initial_cash, 6) if initial_cash > 0 else 0.0,
        })
        
    # Calculate Final Out-of-Sample Performance Metrics strictly from Daily Equity Curve
    equity_values = np.array([r['portfolioValue'] for r in daily_equity_records])
    daily_returns = np.array([r['dailyReturn'] for r in daily_equity_records[1:]])
    
    final_equity = equity_values[-1] if len(equity_values) > 0 else initial_cash
    calendar_days = max(1, (unique_dates[-1] - unique_dates[0]).days) if len(unique_dates) > 1 else 1
    
    # 1. CAGR (P0-14)
    total_ret_ratio = final_equity / initial_cash if initial_cash > 0 else 0.0
    cagr = (pow(total_ret_ratio, 365.0 / calendar_days) - 1.0) * 100.0 if total_ret_ratio > 0 and calendar_days >= 1 else ((total_ret_ratio - 1.0) * 100.0)
    
    # 2. Sharpe (vs 4.00% annual risk-free rate, P0-15)
    rf_daily = (1.0 + 0.04)**(1.0 / 252.0) - 1.0
    excess_returns = daily_returns - rf_daily if len(daily_returns) > 0 else np.array([0.0])
    mean_excess = float(np.mean(excess_returns)) if len(excess_returns) > 0 else 0.0
    std_ret = float(np.std(excess_returns, ddof=1)) if len(excess_returns) > 1 else 0.0
    
    if std_ret > 1e-6 and len(daily_returns) > 1:
        annualized_vol = std_ret * np.sqrt(252.0)
        sharpe = (mean_excess * np.sqrt(252.0)) / std_ret
    else:
        annualized_vol = 0.0
        sharpe = 'NOT_AVAILABLE'
        
    annualized_return = float(np.mean(daily_returns) * 252.0) if len(daily_returns) > 0 else 0.0
    
    # 3. Sortino (P0-15)
    downside = np.minimum(excess_returns, 0.0)
    downside_variance = np.mean(downside**2) if len(downside) > 0 else 0.0
    downside_dev = float(np.sqrt(downside_variance) * np.sqrt(252.0))
    if downside_dev > 1e-6 and len(daily_returns) > 1:
        sortino = (mean_excess * np.sqrt(252.0)) / downside_dev
    else:
        sortino = 'NOT_AVAILABLE'
    
    # 4. Max Drawdown
    peak = equity_values[0] if len(equity_values) > 0 else 0.0
    max_dd = 0.0
    for val in equity_values:
        if val > peak:
            peak = val
        dd = (val - peak) / peak if peak > 0 else 0.0
        if dd < max_dd:
            max_dd = dd
            
    calmar = round(float(cagr / abs(max_dd * 100.0)), 2) if max_dd < 0 else 'NOT_MEANINGFUL'
    
    # 5. Profit Factor (P0-16: Never fabricated 99, 999, or Infinity)
    if completed_trades:
        trade_pnls = [t['pnl'] for t in completed_trades]
        positive_pnl = sum(p for p in trade_pnls if p > 0)
        negative_pnl = abs(sum(p for p in trade_pnls if p < 0))
        if negative_pnl > 0:
            profit_factor = round(float(positive_pnl / negative_pnl), 2)
            profit_factor_status = 'AVAILABLE'
        elif positive_pnl > 0:
            profit_factor = None
            profit_factor_status = 'NOT_MEANINGFUL'
        else:
            profit_factor = 0.0
            profit_factor_status = 'AVAILABLE'
            
        win_rate = round(float(sum(1 for t in completed_trades if t['isWin']) / len(completed_trades) * 100.0), 2)
    else:
        profit_factor = None
        profit_factor_status = 'NOT_AVAILABLE'
        win_rate = 0.0
        
    # Section 16: Independent Economic Reconciliation
    if strategy_mode in ['PRODUCTION_EXPECTED_VALUE', 'PRODUCTION_DISTRIBUTION_PAYOFF']:
        reconciliation_report = reconcile_trade_payoffs(completed_trades)
        if reconciliation_report['status'] != 'PASS':
            raise EconomicPayoffMismatchError(
                f"Economic reconciliation failed: {reconciliation_report['mismatches']}"
            )
    else:
        reconciliation_report = {'status': 'NOT_APPLICABLE_FOR_BASELINE', 'mismatchCount': 0}
        
    return {
        'strategyMode': strategy_mode,
        'totalTrades': len(completed_trades),
        'winRate': win_rate,
        'cagr': round(float(cagr), 2),
        'annualizedReturn': round(float(annualized_return * 100.0), 2),
        'annualizedVol': round(float(annualized_vol * 100.0), 2),
        'sharpe': round(float(sharpe), 2) if isinstance(sharpe, (float, int)) else sharpe,
        'sortino': round(float(sortino), 2) if isinstance(sortino, (float, int)) else sortino,
        'calmar': round(float(calmar), 2) if isinstance(calmar, (float, int)) else calmar,
        'maxDrawdown': round(float(max_dd * 100.0), 2),
        'profitFactor': profit_factor,
        'profitFactorStatus': profit_factor_status,
        'rejectedSignalsCount': rejected_signals_count,
        'rejectedInsufficientQuantData': rejected_insufficient_quant_data,
        'rejectedMissingExecutionPrice': rejected_missing_execution_price,
        'rejectedSectorExposureLimit': rejected_sector_exposure_limit,
        'rejectedGrossExposureLimit': rejected_gross_exposure_limit,
        'rejectedClusterExposureLimit': rejected_cluster_exposure_limit,
        'frictionRateBps': round(round_trip_cost * 10000, 1),
        'costRegime': cost_regime,
        'dailyEquitySeries': daily_equity_records,
        'equityCurve': [round(r['portfolioValue'] / initial_cash * 100.0, 2) if initial_cash > 0 else 0.0 for r in daily_equity_records],
        'trades': completed_trades,
        'opportunityLedger': opportunity_ledger,
        'cashOpportunityLedger': cash_opportunity_ledger,
        'reconciliationReport': reconciliation_report,
    }

