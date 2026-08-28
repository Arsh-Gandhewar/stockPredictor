"""
QuantX Independent Metrics Engine — BUG 4 Master Repair.

Fully self-contained recomputation of ALL performance metrics from
raw trade ledger and equity series.

CRITICAL: This module MUST NOT import or call backtest_engine metric functions.
It is the independent audit recomputation used for Audit 2 (Economic Audit).

Computed metrics:
  CAGR, Sharpe, Sortino, MaxDrawdown, Calmar, ProfitFactor,
  Expectancy, Turnover, EffectiveSampleSize, TradeDependence
"""
import math
import numpy as np
from typing import Dict, List, Any, Optional


class MetricReconciliationError(Exception):
    """Raised when independently computed metrics disagree with reported metrics."""
    pass


class IndependentMetricsEngine:
    """
    Recomputes all performance metrics from raw inputs without calling
    any production backtest engine functions.

    Inputs:
      equity_series:  list of (date_str, portfolio_value) tuples (daily)
      trade_ledger:   list of trade dicts with keys:
                        entryDate, exitDate, netPnl, grossPnl, entryNotional
      initial_capital: float
      risk_free_rate_annual: float (e.g. 0.04 for 4%)
    """

    TRADING_DAYS_PER_YEAR = 252.0
    ACCOUNTING_TOLERANCE = 1e-4

    @classmethod
    def compute_all(
        cls,
        equity_series: List[tuple],
        trade_ledger: List[Dict[str, Any]],
        initial_capital: float = 1_000_000.0,
        risk_free_rate_annual: float = 0.04,
    ) -> Dict[str, Any]:
        """
        Full independent metric computation.
        Returns dict of all performance metrics with source annotations.
        """
        if len(equity_series) < 2:
            return {'status': 'INSUFFICIENT_DATA', 'equityPoints': len(equity_series)}

        equity_values = [float(v) for _, v in equity_series]
        daily_returns = cls._compute_daily_returns(equity_values)

        cagr = cls._compute_cagr(equity_values, initial_capital, len(equity_series))
        sharpe = cls._compute_sharpe(daily_returns, risk_free_rate_annual)
        sortino = cls._compute_sortino(daily_returns, risk_free_rate_annual)
        max_dd = cls._compute_max_drawdown(equity_values)
        calmar = cagr / abs(max_dd) if max_dd != 0.0 else float('inf')
        pf = cls._compute_profit_factor(trade_ledger)
        expectancy = cls._compute_expectancy(trade_ledger)
        trade_count = len(trade_ledger)
        turnover = cls._compute_turnover(trade_ledger, equity_values)
        eff_n = cls._compute_effective_sample_size(daily_returns)
        trade_dep = cls._compute_trade_dependence(trade_ledger)

        return {
            'source': 'INDEPENDENT_METRICS_ENGINE',
            'method': 'raw_ledger_recomputation',
            'equityPoints': len(equity_series),
            'cagr': round(cagr * 100.0, 4),
            'sharpe': round(sharpe, 4),
            'sortino': round(sortino, 4),
            'maxDrawdown': round(max_dd * 100.0, 4),
            'calmar': round(calmar, 4),
            'profitFactor': round(pf, 4),
            'expectancy': round(expectancy, 2),
            'turnover': round(turnover, 4),
            'tradeCount': trade_count,
            'effectiveSampleSize': round(eff_n, 1),
            'tradeDependence': round(trade_dep, 4),
            'initialCapital': initial_capital,
            'finalEquity': round(equity_values[-1], 2),
        }

    # ------------------------------------------------------------------
    # CAGR
    # ------------------------------------------------------------------

    @classmethod
    def _compute_cagr(cls, equity: List[float], initial: float, n_days: int) -> float:
        if initial <= 0 or n_days <= 0:
            return 0.0
        final = equity[-1]
        years = n_days / cls.TRADING_DAYS_PER_YEAR
        if years <= 0 or final <= 0:
            return 0.0
        return (final / initial) ** (1.0 / years) - 1.0

    # ------------------------------------------------------------------
    # Daily Returns
    # ------------------------------------------------------------------

    @classmethod
    def _compute_daily_returns(cls, equity: List[float]) -> np.ndarray:
        arr = np.array(equity, dtype=float)
        prev = arr[:-1]
        curr = arr[1:]
        # Avoid division by zero
        safe_prev = np.where(prev <= 0, np.nan, prev)
        returns = (curr / safe_prev) - 1.0
        return returns[~np.isnan(returns)]

    # ------------------------------------------------------------------
    # Sharpe
    # ------------------------------------------------------------------

    @classmethod
    def _compute_sharpe(cls, daily_returns: np.ndarray, risk_free_annual: float) -> float:
        if len(daily_returns) < 2:
            return 0.0
        rf_daily = risk_free_annual / cls.TRADING_DAYS_PER_YEAR
        excess = daily_returns - rf_daily
        std = float(np.std(excess, ddof=1))
        if std < 1e-10:
            return 0.0
        return float(np.mean(excess) / std) * math.sqrt(cls.TRADING_DAYS_PER_YEAR)

    # ------------------------------------------------------------------
    # Sortino
    # ------------------------------------------------------------------

    @classmethod
    def _compute_sortino(cls, daily_returns: np.ndarray, risk_free_annual: float) -> float:
        if len(daily_returns) < 2:
            return 0.0
        rf_daily = risk_free_annual / cls.TRADING_DAYS_PER_YEAR
        excess = daily_returns - rf_daily
        downside = excess[excess < 0.0]
        if len(downside) < 2:
            return float(np.mean(excess)) * cls.TRADING_DAYS_PER_YEAR
        downside_std = float(np.std(downside, ddof=1))
        if downside_std < 1e-10:
            return 0.0
        return float(np.mean(excess) / downside_std) * math.sqrt(cls.TRADING_DAYS_PER_YEAR)

    # ------------------------------------------------------------------
    # Max Drawdown
    # ------------------------------------------------------------------

    @classmethod
    def _compute_max_drawdown(cls, equity: List[float]) -> float:
        arr = np.array(equity, dtype=float)
        running_max = np.maximum.accumulate(arr)
        drawdowns = (arr - running_max) / np.where(running_max <= 0, 1.0, running_max)
        return float(np.min(drawdowns))

    # ------------------------------------------------------------------
    # Profit Factor
    # ------------------------------------------------------------------

    @classmethod
    def _compute_profit_factor(cls, trades: List[Dict[str, Any]]) -> float:
        gross_gains = sum(t.get('grossPnl', t.get('netPnl', 0.0)) for t in trades
                         if t.get('grossPnl', t.get('netPnl', 0.0)) > 0.0)
        gross_losses = sum(abs(t.get('grossPnl', t.get('netPnl', 0.0))) for t in trades
                          if t.get('grossPnl', t.get('netPnl', 0.0)) < 0.0)
        if gross_losses < 1e-8:
            return float('inf') if gross_gains > 0 else 0.0
        return gross_gains / gross_losses

    # ------------------------------------------------------------------
    # Expectancy
    # ------------------------------------------------------------------

    @classmethod
    def _compute_expectancy(cls, trades: List[Dict[str, Any]]) -> float:
        if not trades:
            return 0.0
        net_pnls = [t.get('netPnl', 0.0) for t in trades]
        return float(np.mean(net_pnls))

    # ------------------------------------------------------------------
    # Turnover
    # ------------------------------------------------------------------

    @classmethod
    def _compute_turnover(cls, trades: List[Dict[str, Any]], equity: List[float]) -> float:
        total_notional = sum(
            abs(t.get('entryNotional', 0.0)) for t in trades
        )
        mean_aum = float(np.mean(equity)) if equity else 1.0
        if mean_aum < 1e-8:
            return 0.0
        return total_notional / mean_aum

    # ------------------------------------------------------------------
    # Effective Sample Size (autocorrelation-adjusted)
    # ------------------------------------------------------------------

    @classmethod
    def _compute_effective_sample_size(cls, daily_returns: np.ndarray) -> float:
        """
        Effective N = N / (1 + 2 * sum(rho_k)) where rho_k is lag-k autocorrelation.
        Uses lags 1-10.
        """
        N = len(daily_returns)
        if N < 10:
            return float(N)
        autocorr_sum = 0.0
        for lag in range(1, min(11, N // 2)):
            rho = float(np.corrcoef(daily_returns[:-lag], daily_returns[lag:])[0, 1])
            if abs(rho) < 0.05:  # Stop at negligible autocorrelation
                break
            autocorr_sum += rho
        denom = max(1.0, 1.0 + 2.0 * autocorr_sum)
        return max(1.0, N / denom)

    # ------------------------------------------------------------------
    # Trade Dependence
    # ------------------------------------------------------------------

    @classmethod
    def _compute_trade_dependence(cls, trades: List[Dict[str, Any]]) -> float:
        """
        Fraction of trade pairs with overlapping holding periods.
        High trade dependence means overlapping positions reduce independent bets.
        """
        if len(trades) < 2:
            return 0.0
        try:
            entries = [str(t.get('entryDate', '')) for t in trades]
            exits = [str(t.get('exitDate', '')) for t in trades]
            import pandas as pd
            e_dt = pd.to_datetime(entries, errors='coerce')
            x_dt = pd.to_datetime(exits, errors='coerce')
            valid = [(e, x) for e, x in zip(e_dt, x_dt)
                     if pd.notna(e) and pd.notna(x) and x > e]
            if len(valid) < 2:
                return 0.0
            overlap_count = 0
            total_pairs = 0
            for i in range(len(valid)):
                for j in range(i + 1, len(valid)):
                    e1, x1 = valid[i]
                    e2, x2 = valid[j]
                    # Check overlap
                    if e2 < x1 and e1 < x2:
                        overlap_count += 1
                    total_pairs += 1
                    if total_pairs > 500:  # Cap for performance
                        break
                if total_pairs > 500:
                    break
            return overlap_count / total_pairs if total_pairs > 0 else 0.0
        except Exception:
            return 0.0

    # ------------------------------------------------------------------
    # Reconciliation Checks
    # ------------------------------------------------------------------

    @classmethod
    def reconcile_trade_count(
        cls,
        trade_ledger: List[Dict[str, Any]],
        reported_count: int,
    ) -> None:
        """Raises MetricReconciliationError if trade count mismatches."""
        actual = len(trade_ledger)
        if actual != reported_count:
            raise MetricReconciliationError(
                f"TRADE COUNT MISMATCH: Ledger contains {actual} trades, "
                f"but reported count is {reported_count}. "
                "Trade ledger is incomplete or records have been deleted."
            )

    @classmethod
    def reconcile_equity_completeness(
        cls,
        equity_series: List[tuple],
        expected_trading_days: int,
        tolerance: int = 3,
    ) -> None:
        """
        Raises MetricReconciliationError if equity series is truncated.
        tolerance: allow up to N missing days (e.g., partial period boundary).
        """
        actual_days = len(equity_series)
        if abs(actual_days - expected_trading_days) > tolerance:
            raise MetricReconciliationError(
                f"EQUITY COMPLETENESS FAILURE: Got {actual_days} equity points, "
                f"expected {expected_trading_days} trading sessions ±{tolerance}. "
                "Do not certify a truncated equity curve."
            )

    @classmethod
    def reconcile_metrics(
        cls,
        independent_metrics: Dict[str, Any],
        production_metrics: Dict[str, Any],
        tolerances: Optional[Dict[str, float]] = None,
    ) -> None:
        """
        Compares independently computed metrics to production metrics.
        Raises MetricReconciliationError on any material mismatch.
        """
        if tolerances is None:
            tolerances = {
                'cagr': 0.5,        # 0.5% absolute
                'sharpe': 0.1,      # 0.1 absolute
                'sortino': 0.1,
                'maxDrawdown': 0.5,
                'profitFactor': 0.05,
                'expectancy': 100.0,  # INR
            }
        failures = []
        for metric, tol in tolerances.items():
            ind_val = independent_metrics.get(metric)
            prod_val = production_metrics.get(metric)
            if ind_val is None or prod_val is None:
                continue
            diff = abs(float(ind_val) - float(prod_val))
            if diff > tol:
                failures.append(
                    f"  {metric}: independent={ind_val}, production={prod_val}, diff={diff:.4f} > tol={tol}"
                )
        if failures:
            raise MetricReconciliationError(
                "METRIC RECONCILIATION FAILURE — independent metrics do not match production:\n"
                + '\n'.join(failures)
            )
