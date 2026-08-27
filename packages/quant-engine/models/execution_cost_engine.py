"""
Authoritative Side-Aware Execution Cost & Market Impact Engine for QuantX.
Calculates Indian cash equity transaction charges, adverse execution slippage,
and monotonic square-root market impact with point-in-time ADV liquidity gating.
"""
from dataclasses import dataclass
from typing import Dict, Any, Optional, Literal
import math
import numpy as np
import pandas as pd

CostRegime = Literal['LOW_COST', 'BASE_COST', 'STRESSED_COST', 'EXTREME_COST']

class ExecutionCostLeakageError(ValueError):
    """Raised when future data (timestamps, lookahead keys) leaks into execution cost calculation."""
    pass

class LiquidityCapExceededError(ValueError):
    """Raised when an order exceeds the maximum allowable participation rate."""
    pass

@dataclass(frozen=True)
class ExecutionCostConfig:
    brokerage_rate: float            # e.g. 0.0003 (3 bps)
    max_brokerage_per_order: float   # e.g. 20.0 INR
    exchange_rate: float             # e.g. 0.0000345 (0.345 bps)
    gst_rate: float                  # 18% on brokerage + exchange charges
    sebi_rate: float                 # 0.000001 (0.01 bps)
    stamp_duty_rate_buy: float       # 0.00015 (1.5 bps on BUY only)
    stt_rate_sell: float             # 0.0010 (10 bps on SELL only)
    base_slippage_bps: float         # Base slippage in bps
    impact_coefficient: float        # Square root market impact parameter alpha
    max_participation_rate: float    # Hard cap on participation rate (0.05 = 5%)
    adv_lookback: int                # Rolling ADV trading sessions lookback (20)
    cost_regime: str                 # Regime label
    version: str = "v6.0.0-execution-engine"

    @property
    def slippage_bps(self) -> float:
        return self.base_slippage_bps

# Standard Presets
COST_REGIME_CONFIGS: Dict[str, ExecutionCostConfig] = {
    'LOW_COST': ExecutionCostConfig(
        brokerage_rate=0.0001,
        max_brokerage_per_order=20.0,
        exchange_rate=0.00003,
        gst_rate=0.18,
        sebi_rate=0.000001,
        stamp_duty_rate_buy=0.00015,
        stt_rate_sell=0.0010,
        base_slippage_bps=2.0,
        impact_coefficient=0.05,
        max_participation_rate=0.05,
        adv_lookback=20,
        cost_regime='LOW_COST'
    ),
    'BASE_COST': ExecutionCostConfig(
        brokerage_rate=0.0003,
        max_brokerage_per_order=20.0,
        exchange_rate=0.0000345,
        gst_rate=0.18,
        sebi_rate=0.000001,
        stamp_duty_rate_buy=0.00015,
        stt_rate_sell=0.0010,
        base_slippage_bps=5.0,
        impact_coefficient=0.10,
        max_participation_rate=0.05,
        adv_lookback=20,
        cost_regime='BASE_COST'
    ),
    'STRESSED_COST': ExecutionCostConfig(
        brokerage_rate=0.0005,
        max_brokerage_per_order=20.0,
        exchange_rate=0.0000345,
        gst_rate=0.18,
        sebi_rate=0.000001,
        stamp_duty_rate_buy=0.00015,
        stt_rate_sell=0.0010,
        base_slippage_bps=15.0,
        impact_coefficient=0.20,
        max_participation_rate=0.05,
        adv_lookback=20,
        cost_regime='STRESSED_COST'
    ),
    'EXTREME_COST': ExecutionCostConfig(
        brokerage_rate=0.0010,
        max_brokerage_per_order=20.0,
        exchange_rate=0.0000345,
        gst_rate=0.18,
        sebi_rate=0.000001,
        stamp_duty_rate_buy=0.00015,
        stt_rate_sell=0.0010,
        base_slippage_bps=30.0,
        impact_coefficient=0.40,
        max_participation_rate=0.05,
        adv_lookback=20,
        cost_regime='EXTREME_COST'
    )
}

