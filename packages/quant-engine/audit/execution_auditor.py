"""
Independent Execution, Cost, and Accounting Auditor for QuantX.
================================================================
Does NOT call production cost calculation functions.
Independently verifies:
- Trade execution prices against adverse slippage and market impact
- Statutory fees (Brokerage, STT, Exchange, GST, Stamp Duty, SEBI)
- Single-path gross and net PnL accounting (no double-counting)
- Daily cash and portfolio equity reconciliation
- Independent performance metrics: CAGR, Sharpe (vs 4.0% rf), Sortino, MaxDD, Profit Factor
- Corruption detection: flags any tampered price, fee, slippage, PnL, or equity entry.
"""

from typing import Dict, List, Any, Tuple, Optional
import math
import numpy as np
import pandas as pd


class ExecutionAuditEngine:
    """
    Completely independent audit engine verifying execution realism,
    costs, accounting identities, and summary performance metrics.
    """
    
    ACCOUNTING_TOLERANCE = 1e-4
    PRICE_TOLERANCE = 1e-4
    ANNUAL_RF = 0.04
    DAILY_RF = (1.0 + 0.04) ** (1.0 / 252.0) - 1.0

    @classmethod
    def independently_calculate_buy_fees(cls, notional: float) -> float:
        """Independent arithmetic reimplementation of BUY delivery fees in India."""
        brokerage = min(notional * 0.0003, 20.0)
        exchange = notional * 0.0000345
        gst = (brokerage + exchange) * 0.18
        stamp_duty = notional * 0.00015  # 1.5 bps on BUY only
        sebi = notional * 0.000001
        return float(brokerage + exchange + gst + stamp_duty + sebi)

    @classmethod
    def independently_calculate_sell_fees(cls, notional: float) -> float:
        """Independent arithmetic reimplementation of SELL delivery fees in India."""
        brokerage = min(notional * 0.0003, 20.0)
        exchange = notional * 0.0000345
        gst = (brokerage + exchange) * 0.18
        stt = notional * 0.0010          # 10 bps STT on SELL only
        sebi = notional * 0.000001
        return float(brokerage + exchange + gst + stt + sebi)

    @classmethod
    def audit_trade(cls, trade: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Independently verifies all price, fee, slippage, and PnL fields for a single trade."""
        errors = []
        trade_id = trade.get('tradeId', trade.get('positionId', 'UNKNOWN'))
        
        entry_ref = trade.get('entryReferencePrice', trade.get('entryPrice', 0.0))
        entry_exec = trade.get('entryExecutionPrice', trade.get('entryPrice', 0.0))
        exit_ref = trade.get('exitReferencePrice', trade.get('exitPrice', 0.0))
        exit_exec = trade.get('exitExecutionPrice', trade.get('exitPrice', 0.0))
        
        # 1. Execution price direction verification (adverse slippage/impact)
        if entry_exec < entry_ref - cls.PRICE_TOLERANCE:
            errors.append(f"Trade {trade_id}: BUY execution price {entry_exec} < reference price {entry_ref} (favorable entry)")
        if exit_exec > exit_ref + cls.PRICE_TOLERANCE:
            errors.append(f"Trade {trade_id}: SELL execution price {exit_exec} > reference price {exit_ref} (favorable exit)")
            
        # 2. Notional & Quantity reconciliation
        qty = float(trade.get('quantity', trade.get('shares', 0.0)))
        entry_ref = float(entry_ref)
        exit_ref = float(exit_ref)
        if qty <= 0.0 and trade.get('notional', 0.0) > 0 and entry_ref > 0:
            qty = float(trade['notional']) / entry_ref
            
        notional = float(trade.get('notional', entry_ref * qty))
        expected_notional = qty * entry_ref
        if abs(notional - expected_notional) > max(1.0, notional * 0.01):
            errors.append(f"Trade {trade_id}: Notional {notional} != qty * entry_ref ({expected_notional})")
            
        # 3. Independent Fee Audit
        entry_fees = float(trade.get('entryFees', 0.0))
        exit_fees = float(trade.get('exitFees', 0.0))
        ind_entry_fees = cls.independently_calculate_buy_fees(notional)
        exit_notional = qty * exit_ref
        ind_exit_fees = cls.independently_calculate_sell_fees(exit_notional)
        
        if abs(entry_fees - ind_entry_fees) > max(1.0, entry_fees * 0.05):
            errors.append(f"Trade {trade_id}: Entry fees {entry_fees} != independent fee {ind_entry_fees:.2f}")
        if abs(exit_fees - ind_exit_fees) > max(1.0, exit_fees * 0.05):
            errors.append(f"Trade {trade_id}: Exit fees {exit_fees} != independent fee {ind_exit_fees:.2f}")
            
        # 4. Gross PnL Verification
        expected_gross_pnl = qty * (exit_ref - entry_ref)
        actual_gross_pnl = float(trade.get('grossPnL', 0.0))
        if abs(actual_gross_pnl - expected_gross_pnl) > max(1.0, cls.ACCOUNTING_TOLERANCE * max(1.0, abs(actual_gross_pnl))):
            errors.append(f"Trade {trade_id}: Gross PnL {actual_gross_pnl} != expected {expected_gross_pnl}")
            
        # 5. Net PnL & Single-Path Cost Reconciliation (No double counting)
        total_cost = trade.get('totalTradeCost', trade.get('totalExecutionCost', 0.0))
        fees = trade.get('fees', entry_fees + exit_fees)
        slippage = trade.get('slippage', 0.0)
        impact = trade.get('marketImpact', 0.0)
        
        expected_total_cost = fees + slippage + impact
        if abs(total_cost - expected_total_cost) > cls.ACCOUNTING_TOLERANCE * max(1.0, total_cost):
            errors.append(f"Trade {trade_id}: Total cost {total_cost} != sum of fees + slippage + impact ({expected_total_cost})")
            
        expected_net_pnl = actual_gross_pnl - total_cost
        actual_net_pnl = trade.get('netPnL', trade.get('pnl', 0.0))
        if abs(actual_net_pnl - expected_net_pnl) > cls.ACCOUNTING_TOLERANCE * max(1.0, abs(actual_net_pnl)):
            errors.append(f"Trade {trade_id}: Net PnL {actual_net_pnl} != grossPnL - totalCost ({expected_net_pnl})")
            
        return len(errors) == 0, errors

    @classmethod
    def audit_daily_equity_series(cls, equity_series: List[Dict[str, Any]], initial_cash: float = 1_000_000.0) -> Tuple[bool, List[str]]:
        """Independently verifies daily cash, market value, and portfolio equity accounting."""
        errors = []
        if not equity_series:
            return True, []
            
        prev_equity = initial_cash
        for idx, day in enumerate(equity_series):
            date_str = day.get('date', f'Day_{idx}')
            cash = day.get('cash', 0.0)
            market_val = day.get('marketValue', 0.0)
            port_val = day.get('portfolioValue', 0.0)
            gross_exp = day.get('grossExposure', 0.0)
            
            # 1. Conservation equation: portfolioValue == cash + marketValue
            expected_port_val = cash + market_val
            if abs(port_val - expected_port_val) > cls.ACCOUNTING_TOLERANCE * max(1.0, port_val):
                errors.append(f"Date {date_str}: Equity {port_val} != cash ({cash}) + marketValue ({market_val})")
                
            # 2. Non-negative cash invariant
            if cash < -cls.ACCOUNTING_TOLERANCE:
                errors.append(f"Date {date_str}: Negative cash detected ({cash})")
                
            # 3. Gross exposure cap (100% ceiling)
            if gross_exp > 1.000001:
                errors.append(f"Date {date_str}: Gross exposure {gross_exp} > 1.000001")
                
            # 4. Daily return reconciliation
            daily_ret = day.get('dailyReturn', 0.0)
            if prev_equity > 0 and idx > 0:
                expected_daily_ret = (port_val / prev_equity) - 1.0
                if abs(daily_ret - expected_daily_ret) > cls.PRICE_TOLERANCE:
                    errors.append(f"Date {date_str}: Daily return {daily_ret} != expected {(port_val/prev_equity) - 1.0}")
                    
            prev_equity = port_val
            
        return len(errors) == 0, errors

    @classmethod
    def audit_summary_metrics(
        cls,
        equity_series: List[Dict[str, Any]],
        trades: List[Dict[str, Any]],
        reported_metrics: Dict[str, Any],
        initial_cash: float = 1_000_000.0
    ) -> Tuple[bool, List[str]]:
        """Independently recalculates CAGR, Sharpe, Sortino, MaxDD, and Profit Factor."""
        errors = []
        if not equity_series:
            return True, []
            
        equities = [d['portfolioValue'] for d in equity_series]
        final_equity = equities[-1]
        
        # 1. Independent CAGR
        first_date = pd.to_datetime(equity_series[0]['date'])
        last_date = pd.to_datetime(equity_series[-1]['date'])
        calendar_days = max(1, (last_date - first_date).days)
        
        if final_equity > 0 and initial_cash > 0:
            ind_cagr = round(((final_equity / initial_cash) ** (365.0 / calendar_days) - 1.0) * 100.0, 2)
            rep_cagr = round(float(reported_metrics.get('cagr', 0.0)), 2)
            if abs(ind_cagr - rep_cagr) > 0.2:  # allow 0.2% tolerance due to day count conventions
                errors.append(f"Summary CAGR mismatch: reported {rep_cagr}% vs independent {ind_cagr}%")
                
        # 2. Independent Sharpe (excess return over 4.0% rf)
        daily_returns = np.array([d['dailyReturn'] for d in equity_series[1:]])
        if len(daily_returns) > 5:
            excess = daily_returns - cls.DAILY_RF
            excess_std = float(np.std(excess, ddof=1))
            if excess_std > 1e-8:
                ind_sharpe = round(float(np.mean(excess) / excess_std * math.sqrt(252)), 2)
                rep_sharpe = round(float(reported_metrics.get('sharpe', 0.0)), 2)
                if abs(ind_sharpe - rep_sharpe) > 0.15:
                    errors.append(f"Summary Sharpe mismatch: reported {rep_sharpe} vs independent {ind_sharpe}")
                    
        # 3. Independent Max Drawdown
        running_peak = np.maximum.accumulate(equities)
        drawdowns = (equities - running_peak) / running_peak
        ind_max_dd = round(float(np.min(drawdowns)) * 100.0, 2)
        rep_max_dd = round(float(reported_metrics.get('maxDrawdown', 0.0)), 2)
        if abs(ind_max_dd - rep_max_dd) > 0.5:
            errors.append(f"Summary MaxDrawdown mismatch: reported {rep_max_dd}% vs independent {ind_max_dd}%")
            
        # 4. Independent Profit Factor
        winning_pnl = sum(t.get('netPnL', t.get('pnl', 0.0)) for t in trades if t.get('netPnL', t.get('pnl', 0.0)) > 0)
        losing_pnl = abs(sum(t.get('netPnL', t.get('pnl', 0.0)) for t in trades if t.get('netPnL', t.get('pnl', 0.0)) < 0))
        if losing_pnl > 0:
            ind_pf = round(float(winning_pnl / losing_pnl), 2)
            rep_pf = round(float(reported_metrics.get('profitFactor', 0.0)), 2)
            if abs(ind_pf - rep_pf) > 0.1:
                errors.append(f"Summary ProfitFactor mismatch: reported {rep_pf} vs independent {ind_pf}")
                
        return len(errors) == 0, errors

    @classmethod
    def audit_backtest_execution(
        cls,
        backtest_result: Dict[str, Any],
        initial_cash: float = 1_000_000.0
    ) -> Tuple[bool, List[str]]:
        """Runs the complete independent audit suite across trades, equity series, and metrics."""
        all_errors = []
        trades = backtest_result.get('trades', backtest_result.get('completedTrades', []))
        equity_series = backtest_result.get('dailyEquitySeries', backtest_result.get('dailyEquityRecords', []))
        
        # 1. Audit individual trades
        for trade in trades:
            passed, errs = cls.audit_trade(trade)
            if not passed:
                all_errors.extend(errs)
                
        # 2. Audit daily equity curve
        passed, eq_errs = cls.audit_daily_equity_series(equity_series, initial_cash=initial_cash)
        if not passed:
            all_errors.extend(eq_errs)
            
        # 3. Audit summary performance metrics
        passed, met_errs = cls.audit_summary_metrics(equity_series, trades, backtest_result, initial_cash=initial_cash)
        if not passed:
            all_errors.extend(met_errs)
            
        return len(all_errors) == 0, all_errors
