"""
Centralized Transaction Cost & Slippage Engine for QuantX.
Unified fee calculator covering Indian equity delivery & intraday execution charges.
"""
from dataclasses import dataclass
from typing import Literal, Optional, Dict, Any

from models.execution_cost_engine import (
    ExecutionCostEngine,
    ExecutionCostConfig,
    ExecutionCostLeakageError,
    LiquidityCapExceededError,
    COST_REGIME_CONFIGS,
    CostRegime
)

TransactionCostConfig = ExecutionCostConfig
COST_REGIMES = COST_REGIME_CONFIGS

class TransactionCostEngine:
    def __init__(self, regime: CostRegime = 'BASE_COST', custom_config: TransactionCostConfig = None):
        self.config = custom_config or COST_REGIMES[regime]
        self.regime = regime

    def calculate_round_trip_cost_rate(self) -> float:
        """
        Calculates total round-trip friction as a fraction of trade value:
        Entry: Brokerage + (Brokerage * GST) + Exchange + (Exchange * GST) + Stamp Duty + SEBI + Slippage
        Exit:  Brokerage + (Brokerage * GST) + Exchange + (Exchange * GST) + STT + SEBI + Slippage
        """
        cfg = self.config
        
        # Entry charges (buy side)
        entry_brokerage = cfg.brokerage_rate
        entry_exchange = cfg.exchange_rate
        entry_gst = (entry_brokerage + entry_exchange) * cfg.gst_rate
        entry_stamp = cfg.stamp_duty_rate_buy
        entry_sebi = cfg.sebi_rate
        entry_slippage = (cfg.slippage_bps / 10000.0)
        
        entry_total = entry_brokerage + entry_exchange + entry_gst + entry_stamp + entry_sebi + entry_slippage

        # Exit charges (sell side)
        exit_brokerage = cfg.brokerage_rate
        exit_exchange = cfg.exchange_rate
        exit_gst = (exit_brokerage + exit_exchange) * cfg.gst_rate
        exit_stt = cfg.stt_rate_sell
        exit_sebi = cfg.sebi_rate
        exit_slippage = (cfg.slippage_bps / 10000.0)
        
        exit_total = exit_brokerage + exit_exchange + exit_gst + exit_stt + exit_sebi + exit_slippage

        return entry_total + exit_total

    def compute_net_return(self, gross_return: float) -> float:
        """
        Deducts total round-trip friction from a simulated gross return.
        """
        return gross_return - self.calculate_round_trip_cost_rate()

    def get_cost_breakdown(self) -> dict:
        return {
            'regime': self.regime,
            'brokerage_rate': self.config.brokerage_rate,
            'stt_rate_sell': self.config.stt_rate_sell,
            'slippage_bps': self.config.slippage_bps,
            'round_trip_rate': self.calculate_round_trip_cost_rate()
        }

