"""
Centralized Floating-Point Tolerances for QuantX (Section 75).
Eliminates scattered magic constants across modules.
"""

PRICE_TOLERANCE: float = 1e-4
PROBABILITY_TOLERANCE: float = 1e-5
ACCOUNTING_TOLERANCE: float = 1e-6
PARITY_TOLERANCE: float = 1e-5
BRIER_TOLERANCE: float = 1e-3
ECE_TOLERANCE: float = 2e-3
CAGR_TOLERANCE: float = 0.5
SHARPE_TOLERANCE: float = 0.1
SORTINO_TOLERANCE: float = 0.1
DRAWDOWN_TOLERANCE: float = 0.5
EXPOSURE_TOLERANCE: float = 1e-6
