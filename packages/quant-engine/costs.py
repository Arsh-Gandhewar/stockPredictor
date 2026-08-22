"""
Centralized Transaction Cost & Slippage Engine for QuantX.
Unified fee calculator covering Indian equity delivery & intraday execution charges.
"""
from dataclasses import dataclass
from typing import Literal

CostRegime = Literal['LOW_COST', 'BASE_COST', 'HIGH_COST']

@dataclass(frozen=True)
class TransactionCostConfig:
    brokerage_rate: float        # e.g., 0.0003 (3 bps)
    stt_rate_sell: float         # e.g., 0.0010 (10 bps on sell side)
    exchange_rate: float         # e.g., 0.0000345 (0.345 bps)
    gst_rate: float              # 18% on (brokerage + exchange)
    stamp_duty_rate_buy: float   # 0.00015 (1.5 bps on buy side)
    sebi_rate: float             # 0.000001 (0.01 bps)
    slippage_bps: float          # Base execution slippage in basis points

# Preset regimes
COST_REGIMES = {
    'LOW_COST': TransactionCostConfig(
        brokerage_rate=0.0001,
        stt_rate_sell=0.0010,
        exchange_rate=0.00003,
        gst_rate=0.18,
        stamp_duty_rate_buy=0.00015,
        sebi_rate=0.000001,
        slippage_bps=2.0,
    ),
    'BASE_COST': TransactionCostConfig(
        brokerage_rate=0.0003,
        stt_rate_sell=0.0010,
        exchange_rate=0.0000345,
        gst_rate=0.18,
        stamp_duty_rate_buy=0.00015,
        sebi_rate=0.000001,
        slippage_bps=5.0,
    ),
    'HIGH_COST': TransactionCostConfig(
        brokerage_rate=0.0005,
        stt_rate_sell=0.0010,
        exchange_rate=0.0000345,
        gst_rate=0.18,
        stamp_duty_rate_buy=0.00015,
        sebi_rate=0.000001,
        slippage_bps=10.0,
    ),
}

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
