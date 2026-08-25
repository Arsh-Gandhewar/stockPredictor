"""
QuantX Centralized Quantitative Governance Configuration.
Single source of truth for all quantitative, statistical, risk, and certification constants.
"""

# Sample Size Governance Thresholds (Sections 9, 16, 18)
MIN_TEST_CALIBRATION_SAMPLE_COUNT = 500
MIN_RETURN_BUCKET_SAMPLE_COUNT = 100
MIN_TAIL_SAMPLE_COUNT = 250

# Portfolio Risk & Exposure Invariants (Sections 18, 31)
MAX_POSITION_WEIGHT = 0.10
MAX_SECTOR_WEIGHT = 0.25
MAX_GROSS_EXPOSURE = 1.000001
RISK_PER_TRADE = 0.005

# Institutional Friction & Execution Modeling
BASE_ROUND_TRIP_FRICTION = 0.0013  # 13 bps (brokerage + STT + slippage + exchange fees)

# Predeclared Economic Strategy Certification Hurdles (Sections 21, 22, 34)
ECONOMIC_CAGR_HURDLE = 5.0            # Minimum CAGR > 5.0%
ECONOMIC_SHARPE_HURDLE = 0.50         # Minimum Sharpe Ratio > 0.50
ECONOMIC_PROFIT_FACTOR_HURDLE = 1.20  # Minimum Profit Factor > 1.20
ECONOMIC_MAX_DRAWDOWN_HURDLE = -25.0  # Maximum allowable drawdown > -25.0%
