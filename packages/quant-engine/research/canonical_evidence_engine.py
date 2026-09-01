"""
QuantX Canonical Event-Sourced Evidence & Portfolio Reconstruction Engine.

Reconstructs true event-sourced portfolio state and daily equity curves:
  Orders -> Fills & Slippage -> Cash & Mark-to-Market Positions -> Daily Equity Curve -> Canonical Portfolio Metrics.

Enforces zero-fake sentinels, oversell protection, strict fail-closed MTM pricing, and formal daily accounting reconciliation.
"""
import uuid
import math
import json
import hashlib
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone

from research.evidence_schema import (
    ResearchLineage,
    RawEvidenceChain,
    ResearchEvidence,
    EvidenceValidationError,
    AccountingInconsistencyError,
    InsufficientMarketDataError,
    compute_deterministic_evidence_content_hash
)
from research.statistical_research_engine import StatisticalResearchEngine


class CanonicalEvidenceEngine:
    """
    Event-sourced quantitative evidence reconstruction engine with fail-closed financial accounting.
    """

    @classmethod
    def reconstruct_portfolio_and_metrics(
        cls,
        experiment_id: str,
        initial_capital: float,
        executions: List[Dict[str, Any]],
        daily_prices: Dict[str, Dict[str, float]],
        trading_dates: List[str],
        lineage: ResearchLineage,
        evaluation_start_date: Optional[str] = None,
        evaluation_end_date: Optional[str] = None,
        candidate_trials_matrix: Optional[np.ndarray] = None,
        raw_predictions: Optional[List[Dict[str, Any]]] = None,
        orders: Optional[List[Dict[str, Any]]] = None,
        benchmark_series: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Reconstructs the full daily portfolio state and computes authoritative evidence.
        """
        if not experiment_id or not isinstance(experiment_id, str) or not experiment_id.strip():
            raise ValueError("EXPERIMENT_ID_MANDATORY: experiment_id must be a non-empty string.")
        if not isinstance(lineage, ResearchLineage):
            raise EvidenceValidationError("LINEAGE_MANDATORY: lineage must be a valid ResearchLineage instance.")
        if not trading_dates or len(trading_dates) < 2:
            raise ValueError("TRADING_DATES_MANDATORY: At least 2 trading dates required for time-series evaluation.")
        if initial_capital <= 0:
            raise ValueError("INITIAL_CAPITAL_INVALID: initial_capital must be > 0.")

        sorted_dates = sorted(trading_dates)
        start_date_str = evaluation_start_date or sorted_dates[0]
        end_date_str = evaluation_end_date or sorted_dates[-1]

        # 1. Comprehensive Execution Input Validation
        seen_exec_ids = set()
        validated_executions = []
        for idx, ex in enumerate(executions):
            if not isinstance(ex, dict):
                raise EvidenceValidationError(f"EXECUTION_FORMAT_ERROR: Execution at index {idx} is not a dictionary.")
            exec_id = str(ex.get("executionId") or f"exec_{idx}")
            if exec_id in seen_exec_ids:
                raise EvidenceValidationError(f"DUPLICATE_EXECUTION_ID: Duplicate execution ID '{exec_id}' detected.")
            seen_exec_ids.add(exec_id)

            side = str(ex.get("side", "")).upper()
            if side not in ["BUY", "SELL"]:
                raise EvidenceValidationError(f"INVALID_SIDE: Execution '{exec_id}' has invalid side '{side}'.")

            qty = ex.get("quantity")
            if type(qty) is not int or qty <= 0:
                raise EvidenceValidationError(f"INVALID_QUANTITY: Execution '{exec_id}' quantity must be an integer > 0, got {qty}.")

            price = ex.get("price")
            if not isinstance(price, (int, float)) or type(price) is bool or math.isnan(price) or math.isinf(price) or price <= 0.0:
                raise EvidenceValidationError(f"INVALID_PRICE: Execution '{exec_id}' price must be a finite float > 0, got {price}.")

            fees = ex.get("statutoryFees", 0.0)
            slip = ex.get("slippage", 0.0)
            if not isinstance(fees, (int, float)) or fees < 0 or math.isnan(fees) or math.isinf(fees):
                raise EvidenceValidationError(f"INVALID_FEES: Execution '{exec_id}' statutoryFees must be >= 0.")
            if not isinstance(slip, (int, float)) or slip < 0 or math.isnan(slip) or math.isinf(slip):
                raise EvidenceValidationError(f"INVALID_SLIPPAGE: Execution '{exec_id}' slippage must be >= 0.")

            ts = ex.get("timestamp")
            if not ts or not isinstance(ts, str):
                raise EvidenceValidationError(f"INVALID_TIMESTAMP: Execution '{exec_id}' missing valid ISO timestamp.")

            ticker = str(ex.get("ticker", "")).strip()
            if not ticker:
                raise EvidenceValidationError(f"INVALID_TICKER: Execution '{exec_id}' missing ticker.")

            validated_executions.append({
                "executionId": exec_id,
                "ticker": ticker,
                "side": side,
                "quantity": qty,
                "price": float(price),
                "statutoryFees": float(fees),
                "slippage": float(slip),
                "timestamp": ts
            })

        # 2. Event-Sourced Daily Equity & Position Ledger Reconstruction
        cash = float(initial_capital)
        positions: Dict[str, int] = {}
        open_lots: Dict[str, List[Dict[str, Any]]] = {}
        total_costs = 0.0
        total_notional_traded = 0.0

        daily_equity_records = []
        closed_trades_records = []
        reconciliation_ledger = []

        execs_by_date: Dict[str, List[Dict[str, Any]]] = {}
        for ex in validated_executions:
            d = str(ex["timestamp"])[:10]
            execs_by_date.setdefault(d, []).append(ex)

        prev_equity = float(initial_capital)
        prev_unrealized_pnl = 0.0

        for date_str in sorted_dates:
            day_execs = execs_by_date.get(date_str, [])
            day_costs = 0.0
            day_realized_gross = 0.0
            day_notional = 0.0

            for ex in day_execs:
                ticker = ex["ticker"]
                side = ex["side"]
                qty = ex["quantity"]
                price = ex["price"]
                friction = ex["statutoryFees"] + ex["slippage"]

                total_costs += friction
                day_costs += friction
                trade_notional = qty * price
                day_notional += trade_notional
                total_notional_traded += trade_notional

                if side == "BUY":
                    cash -= (trade_notional + friction)
                    positions[ticker] = positions.get(ticker, 0) + qty
                    open_lots.setdefault(ticker, []).append({
                        "lotId": ex["executionId"],
                        "quantity": qty,
                        "price": price,
                        "entryCosts": friction,
                        "entryDate": date_str
                    })
                elif side == "SELL":
                    # Oversell check
                    current_long = positions.get(ticker, 0)
                    if qty > current_long:
                        raise AccountingInconsistencyError(
                            f"OVERSOLD_POSITION: Cannot sell {qty} units of '{ticker}'. Currently held inventory is {current_long}."
                        )
                    cash += (trade_notional - friction)
                    positions[ticker] = current_long - qty

                    # Exact lot-level FIFO matching
                    remaining_to_close = qty
                    realized_gross_pnl = 0.0
                    matched_entry_costs = 0.0

                    lots = open_lots.get(ticker, [])
                    while remaining_to_close > 0 and lots:
                        lot = lots[0]
                        closed_qty = min(remaining_to_close, lot["quantity"])
                        lot_share = closed_qty / lot["quantity"]
                        matched_entry_costs += lot_share * lot["entryCosts"]
                        lot_gross = closed_qty * (price - lot["price"])
                        realized_gross_pnl += lot_gross

                        lot["quantity"] -= closed_qty
                        lot["entryCosts"] -= lot_share * lot["entryCosts"]
                        remaining_to_close -= closed_qty
                        if lot["quantity"] == 0:
                            lots.pop(0)

                    net_trade_pnl = realized_gross_pnl - (matched_entry_costs + friction)
                    day_realized_gross += realized_gross_pnl
                    closed_trades_records.append({
                        "ticker": ticker,
                        "quantity": qty,
                        "grossPnl": round(realized_gross_pnl, 2),
                        "netPnl": round(net_trade_pnl, 2),
                        "totalCosts": round(matched_entry_costs + friction, 2),
                        "exitDate": date_str
                    })

            # Fail-Closed Mark-to-Market Valuation (Zero Price Prohibited)
            mtm_value = 0.0
            unrealized_pnl = 0.0
            day_prices = daily_prices.get(date_str)
            if day_prices is None:
                raise InsufficientMarketDataError(f"INSUFFICIENT_MARKET_DATA: No market price table provided for date '{date_str}'.")

            for ticker, qty in positions.items():
                if qty > 0:
                    if ticker not in day_prices:
                        raise InsufficientMarketDataError(
                            f"INSUFFICIENT_MARKET_DATA: Missing point-in-time close price for open position '{ticker}' on date '{date_str}'."
                        )
                    p = day_prices[ticker]
                    if not isinstance(p, (int, float)) or math.isnan(p) or math.isinf(p) or p <= 0.0:
                        raise InsufficientMarketDataError(
                            f"INSUFFICIENT_MARKET_DATA: Invalid close price ({p}) for '{ticker}' on date '{date_str}'."
                        )
                    mtm_value += qty * p

                    # Calculate unrealized PnL against open lots
                    lots = open_lots.get(ticker, [])
                    cost_basis = sum(l["quantity"] * l["price"] for l in lots)
                    unrealized_pnl += (qty * p - cost_basis)

            closing_equity = cash + mtm_value
            delta_unrealized = unrealized_pnl - prev_unrealized_pnl

            # Formal Accounting Balance Check: Opening + Realized + ΔUnrealized - Costs = Closing
            expected_closing = prev_equity + day_realized_gross + delta_unrealized - day_costs
            if abs(closing_equity - expected_closing) > 0.05:
                raise AccountingInconsistencyError(
                    f"LEDGER_RECONCILIATION_FAILED: On {date_str}, calculated equity ({closing_equity}) != expected equity ({expected_closing}). Residual: {closing_equity - expected_closing}."
                )

            daily_equity_records.append({
                "date": date_str,
                "cash": round(cash, 2),
                "mtm": round(mtm_value, 2),
                "equity": round(closing_equity, 2),
                "costs": round(day_costs, 2),
                "realizedGrossPnl": round(day_realized_gross, 2),
                "unrealizedPnl": round(unrealized_pnl, 2),
            })

            prev_equity = closing_equity
            prev_unrealized_pnl = unrealized_pnl

        # 3. Time-Series Performance from Canonical Daily Equity
        equity_df = pd.DataFrame(daily_equity_records)
        equity_series = equity_df["equity"]
        daily_returns = equity_series.pct_change().dropna().to_numpy()

        start_dt = pd.to_datetime(start_date_str)
        end_dt = pd.to_datetime(end_date_str)
        days = max(1, (end_dt - start_dt).days)
        years = max(0.01, days / 365.25)

        start_equity = float(initial_capital)
        final_equity = float(equity_series.iloc[-1])
        cagr = round(((final_equity / start_equity) ** (1.0 / years) - 1.0) * 100.0, 2)

        # Max Drawdown
        running_max = equity_series.cummax()
        dd_series = (equity_series - running_max) / running_max
        max_dd = round(float(dd_series.min()) * 100.0, 2)

        # Annualized Sharpe & Sortino (252 sessions)
        mean_ret = float(np.mean(daily_returns)) if len(daily_returns) > 0 else 0.0
        std_ret = float(np.std(daily_returns, ddof=1)) if len(daily_returns) > 1 else 1e-6
        downside_returns = daily_returns[daily_returns < 0]
        downside_std = float(np.std(downside_returns, ddof=1)) if len(downside_returns) > 1 else 1e-6

        sharpe = round((mean_ret / std_ret) * math.sqrt(252), 2) if std_ret > 1e-6 else 0.0
        sortino = round((mean_ret / downside_std) * math.sqrt(252), 2) if downside_std > 1e-6 else 0.0

        # Traded Notional Turnover
        avg_equity = float(equity_series.mean())
        turnover_annual = round(total_notional_traded / (2.0 * avg_equity * years), 2) if avg_equity > 0 else 0.0

        # Realized PnL & Profit Factor
        total_gross_pnl = sum(t["grossPnl"] for t in closed_trades_records)
        total_net_pnl = sum(t["netPnl"] for t in closed_trades_records)

        gross_wins = sum(t["grossPnl"] for t in closed_trades_records if t["grossPnl"] > 0)
        gross_losses = abs(sum(t["grossPnl"] for t in closed_trades_records if t["grossPnl"] < 0))
        net_wins = sum(t["netPnl"] for t in closed_trades_records if t["netPnl"] > 0)
        net_losses = abs(sum(t["netPnl"] for t in closed_trades_records if t["netPnl"] < 0))

        if len(closed_trades_records) == 0:
            pf_status = "NO_TRADES"
            gross_pf = None
            net_pf = None
        elif gross_losses == 0 or net_losses == 0:
            pf_status = "UNDEFINED_NO_LOSSES"
            gross_pf = None
            net_pf = None
        else:
            pf_status = "FINITE"
            gross_pf = round(gross_wins / gross_losses, 4)
            net_pf = round(net_wins / net_losses, 4)
            if net_pf > gross_pf + 1e-5:
                raise AccountingInconsistencyError(
                    f"INCONSISTENT_PROFIT_FACTOR: Realized Net PF ({net_pf}) strictly exceeds Gross PF ({gross_pf})."
                )

        # 4. Statistical Research Procedures (CSCV PBO & DSR)
        pbo_res = StatisticalResearchEngine.calculate_cscv_pbo(candidate_trials_matrix)
        pbo = pbo_res["pbo"]
        pbo_status = pbo_res["status"]

        if candidate_trials_matrix is not None and candidate_trials_matrix.shape[1] > 1:
            trial_sharpes = (np.mean(candidate_trials_matrix, axis=0) / np.std(candidate_trials_matrix, axis=0)) * math.sqrt(252)
            dsr_res = StatisticalResearchEngine.calculate_deflated_sharpe_ratio(
                trial_sharpes=trial_sharpes,
                estimated_sharpe=sharpe,
                sample_length_days=len(daily_returns),
                daily_returns=daily_returns
            )
            dsr = dsr_res["dsr"]
            dsr_status = dsr_res["status"]
        else:
            dsr = None
            dsr_status = "INSUFFICIENT_CANDIDATES"

        eff_sample_size = StatisticalResearchEngine.calculate_effective_sample_size(daily_returns)
        # Cap ESS at daily observation count
        eff_sample_size = min(float(len(daily_returns)), eff_sample_size)

        is_alpha_sig = bool(
            sharpe > 0.50 and (net_pf is None or net_pf > 1.20) and
            (pbo is not None and pbo < 0.35) and (dsr is not None and dsr > 0.85)
        )
        has_decay = bool(sharpe < 0.20 or (pbo is not None and pbo > 0.45))

        # Build typed evidence
        evidence = ResearchEvidence(
            tradeCount=len(closed_trades_records),
            dailyObservationCount=len(daily_returns),
            predictionCount=len(raw_predictions) if raw_predictions else len(daily_returns),
            effectiveSampleSize=eff_sample_size,
            profitFactorStatus=pf_status,
            grossProfitFactor=gross_pf,
            netProfitFactor=net_pf,
            netCagr=cagr,
            sharpe=sharpe,
            sortino=sortino,
            maxDrawdown=max_dd,
            turnoverAnnual=turnover_annual,
            totalCosts=round(total_costs, 2),
            totalGrossPnl=round(total_gross_pnl, 2),
            totalNetPnl=round(total_net_pnl, 2),
            pbo=pbo,
            pboStatus=pbo_status,
            dsr=dsr,
            dsrStatus=dsr_status,
            isAlphaSignificant=is_alpha_sig,
            hasAlphaDecay=has_decay,
            partition="TEST",
            status="COMMITTED"
        )

        # 5. Mandatory 5-Element Raw Evidence Chain
        raw_pred_hash = hashlib.sha256(json.dumps(raw_predictions or [], sort_keys=True).encode('utf-8')).hexdigest()
        order_ledger_hash = hashlib.sha256(json.dumps(orders or [], sort_keys=True).encode('utf-8')).hexdigest()
        exec_ledger_hash = hashlib.sha256(json.dumps(validated_executions, sort_keys=True).encode('utf-8')).hexdigest()
        daily_equity_hash = hashlib.sha256(json.dumps(daily_equity_records, sort_keys=True).encode('utf-8')).hexdigest()
        benchmark_hash = hashlib.sha256(json.dumps(benchmark_series or [], sort_keys=True).encode('utf-8')).hexdigest()

        raw_chain = RawEvidenceChain(
            rawPredictionsHash=raw_pred_hash,
            orderLedgerHash=order_ledger_hash,
            executionLedgerHash=exec_ledger_hash,
            dailyEquityLedgerHash=daily_equity_hash,
            benchmarkSeriesHash=benchmark_hash
        )

        evidence_content_hash = compute_deterministic_evidence_content_hash(lineage, raw_chain, evidence)
        evidence_run_id = f"run_{uuid.uuid4().hex[:16]}"

        manifest = {
            "experimentId": experiment_id,
            "evidenceRunId": evidence_run_id,
            "evidenceContentHash": evidence_content_hash,
            "rawEvidenceChain": raw_chain.to_dict(),
            "lineage": lineage.to_dict(),
            "evidence": evidence.to_dict(),
            "summary": {
                "initialCapital": initial_capital,
                "finalEquity": round(final_equity, 2),
                "totalNotionalTraded": round(total_notional_traded, 2),
                "totalCosts": round(total_costs, 2),
                "totalGrossPnl": round(total_gross_pnl, 2),
                "totalNetPnl": round(total_net_pnl, 2),
                "tradingDays": len(sorted_dates),
                "evaluationStart": start_date_str,
                "evaluationEnd": end_date_str,
                "years": round(years, 2)
            }
        }

        return manifest