class ExecutionCostEngine:
    """
    Centralized, side-aware execution cost engine.
    Calculates exact statutory charges, adverse execution prices, and market impact.
    """
    def __init__(self, regime: CostRegime = 'BASE_COST', custom_config: Optional[ExecutionCostConfig] = None):
        self.config = custom_config or COST_REGIME_CONFIGS.get(regime, COST_REGIME_CONFIGS['BASE_COST'])
        self.regime = self.config.cost_regime
        self.version = self.config.version

    def compute_rolling_adv(
        self,
        historical_candles: pd.DataFrame,
        as_of_date: Any,
        lookback: Optional[int] = None
    ) -> Optional[float]:
        """
        Computes point-in-time Average Daily Value (ADV) traded strictly prior to as_of_date.
        Requires at least `lookback` trading sessions. Excludes current/future sessions.
        """
        lookback = lookback or self.config.adv_lookback
        
        # Causal validation: Check column keys
        if any(str(c).startswith('future_') for c in historical_candles.columns):
            raise ExecutionCostLeakageError("CRITICAL CAUSAL LEAKAGE: Future columns present in historical candles!")
            
        dt_idx = pd.to_datetime(historical_candles.index)
        as_of_ts = pd.to_datetime(as_of_date)
        
        # Strict point-in-time: strictly prior to decision date T
        prior_mask = dt_idx < as_of_ts
        prior_df = historical_candles.loc[prior_mask]
        
        if len(prior_df) < lookback:
            return None
            
        # Last lookback sessions
        window_df = prior_df.iloc[-lookback:]
        
        if 'Volume' not in window_df.columns:
            return None
            
        # Value traded = Volume * Close (or Volume * VWAP)
        price_series = window_df['Close'] if 'Close' in window_df.columns else window_df['Open']
        daily_val = window_df['Volume'] * price_series
        adv = float(daily_val.mean())
        return adv if adv > 0 else None

    def calculate_transaction_cost(
        self,
        side: str,
        reference_price: float,
        quantity: float,
        notional: Optional[float] = None,
        ticker: Optional[str] = None,
        timestamp: Optional[str] = None,
        adv: Optional[float] = None,
        volatility: Optional[float] = None,
        spread_proxy: Optional[float] = None,
        market_regime: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Calculates side-aware execution charges, price slippage, and market impact.
        Side must be 'BUY' or 'SELL'.
        """
        side_clean = str(side).upper().strip()
        if side_clean not in ['BUY', 'SELL']:
            raise ValueError(f"Invalid side: {side}. Must be 'BUY' or 'SELL'.")
            
        ref_price = float(reference_price)
        qty = float(quantity)
        trade_notional = float(notional) if notional is not None else float(ref_price * qty)
        
        cfg = self.config
        
        # 1. Liquidity & Participation Rate
        participation_rate = 0.0
        eligible = True
        rejection_reason = None
        
        if adv is not None and adv > 0:
            participation_rate = float(trade_notional / adv)
            if participation_rate > cfg.max_participation_rate:
                eligible = False
                rejection_reason = "LIQUIDITY_CAP"
        elif adv is None and ticker is not None:
            # Insufficient ADV data
            eligible = False
            rejection_reason = "INSUFFICIENT_ADV_DATA"
            
        # 2. Side-Specific Brokerage & Statutory Taxes
        # Brokerage: min(notional * rate, max_brokerage)
        brokerage = min(trade_notional * cfg.brokerage_rate, cfg.max_brokerage_per_order)
        exchange = trade_notional * cfg.exchange_rate
        gst = (brokerage + exchange) * cfg.gst_rate
        sebi = trade_notional * cfg.sebi_rate
        
        # Asymmetric statutory charges:
        # Stamp duty on BUY only (1.5 bps)
        stamp_duty = (trade_notional * cfg.stamp_duty_rate_buy) if side_clean == 'BUY' else 0.0
        # STT on SELL only (10 bps for delivery equity)
        stt = (trade_notional * cfg.stt_rate_sell) if side_clean == 'SELL' else 0.0
        
        statutory_fees = brokerage + exchange + gst + sebi + stamp_duty + stt
        
        # 3. Slippage & Market Impact
        # Base slippage
        slippage_rate = cfg.base_slippage_bps / 10000.0
        slippage_inr = trade_notional * slippage_rate
        
        # Monotonic Market Impact: alpha * volatility * sqrt(participation)
        vol = float(volatility) if (volatility is not None and volatility > 0) else 0.015
        impact_rate = float(cfg.impact_coefficient * vol * math.sqrt(max(0.0, participation_rate)))
        market_impact_inr = trade_notional * impact_rate
        
        # 4. Adverse Price Adjustment
        total_adverse_rate = slippage_rate + impact_rate
        
        if side_clean == 'BUY':
            execution_price = ref_price * (1.0 + total_adverse_rate)
        else: # SELL
            execution_price = ref_price * (1.0 - total_adverse_rate)
            
        total_execution_cost = statutory_fees + slippage_inr + market_impact_inr
        effective_cost_bps = (total_execution_cost / trade_notional * 10000.0) if trade_notional > 0 else 0.0
        
        return {
            'side': side_clean,
            'referencePrice': float(round(ref_price, 4)),
            'executionPrice': float(round(execution_price, 4)),
            'quantity': float(qty),
            'notional': float(round(trade_notional, 2)),
            'brokerage': float(round(brokerage, 2)),
            'stt': float(round(stt, 2)),
            'exchangeCharges': float(round(exchange, 2)),
            'gst': float(round(gst, 2)),
            'stampDuty': float(round(stamp_duty, 2)),
            'sebiCharges': float(round(sebi, 2)),
            'fees': float(round(statutory_fees, 2)),
            'slippage': float(round(slippage_inr, 2)),
            'slippageBps': float(round(slippage_rate * 10000.0, 2)),
            'marketImpact': float(round(market_impact_inr, 2)),
            'marketImpactBps': float(round(impact_rate * 10000.0, 2)),
            'participationRate': float(round(participation_rate, 6)),
            'totalCost': float(round(total_execution_cost, 2)),
            'effectiveCostBps': float(round(effective_cost_bps, 2)),
            'costRegime': self.regime,
            'costModelVersion': self.version,
            'eligible': eligible,
            'rejectionReason': rejection_reason
        }
        
    def estimate_round_trip_cost_rate(
        self,
        notional: float,
        adv: Optional[float] = None,
        volatility: Optional[float] = None
    ) -> float:
        """
        Estimates total round-trip cost as a percentage fraction (e.g. 0.0028 for 28 bps)
        for pre-trade Net EV calculation.
        """
        buy_res = self.calculate_transaction_cost('BUY', reference_price=100.0, quantity=notional/100.0, notional=notional, adv=adv, volatility=volatility)
        sell_res = self.calculate_transaction_cost('SELL', reference_price=100.0, quantity=notional/100.0, notional=notional, adv=adv, volatility=volatility)
        total_cost = buy_res['totalCost'] + sell_res['totalCost']
        return float(total_cost / notional) if notional > 0 else 0.003
