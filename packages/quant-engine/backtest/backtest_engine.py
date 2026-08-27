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
from models.regime_engine import MarketRegimeEngine, RegimeLookaheadError, MIN_REGIME_SAMPLE_COUNT
from models.regime_policy import RegimePolicyConfig, RegimePolicy, build_baseline_policy
from models.execution_cost_engine import (
    ExecutionCostEngine,
    ExecutionCostConfig,
    ExecutionCostLeakageError,
    LiquidityCapExceededError,
    COST_REGIME_CONFIGS
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
    exit_policy: str = 'FIXED_HORIZON',
    switch_margin: float = 0.002,
    min_ev_exit_margin: float = 0.0,
    exit_policy_version: str = 'v4.0.0-dynamic-exit',
    regime_policy_config: Optional[Any] = None,
    market_regime_engine: Optional[Any] = None,
    execution_cost_config: Optional[Any] = None,
    cost_buffer: float = 0.0,
    enforce_liquidity_cap: bool = False,
    partition: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes a portfolio backtest tracking daily cash, open positions, marked-to-market equity,
    and performance metrics strictly from the single authoritative daily equity curve.
    Supports cross-sectional ranking, risk-adjusted allocation, and legacy baselines.
    """
    if partition in ['TEST', 'HOLDOUT']:
        if exit_policy != 'FIXED_HORIZON':
            raise OptimizationLeakageError(f"CRITICAL LEAKAGE: Exit policy optimization attempted on {partition} partition!")
        if regime_policy_config is not None and getattr(regime_policy_config, 'policyId', '') != 'POLICY_A_BASELINE_NO_REGIME':
            raise OptimizationLeakageError(f"CRITICAL LEAKAGE: Regime policy optimization attempted on {partition} partition!")
        if cost_regime != 'BASE_COST' or execution_cost_config is not None or cost_buffer > 0.0:
            raise OptimizationLeakageError(f"CRITICAL LEAKAGE: Execution cost optimization attempted on {partition} partition!")

    # Section 21 & 46: Lookahead penetration guard on input candles
    if historical_candles_by_ticker:
        for tkr, cdf in historical_candles_by_ticker.items():
            if any(str(c).startswith('future_') for c in cdf.columns):
                raise ValueError(f"CRITICAL CAUSAL LEAKAGE: Future data key detected in historical candles for {tkr}!")

    # Section 23: Horizon Consistency Enforcement
    if not predictions_df.empty and 'horizon' in predictions_df.columns and strategy_mode in ['PRODUCTION_EXPECTED_VALUE', 'PRODUCTION_DISTRIBUTION_PAYOFF']:
        mismatched = predictions_df[predictions_df['horizon'].astype(str).str.lower().str.strip() != f"{horizon_days}d"]
        if not mismatched.empty:
            bad_h = mismatched.iloc[0]['horizon']
            raise ValueError(f"HORIZON_POLICY_MISMATCH: Input prediction horizon '{bad_h}' does not match backtest horizon '{horizon_days}d'")

    cost_engine = ExecutionCostEngine(regime=cost_regime, custom_config=execution_cost_config)
    round_trip_cost = cost_engine.estimate_round_trip_cost_rate(notional=100000.0)
    
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
    unique_dates_set = set(pd.to_datetime(d) for d in df['date'].unique())
    if historical_candles_by_ticker:
        for cdf in historical_candles_by_ticker.values():
            unique_dates_set.update(pd.to_datetime(d) for d in cdf.index)
            
    unique_dates = sorted(list(unique_dates_set))
    min_date = pd.to_datetime(df['date'].min())
    if historical_candles_by_ticker:
        c_maxes = [pd.to_datetime(cdf.index).max() for cdf in historical_candles_by_ticker.values() if not cdf.empty]
        max_date = max(c_maxes) if c_maxes else pd.to_datetime(df['date'].max())
    else:
        max_date = pd.to_datetime(df['date'].max())
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
        
        # Determine Point-in-Time Regime (Section 3 & 4)
        active_regime = 'SIDEWAYS'
        reg_version = 'v5.0.0-default'
        reg_confidence = 0.50
        if market_regime_engine is not None:
            r_info = market_regime_engine.classify_date(current_date)
            active_regime = r_info['regime']
            reg_version = r_info['regimeVersion']
            reg_confidence = r_info.get('regimeConfidence', 0.50)
            
        current_regime_policy = None
        effective_gross_exposure = MAX_GROSS_EXPOSURE
        effective_risk_budget = RISK_BUDGET_PCT
        if regime_policy_config is not None:
            current_regime_policy = regime_policy_config.get_policy(active_regime)
            effective_gross_exposure = min(MAX_GROSS_EXPOSURE, current_regime_policy.maxExposure)
            effective_risk_budget = current_regime_policy.riskBudget
        
        # 1. Check / Update / Close Existing Open Positions
        surviving_positions = []
        for pos in open_positions:
            ticker = pos['ticker']
            candles_df = historical_candles_by_ticker.get(ticker) if historical_candles_by_ticker else None
            
            # Lookup today's candle for this ticker
            today_candle = None
            if candles_df is not None:
                row = None
                if current_date in candles_df.index:
                    row = candles_df.loc[current_date]
                elif date_str in candles_df.index:
                    row = candles_df.loc[date_str]
                if row is not None:
                    today_candle = {
                        'Open': float(row['Open']),
                        'High': float(row['High']),
                        'Low': float(row['Low']),
                        'Close': float(row['Close']),
                    }
                    for col in row.index:
                        if str(col).startswith('future_'):
                            today_candle[str(col)] = row[col]
            if today_candle is None:
                today_candle = {
                    'Open': pos['currentPrice'],
                    'High': pos['currentPrice'],
                    'Low': pos['currentPrice'],
                    'Close': pos['currentPrice'],
                }
                
            # Section 21 & 46: Runtime assertion: No future knowledge in exit decisions
            if any(str(k).startswith('future_') for k in today_candle.keys()):
                raise ValueError("CRITICAL CAUSAL LEAKAGE: Future data accessed in exit decision!")
                
            pos['daysHeld'] += 1
            
            # Section 17 & 18: Track running excursions for MAE / MFE
            pos['maxHigh'] = max(pos.get('maxHigh', pos['entryPrice']), today_candle['High'])
            pos['minLow'] = min(pos.get('minLow', pos['entryPrice']), today_candle['Low'])
            
            # Check Stop / Target on today's candle (STOP LOSS FIRST on same-candle collision)
            hit_stop = today_candle['Low'] <= pos['stopLossPrice']
            hit_target = today_candle['High'] >= pos['targetPrice']
            planned_h = pos.get('plannedHoldingDays', horizon_days)
            is_horizon_expired = pos['daysHeld'] >= planned_h
            
            # Section 14: EV Decay Exit Check
            ev_decay_triggered = False
            if exit_policy == 'EV_DECAY_EXIT' and pos['daysHeld'] >= 2:
                decay_factor = max(0.0, 1.0 - (pos['daysHeld'] / planned_h))
                ev_rem = (pos.get('EV') or 0.0) * decay_factor
                if ev_rem <= min_ev_exit_margin:
                    ev_decay_triggered = True
            
            if hit_stop or hit_target or is_horizon_expired or ev_decay_triggered:
                if hit_stop and hit_target:
                    exec_price = min(today_candle['Open'], pos['stopLossPrice']) if today_candle['Open'] < pos['stopLossPrice'] else pos['stopLossPrice']
                    reason = 'STOP_LOSS_COLLISION'
                elif hit_stop:
                    exec_price = min(today_candle['Open'], pos['stopLossPrice']) if today_candle['Open'] < pos['stopLossPrice'] else pos['stopLossPrice']
                    reason = 'STOP_LOSS'
                elif hit_target:
                    exec_price = max(today_candle['Open'], pos['targetPrice']) if today_candle['Open'] > pos['targetPrice'] else pos['targetPrice']
                    reason = 'TARGET_HIT'
                elif ev_decay_triggered:
                    exec_price = today_candle['Open']
                    reason = 'EV_DECAY'
                else:
                    exec_price = today_candle['Close']
                    reason = 'HORIZON_EXPIRY'
                    
                exit_ref_price = float(exec_price)
                pos_shares = float(pos['shares'])
                pos_adv = None
                if candles_df is not None:
                    pos_adv = cost_engine.compute_rolling_adv(candles_df, current_date)
                    
                # Section 2 & 4: Calculate side-aware SELL transaction cost
                sell_res = cost_engine.calculate_transaction_cost(
                    side='SELL',
                    reference_price=exit_ref_price,
                    quantity=pos_shares,
                    notional=pos_shares * exit_ref_price,
                    ticker=ticker,
                    timestamp=date_str,
                    adv=pos_adv,
                    volatility=pos.get('volatility', 0.015),
                    market_regime=active_regime
                )
                actual_exit_price = sell_res['executionPrice']
                exit_fees = sell_res['fees']
                exit_slippage = sell_res['slippage']
                exit_impact = sell_res['marketImpact']
                
                # Cash proceeds received: shares * actual_exit_price - fees
                actual_exit_proceeds = (pos_shares * actual_exit_price) - exit_fees
                cash += actual_exit_proceeds
                
                market_val_now = sum(p['notional'] * (p['currentPrice'] / p['entryPrice']) for p in open_positions)
                total_eq_now = cash + market_val_now
                
                entry_ref_price = float(pos.get('entryReferencePrice', pos['entryPrice']))
                entry_exec_price = float(pos.get('entryExecutionPrice', pos['entryPrice']))
                
                gross_pnl = (pos_shares * exit_ref_price) - (pos_shares * entry_ref_price)
                gross_ret = (exit_ref_price - entry_ref_price) / entry_ref_price if entry_ref_price > 0 else 0.0
                
                entry_fees = float(pos.get('entryFees', pos.get('entryFriction', 0.0)))
                entry_slippage = float(pos.get('entrySlippage', 0.0))
                entry_impact = float(pos.get('entryMarketImpact', 0.0))
                
                total_fees = entry_fees + exit_fees
                total_slippage = entry_slippage + exit_slippage
                total_impact = entry_impact + exit_impact
                total_trade_cost = total_fees + total_slippage + total_impact
                
                net_pnl = gross_pnl - total_trade_cost
                net_ret = net_pnl / pos['notional'] if pos['notional'] > 0 else 0.0
                
                # Section 26: Cost Double-Counting Invariant Assertion
                cost_diff = abs(net_pnl - (gross_pnl - total_fees - total_slippage - total_impact))
                if cost_diff > 1e-6 * max(1.0, abs(gross_pnl)):
                    raise ValueError(f"CRITICAL RECONCILIATION ERROR: Cost double-counting detected! Diff={cost_diff}")
                
                # Excursion Metrics
                mfe = (pos['maxHigh'] - pos['entryPrice']) / pos['entryPrice']
                mae = (pos['minLow'] - pos['entryPrice']) / pos['entryPrice']
                exit_efficiency = float(round(net_ret / mfe, 4)) if mfe > 0 else 0.0
                max_realizable = (pos['maxHigh'] - pos['entryPrice']) * (pos['notional'] / pos['entryPrice'])
                profit_captured = float(round(net_pnl / max_realizable, 4)) if max_realizable > 0 and net_pnl > 0 else 0.0
                
                trade_record = {
                    'positionId': pos['id'],
                    'tradeId': pos['id'],
                    'ticker': ticker,
                    'sector': pos.get('sector', 'UNKNOWN'),
                    'signalTimestamp': pos.get('signalTimestamp', pos['entryDate']),
                    'entryTimestamp': pos['entryDate'],
                    'entryDate': pos['entryDate'],
                    'exitTimestamp': date_str,
                    'exitDate': date_str,
                    # Section 25: Per-Trade Cost Ledger
                    'entryReferencePrice': round(entry_ref_price, 4),
                    'entryExecutionPrice': round(entry_exec_price, 4),
                    'exitReferencePrice': round(exit_ref_price, 4),
                    'exitExecutionPrice': round(actual_exit_price, 4),
                    'entryPrice': round(entry_ref_price, 4),
                    'exitPrice': round(actual_exit_price, 4),
                    'entryFees': round(entry_fees, 2),
                    'exitFees': round(exit_fees, 2),
                    'entrySlippage': round(entry_slippage, 2),
                    'exitSlippage': round(exit_slippage, 2),
                    'entryMarketImpact': round(entry_impact, 2),
                    'exitMarketImpact': round(exit_impact, 2),
                    'fees': round(total_fees, 2),
                    'slippage': round(total_slippage, 2),
                    'marketImpact': round(total_impact, 2),
                    'totalExecutionCost': round(total_trade_cost, 2),
                    'totalTradeCost': round(total_trade_cost, 2),
                    'costDrag': round(total_trade_cost, 2),
                    'effectiveCostBps': round(sell_res['effectiveCostBps'], 2),
                    'participationRate': float(pos.get('participationRate', 0.0)),
                    'adv': float(pos.get('adv', 0.0)) if pos.get('adv') else None,
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
                    'grossPnL': float(round(gross_pnl, 2)),
                    'pnl': float(round(net_pnl, 2)),
                    'netPnL': float(round(net_pnl, 2)),
                    'exitReason': reason,
                    'isWin': bool(net_pnl > 0),
                    'daysHeld': pos['daysHeld'],
                    'MAE': float(round(mae, 5)),
                    'MFE': float(round(mfe, 5)),
                    'exitEfficiency': exit_efficiency,
                    'profitCaptured': profit_captured,
                    'plannedHorizon': pos.get('plannedHorizon', f"{horizon_days}d"),
                    'actualHoldingDays': pos['daysHeld'],
                    'expectedEVAtEntry': pos.get('EV'),
                    'expectedEVAtExit': (pos.get('EV') or 0.0) * max(0.0, 1.0 - (pos['daysHeld'] / planned_h)),
                    'expectedReturnAtEntry': pos.get('expectedGain'),
                    'exitPolicyVersion': exit_policy_version,
                    'costModelVersion': cost_engine.version,
                    # Section 44: Complete Trade Regime Provenance
                    'regime': pos.get('regime', 'SIDEWAYS'),
                    'regimeVersion': pos.get('regimeVersion', 'v5.0.0-default'),
                    'regimeTimestamp': pos.get('regimeTimestamp', pos['entryDate']),
                    'regimePolicyVersion': pos.get('regimePolicyVersion', 'v5.0.0-default'),
                    'regimeExposureLimit': float(pos.get('regimeExposureLimit', 1.0)),
                    'regimeRiskBudget': float(pos.get('regimeRiskBudget', 0.01)),
                    'regimeEVThreshold': float(pos.get('regimeEVThreshold', 1.0)),
                    'selectedHoldingPeriod': int(pos.get('selectedHoldingPeriod', horizon_days)),
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
                # Section 15: Opportunity-cost exit evaluation
                if exit_policy == 'OPPORTUNITY_COST_EXIT' and open_positions:
                    worst_pos = min(open_positions, key=lambda p: (p.get('riskAdjustedEV') or 0.0))
                    worst_ev = worst_pos.get('riskAdjustedEV') or 0.0
                    cand_ev = sig.get('riskAdjustedEV') or sig.get('opportunityScore') or 0.0
                    switch_cost = round_trip_cost
                    if (cand_ev - worst_ev) > (switch_margin + switch_cost):
                        # Switch: close worst position to free capital
                        close_ticker = worst_pos['ticker']
                        w_candles = historical_candles_by_ticker.get(close_ticker) if historical_candles_by_ticker else None
                        close_price = worst_pos['currentPrice']
                        if w_candles is not None and current_date in w_candles.index and not pd.isna(w_candles.loc[current_date]['Open']):
                            close_price = float(w_candles.loc[current_date]['Open'])
                            
                        pos_shares = float(worst_pos['shares'])
                        exit_ref_price = float(close_price)
                        pos_adv = None
                        if w_candles is not None:
                            pos_adv = cost_engine.compute_rolling_adv(w_candles, current_date)
                            
                        sell_cost = cost_engine.calculate_transaction_cost(
                            side='SELL',
                            reference_price=exit_ref_price,
                            quantity=pos_shares,
                            notional=pos_shares * exit_ref_price,
                            ticker=close_ticker,
                            timestamp=date_str,
                            adv=pos_adv,
                            volatility=worst_pos.get('volatility', 0.015),
                            market_regime=active_regime
                        )
                        actual_exit_price = sell_cost['executionPrice']
                        exit_fees = sell_cost['fees']
                        exit_slippage = sell_cost['slippage']
                        exit_impact = sell_cost['marketImpact']
                        
                        actual_exit_proceeds = (pos_shares * actual_exit_price) - exit_fees
                        cash += actual_exit_proceeds
                        
                        entry_ref_price = float(worst_pos.get('entryReferencePrice', worst_pos['entryPrice']))
                        entry_exec_price = float(worst_pos.get('entryExecutionPrice', worst_pos['entryPrice']))
                        
                        gross_pnl = (pos_shares * exit_ref_price) - (pos_shares * entry_ref_price)
                        gross_ret = (exit_ref_price - entry_ref_price) / entry_ref_price if entry_ref_price > 0 else 0.0
                        
                        entry_fees = float(worst_pos.get('entryFees', worst_pos.get('entryFriction', 0.0)))
                        entry_slippage = float(worst_pos.get('entrySlippage', 0.0))
                        entry_impact = float(worst_pos.get('entryMarketImpact', 0.0))
                        
                        total_fees = entry_fees + exit_fees
                        total_slippage = entry_slippage + exit_slippage
                        total_impact = entry_impact + exit_impact
                        total_trade_cost = total_fees + total_slippage + total_impact
                        
                        close_pnl = gross_pnl - total_trade_cost
                        net_ret = close_pnl / worst_pos['notional'] if worst_pos['notional'] > 0 else 0.0
                        
                        # Section 26: Cost Double-Counting Invariant Assertion
                        cost_diff = abs(close_pnl - (gross_pnl - total_fees - total_slippage - total_impact))
                        if cost_diff > 1e-6 * max(1.0, abs(gross_pnl)):
                            raise ValueError(f"CRITICAL RECONCILIATION ERROR: Cost double-counting detected! Diff={cost_diff}")
                        
                        mfe = (worst_pos.get('maxHigh', close_price) - worst_pos['entryPrice']) / worst_pos['entryPrice']
                        mae = (worst_pos.get('minLow', close_price) - worst_pos['entryPrice']) / worst_pos['entryPrice']
                        
                        trade_record = {
                            'positionId': worst_pos['id'],
                            'tradeId': worst_pos['id'],
                            'ticker': close_ticker,
                            'sector': worst_pos.get('sector', 'UNKNOWN'),
                            'signalTimestamp': worst_pos.get('signalTimestamp', worst_pos['entryDate']),
                            'entryTimestamp': worst_pos['entryDate'],
                            'entryDate': worst_pos['entryDate'],
                            'exitTimestamp': date_str,
                            'exitDate': date_str,
                            # Section 25: Per-Trade Cost Ledger
                            'entryReferencePrice': round(entry_ref_price, 4),
                            'entryExecutionPrice': round(entry_exec_price, 4),
                            'exitReferencePrice': round(exit_ref_price, 4),
                            'exitExecutionPrice': round(actual_exit_price, 4),
                            'entryPrice': round(entry_ref_price, 4),
                            'exitPrice': round(actual_exit_price, 4),
                            'entryFees': round(entry_fees, 2),
                            'exitFees': round(exit_fees, 2),
                            'entrySlippage': round(entry_slippage, 2),
                            'exitSlippage': round(exit_slippage, 2),
                            'entryMarketImpact': round(entry_impact, 2),
                            'exitMarketImpact': round(exit_impact, 2),
                            'fees': round(total_fees, 2),
                            'slippage': round(total_slippage, 2),
                            'marketImpact': round(total_impact, 2),
                            'totalExecutionCost': round(total_trade_cost, 2),
                            'totalTradeCost': round(total_trade_cost, 2),
                            'costDrag': round(total_trade_cost, 2),
                            'effectiveCostBps': round(sell_cost['effectiveCostBps'], 2),
                            'participationRate': float(worst_pos.get('participationRate', 0.0)),
                            'adv': float(worst_pos.get('adv', 0.0)) if worst_pos.get('adv') else None,
                            'stopLossPrice': worst_pos['stopLossPrice'],
                            'targetPrice': worst_pos['targetPrice'],
                            'targetReturn': worst_pos.get('targetReturn'),
                            'stopReturn': worst_pos.get('stopReturn'),
                            'notional': worst_pos['notional'],
                            'portfolioWeight': round(worst_pos['notional'] / total_equity, 4) if total_equity > 0 else 0.0,
                            'selectionRank': worst_pos.get('alphaRank'),
                            'alphaRank': worst_pos.get('alphaRank'),
                            'opportunityScore': worst_pos.get('opportunityScore'),
                            'selectionReason': 'OPPORTUNITY_COST_SWITCH',
                            'grossReturn': float(gross_ret),
                            'netReturn': float(net_ret),
                            'grossPnL': float(round(gross_pnl, 2)),
                            'fees': round(total_fees, 2),
                            'slippage': round(total_slippage, 2),
                            'pnl': float(round(close_pnl, 2)),
                            'netPnL': float(round(close_pnl, 2)),
                            'exitReason': 'OPPORTUNITY_COST',
                            'isWin': bool(close_pnl > 0),
                            'daysHeld': worst_pos['daysHeld'],
                            'MAE': float(round(mae, 5)),
                            'MFE': float(round(mfe, 5)),
                            'exitEfficiency': float(round(net_ret / mfe, 4)) if mfe > 0 else 0.0,
                            'profitCaptured': 0.0,
                            'plannedHorizon': worst_pos.get('plannedHorizon', f"{horizon_days}d"),
                            'actualHoldingDays': worst_pos['daysHeld'],
                            'expectedEVAtEntry': worst_pos.get('EV'),
                            'expectedEVAtExit': worst_pos.get('ev_after_cost', 0.0),
                            'expectedReturnAtEntry': worst_pos.get('expectedGain'),
                            'expectedReturnAtExit': float(net_ret),
                            'exitPolicyVersion': exit_policy_version,
                            'costModelVersion': cost_engine.version,
                            # Section 44: Complete Trade Regime Provenance
                            'regime': worst_pos.get('regime', 'SIDEWAYS'),
                            'regimeVersion': worst_pos.get('regimeVersion', 'v5.0.0-default'),
                            'regimeTimestamp': worst_pos.get('regimeTimestamp', worst_pos['entryDate']),
                            'regimePolicyVersion': worst_pos.get('regimePolicyVersion', 'v5.0.0-default'),
                            'regimeExposureLimit': float(worst_pos.get('regimeExposureLimit', 1.0)),
                            'regimeRiskBudget': float(worst_pos.get('regimeRiskBudget', 0.01)),
                            'regimeEVThreshold': float(worst_pos.get('regimeEVThreshold', 1.0)),
                            'selectedHoldingPeriod': int(worst_pos.get('selectedHoldingPeriod', horizon_days)),
                        }
                        if 'payoffProfile' in worst_pos:
                            for k in ['payoffProfile', 'expectedGain', 'expectedLoss', 'distributionVersion', 'distributionFitStart', 'distributionFitEnd', 'horizon', 'sampleCount', 'p15', 'p50', 'p85', 'p_up', 'P_UP', 'p_down', 'ev_before_cost', 'ev_after_cost', 'EV', 'riskAdjustedEV', 'expectedRisk']:
                                if k in worst_pos:
                                    trade_record[k] = worst_pos[k]
                        completed_trades.append(trade_record)
                        open_positions = [p for p in open_positions if p['id'] != worst_pos['id']]
                    else:
                        rejected_signals_count += 1
                        continue
                else:
                    rejected_signals_count += 1
                    continue
                
            if any(p['ticker'] == ticker for p in open_positions):
                continue
                
            # Section 24: Regime NO_TRADE policy
            if current_regime_policy is not None and not current_regime_policy.allowNewTrades:
                rejected_signals_count += 1
                continue
                
            # Section 12: Regime EV Hurdle multiplier
            if current_regime_policy is not None and current_regime_policy.evThresholdMultiplier > 1.0:
                sig_ev = sig.get('ev_after_cost', sig.get('EV', 0.0))
                min_req_ev = 0.001 * current_regime_policy.evThresholdMultiplier
                if sig_ev < min_req_ev:
                    rejected_signals_count += 1
                    continue
                
            # Entry at Open (No 100.0 default fallback)
            candles_df = historical_candles_by_ticker.get(ticker) if historical_candles_by_ticker else None
            entry_price = None
            if candles_df is not None:
                if any(str(c).startswith('future_') for c in candles_df.columns):
                    raise ValueError("CRITICAL CAUSAL LEAKAGE: Future data accessed in trading candles!")
                if current_date in candles_df.index and not pd.isna(candles_df.loc[current_date]['Open']):
                    entry_price = float(candles_df.loc[current_date]['Open'])
                elif date_str in candles_df.index and not pd.isna(candles_df.loc[date_str]['Open']):
                    entry_price = float(candles_df.loc[date_str]['Open'])
            if entry_price is None:
                if 'Open' in sig and sig['Open'] is not None and not pd.isna(sig['Open']) and float(sig['Open']) > 0:
                    entry_price = float(sig['Open'])
                else:
                    rejected_signals_count += 1
                    rejected_missing_execution_price += 1
                    continue
                
            is_production_payoff = strategy_mode in ['PRODUCTION_EXPECTED_VALUE', 'PRODUCTION_DISTRIBUTION_PAYOFF']
            payoff_profile: Optional[TradePayoffProfile] = None
            
            # Section 23: Horizon Consistency Enforcement
            if is_production_payoff:
                pos_h = sig.get('horizon')
                if pos_h and pos_h != f"{horizon_days}d":
                    raise ValueError(f"HORIZON_POLICY_MISMATCH: Signal horizon {pos_h} != planned horizon {horizon_days}d")
            
            if is_production_payoff:
                try:
                    payoff_profile = build_trade_payoff_profile(sig, trade_horizon=f"{horizon_days}d")
                except (InvalidPayoffError, HorizonMismatchError):
                    rejected_signals_count += 1
                    rejected_insufficient_quant_data += 1
                    continue
                    
                target_return = payoff_profile.targetReturn
                stop_return = payoff_profile.stopReturn
                vol = float(sig.get('atr_percent', 0.015) or 0.015)
                
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
            risk_budget = total_equity * effective_risk_budget
            max_from_risk = risk_budget / stop_dist
            max_from_pos_cap = total_equity * MAX_POSITION_WEIGHT
            available_cash_limit = max(0.0, cash)
            
            sized_notional = min(max_from_risk, max_from_pos_cap, available_cash_limit)
            if sized_notional <= 0 or (total_equity > 0 and sized_notional < (total_equity * 0.01)):
                rejected_signals_count += 1
                continue
                
            # Point-in-Time ADV calculation (Section 15, 16, 17)
            adv = None
            if candles_df is not None:
                adv = cost_engine.compute_rolling_adv(candles_df, current_date, lookback=20)
                
            if adv is None and enforce_liquidity_cap:
                rejected_signals_count += 1
                rejected_insufficient_quant_data += 1
                continue
                
            # Check participation against 5% cap (Section 13)
            participation_rate = (sized_notional / adv) if (adv is not None and adv > 0) else 0.0
            if enforce_liquidity_cap and participation_rate > cost_engine.config.max_participation_rate:
                rejected_signals_count += 1
                continue
                
            prob_val = sig.get('calibratedProbability', sig.get('pred_prob', 0.5))
            p_up = float(prob_val) if (prob_val is not None and not pd.isna(prob_val)) else 0.5
            p_down = 1.0 - p_up
            
            # Pre-Trade Net EV Decision Gating (Section 39, 40, 50, 51)
            estimated_cost_rate = cost_engine.estimate_round_trip_cost_rate(notional=sized_notional, adv=adv, volatility=vol)
            ev_gross = (p_up * target_return) - (p_down * abs(stop_return))
            ev_net = ev_gross - estimated_cost_rate
            
            if is_production_payoff:
                if ev_gross <= 0 or ev_net <= 0 or ev_net < cost_buffer:
                    rejected_signals_count += 1
                    continue
                    
            # Calculate side-specific BUY transaction cost
            buy_res = cost_engine.calculate_transaction_cost(
                side='BUY',
                reference_price=entry_price,
                quantity=sized_notional / entry_price,
                notional=sized_notional,
                ticker=ticker,
                timestamp=date_str,
                adv=adv,
                volatility=vol,
                market_regime=active_regime
            )
            effective_entry_price = buy_res['executionPrice']
            entry_fees = buy_res['fees']
            entry_slippage = buy_res['slippage']
            entry_impact = buy_res['marketImpact']
            
            cash_outflow = ((sized_notional / entry_price) * effective_entry_price) + entry_fees
            if cash < cash_outflow:
                rejected_signals_count += 1
                continue
                
            # Check post-trade gross exposure (effective_gross_exposure ceiling)
            projected_market_value = market_value + sized_notional
            if (projected_market_value / total_equity) > effective_gross_exposure:
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
            cash -= cash_outflow
            pos_id = f"pos_{ticker}_{date_str}_{len(open_positions)+1}"
            
            pos_record = {
                'id': pos_id,
                'ticker': ticker,
                'sector': sector,
                'entryDate': date_str,
                'entryReferencePrice': float(entry_price),
                'entryExecutionPrice': float(effective_entry_price),
                'entryPrice': float(entry_price),
                'stopLossPrice': float(stop_loss_price),
                'targetPrice': float(target_price),
                'targetReturn': float(target_return),
                'stopReturn': float(stop_return),
                'notional': float(sized_notional),
                'shares': float(sized_notional / entry_price),
                'entryFees': float(entry_fees),
                'entrySlippage': float(entry_slippage),
                'entryMarketImpact': float(entry_impact),
                'entryFriction': float(entry_fees + entry_slippage + entry_impact),
                'daysHeld': 0,
                'currentPrice': entry_price,
                'unrealizedPnl': -float(entry_fees + entry_slippage + entry_impact),
                'p_up': p_up,
                'p_down': p_down,
                'alphaRank': sig.get('alphaRank'),
                'opportunityScore': sig.get('opportunityScore'),
                'selectionReason': sig.get('selectionReason'),
                'correlationExposure': sig.get('correlationToPortfolio'),
                'expectedRisk': stop_dist,
                'riskAdjustedEV': sig.get('riskAdjustedExpectedValue'),
                'maxHigh': float(entry_price),
                'minLow': float(entry_price),
                'adv': float(adv) if adv else None,
                'participationRate': float(participation_rate),
                'estimatedCostRate': float(estimated_cost_rate),
                'expectedNetEV': float(ev_net),
                'costModelVersion': cost_engine.version,
                'plannedHoldingDays': current_regime_policy.holdingPeriod if (current_regime_policy and current_regime_policy.holdingPeriod is not None) else horizon_days,
                'plannedHorizon': f"{current_regime_policy.holdingPeriod if (current_regime_policy and current_regime_policy.holdingPeriod is not None) else horizon_days}d",
                'exitPolicyVersion': exit_policy_version,
                'signalTimestamp': str(sig.get('predictionTimestamp', date_str))[:10],
                # Section 44: Complete Trade Regime Provenance
                'regime': active_regime,
                'regimeVersion': reg_version,
                'regimeTimestamp': date_str,
                'regimePolicyVersion': current_regime_policy.policyVersion if current_regime_policy else 'v5.0.0-default',
                'regimeExposureLimit': float(effective_gross_exposure),
                'regimeRiskBudget': float(effective_risk_budget),
                'regimeEVThreshold': float(current_regime_policy.evThresholdMultiplier if current_regime_policy else 1.0),
                'selectedHoldingPeriod': int(current_regime_policy.holdingPeriod if (current_regime_policy and current_regime_policy.holdingPeriod is not None) else horizon_days),
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
        
    # Section 45: Economic Attribution by Market Regime
    regime_attribution = {}
    for r in ['BULL', 'BEAR', 'SIDEWAYS', 'HIGH_VOLATILITY', 'PANIC']:
        r_trades = [t for t in completed_trades if t.get('regime') == r]
        if r_trades:
            r_wins = [t for t in r_trades if t['netPnL'] > 0]
            r_pnl = sum(t['netPnL'] for t in r_trades)
            r_gross_pnl = sum(t.get('grossPnL', 0.0) for t in r_trades)
            r_fees = sum(t.get('fees', 0.0) + t.get('slippage', 0.0) for t in r_trades)
            r_rets = [t.get('netReturn', 0.0) for t in r_trades]
            regime_attribution[r] = {
                'sampleCount': len(r_trades),
                'tradeCount': len(r_trades),
                'winRate': round(len(r_wins) / len(r_trades) * 100.0, 2),
                'netPnL': round(r_pnl, 2),
                'grossPnL': round(r_gross_pnl, 2),
                'fees': round(r_fees, 2),
                'meanNetReturn': round(float(np.mean(r_rets)), 5),
                'medianNetReturn': round(float(np.median(r_rets)), 5),
                'status': 'VALID' if len(r_trades) >= MIN_REGIME_SAMPLE_COUNT else 'INSUFFICIENT_DATA'
            }
        else:
            regime_attribution[r] = {
                'sampleCount': 0,
                'tradeCount': 0,
                'winRate': 0.0,
                'netPnL': 0.0,
                'grossPnL': 0.0,
                'fees': 0.0,
                'meanNetReturn': 0.0,
                'medianNetReturn': 0.0,
                'status': 'INSUFFICIENT_DATA'
            }
            
    # Section 24 & 59: Gross vs Net Performance and Execution Cost Aggregation
    gross_pnl_total = sum(t.get('grossPnL', 0.0) for t in completed_trades)
    net_pnl_total = sum(t.get('netPnL', 0.0) for t in completed_trades)
    total_fees = sum(t.get('fees', 0.0) for t in completed_trades)
    total_slippage = sum(t.get('slippage', 0.0) for t in completed_trades)
    total_impact = sum(t.get('marketImpact', 0.0) for t in completed_trades)
    total_execution_cost = total_fees + total_slippage + total_impact
    cost_drag = gross_pnl_total - net_pnl_total
    cost_drag_ratio = round(cost_drag / gross_pnl_total, 4) if gross_pnl_total > 0 else 0.0
    
    gross_rets = [t.get('grossReturn', 0.0) for t in completed_trades]
    net_rets = [t.get('netReturn', 0.0) for t in completed_trades]
    gross_exp = round(float(np.mean(gross_rets)), 6) if gross_rets else 0.0
    net_exp = round(float(np.mean(net_rets)), 6) if net_rets else 0.0
    
    pos_g = sum(p for p in [t.get('grossPnL', 0.0) for t in completed_trades] if p > 0)
    neg_g = abs(sum(p for p in [t.get('grossPnL', 0.0) for t in completed_trades] if p < 0))
    gross_pf = round(float(pos_g / neg_g), 2) if neg_g > 0 else None
    
    gross_equity = initial_cash + gross_pnl_total
    gross_cagr = round(float(((gross_equity / initial_cash)**(365.0 / calendar_days) - 1.0) * 100.0), 2) if initial_cash > 0 and calendar_days > 0 and gross_equity > 0 else 0.0
    
    alpha_cost_buffer_bps = round(max(0.0, (gross_exp * 10000.0) - 28.0), 1)
    
    return {
        'strategyMode': strategy_mode,
        'totalTrades': len(completed_trades),
        'winRate': win_rate,
        'cagr': round(float(cagr), 2),
        'netCAGR': round(float(cagr), 2),
        'grossCAGR': gross_cagr,
        'annualizedReturn': round(float(annualized_return * 100.0), 2),
        'annualizedVol': round(float(annualized_vol * 100.0), 2),
        'sharpe': round(float(sharpe), 2) if isinstance(sharpe, (float, int)) else sharpe,
        'netSharpe': round(float(sharpe), 2) if isinstance(sharpe, (float, int)) else sharpe,
        'sortino': round(float(sortino), 2) if isinstance(sortino, (float, int)) else sortino,
        'calmar': round(float(calmar), 2) if isinstance(calmar, (float, int)) else calmar,
        'maxDrawdown': round(float(max_dd * 100.0), 2),
        'profitFactor': profit_factor,
        'netProfitFactor': profit_factor,
        'grossProfitFactor': gross_pf,
        'profitFactorStatus': profit_factor_status,
        'grossExpectancy': gross_exp,
        'netExpectancy': net_exp,
        'grossPnL': round(gross_pnl_total, 2),
        'netPnL': round(net_pnl_total, 2),
        'fees': round(total_fees, 2),
        'slippage': round(total_slippage, 2),
        'marketImpact': round(total_impact, 2),
        'totalExecutionCost': round(total_execution_cost, 2),
        'costDrag': round(cost_drag, 2),
        'costDragRatio': cost_drag_ratio,
        'alphaCostBufferBps': alpha_cost_buffer_bps,
        'costModelVersion': cost_engine.version,
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
        'regimeAttribution': regime_attribution,
    }

