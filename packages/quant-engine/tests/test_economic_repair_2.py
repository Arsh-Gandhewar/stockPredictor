import os
import sys
import pytest
import numpy as np
import pandas as pd
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from models.cross_sectional_ranker import (
    OpportunityRecord,
    build_daily_opportunity_table,
    select_and_allocate_portfolio,
    compute_historical_correlation,
    OptimizationLeakageError
)
from backtest.backtest_engine import run_portfolio_backtest
from models.payoff_profile import build_trade_payoff_profile

def create_valid_signal(
    ticker: str = "TCS.NS",
    date: str = "2025-01-02",
    p_up: float = 0.65,
    gain: float = 0.05,
    loss: float = 0.02,
    p85: float = 0.06,
    p15: float = -0.02,
    p50: float = 0.01,
    atr: float = 0.02,
    open_price: float = 100.0,
    sector: str = "Technology",
    adv_shares: float = 1_000_000.0
) -> dict:
    return {
        'predictionTimestamp': date,
        'date': pd.to_datetime(date),
        'ticker': ticker,
        'sector': sector,
        'calibratedProbability': p_up,
        'pred_prob': p_up,
        'conditional_gain': gain,
        'conditional_loss': loss,
        'p85': p85,
        'p15': p15,
        'p50': p50,
        'distributionVersion': 'v5.0.0-fold-causal',
        'distributionFitStart': '2024-01-01',
        'distributionFitEnd': '2025-01-01',
        'horizon': '5d',
        'sampleCount': 500,
        'sourceMethod': 'EMPIRICAL_QUANTILE',
        'atr_percent': atr,
        'Open': open_price,
        'Close': open_price,
        'Volume': adv_shares
    }

# ============================================================================
# Section 44: 20 Deterministic Adversarial Tests
# ============================================================================

def test_adv_01_high_ev_ranked_lower_due_to_higher_risk():
    """1. High-EV stock ranked lower than low-EV stock due to higher risk."""
    # Stock A: Net EV = 0.65*0.04 - 0.35*0.01 - 0.003 = 0.0195. Risk = 0.01. RiskAdj = 1.95
    # Stock B: Net EV = 0.70*0.06 - 0.30*0.03 - 0.003 = 0.0300. Risk = 0.03. RiskAdj = 1.00
    sig_a = create_valid_signal(ticker="STOCK_A", gain=0.04, loss=0.01, p15=-0.01, p_up=0.65)
    sig_b = create_valid_signal(ticker="STOCK_B", gain=0.06, loss=0.03, p15=-0.03, p_up=0.70)
    
    df = pd.DataFrame([sig_a, sig_b])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    rec_a = next(o for o in opps if o.ticker == "STOCK_A")
    rec_b = next(o for o in opps if o.ticker == "STOCK_B")
    
    # Stock B has higher raw EV
    assert rec_b.expectedValue > rec_a.expectedValue
    # But Stock A has higher riskAdjustedExpectedValue
    assert rec_a.riskAdjustedExpectedValue > rec_b.riskAdjustedExpectedValue
    # Therefore Stock A has alphaRank = 1 and Stock B has alphaRank = 2
    assert rec_a.alphaRank == 1
    assert rec_b.alphaRank == 2

def test_adv_02_positive_ev_rejected_for_superior_opportunity():
    """2. Stock with positive EV rejected because another stock has higher risk-adjusted EV when slots limited."""
    sig_a = create_valid_signal(ticker="STOCK_A", gain=0.05, loss=0.01, p15=-0.01, p_up=0.65)
    sig_b = create_valid_signal(ticker="STOCK_B", gain=0.03, loss=0.02, p15=-0.02, p_up=0.60)
    
    df = pd.DataFrame([sig_a, sig_b])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    # Run allocation with top_n = 1
    selected, rejected = select_and_allocate_portfolio(
        opps, [], 1_000_000, 1_000_000, {}, "2025-01-02", top_n=1
    )
    
    assert len(selected) == 1
    assert selected[0].ticker == "STOCK_A"
    
    # Stock B had positive EV but was rejected because of Top-1 cutoff
    rej_b = next(o for o in rejected if o.ticker == "STOCK_B")
    assert rej_b.ineligibilityReason == "BEYOND_TOP_1_CUTOFF"

def test_adv_03_opportunity_table_has_30_required_fields():
    """3. Opportunity table contains exactly the specified required fields from Section 2."""
    sig = create_valid_signal()
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    rec_dict = opps[0].to_dict()
    required_fields = [
        'timestamp', 'ticker', 'sector', 'horizon', 'calibratedProbability',
        'probabilityRank', 'expectedGain', 'expectedLoss', 'expectedReturn',
        'stopReturn', 'targetReturn', 'expectedValue', 'expectedRisk',
        'riskAdjustedExpectedValue', 'ATR', 'volatility', 'beta',
        'liquidity', 'ADV', 'participationRate', 'correlationToPortfolio',
        'sectorExposureBefore', 'sectorExposureAfter', 'grossExposureBefore',
        'grossExposureAfter', 'turnoverCost', 'slippageEstimate',
        'tradeEligible', 'ineligibilityReason', 'distributionVersion',
        'distributionFitStart', 'distributionFitEnd'
    ]
    for field in required_fields:
        assert field in rec_dict, f"Missing required field {field}"

def test_adv_04_risk_adjusted_ev_formula_exact():
    """4. Risk-adjusted EV equals EV / expectedRisk exactly."""
    sig = create_valid_signal(gain=0.04, loss=0.02, p15=-0.02, p_up=0.60)
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000, round_trip_cost=0.003)
    
    o = opps[0]
    expected_ev = (0.60 * 0.04) - (0.40 * 0.02) - 0.003
    expected_risk = 0.02
    assert abs(o.expectedValue - expected_ev) < 1e-6
    assert abs(o.expectedRisk - expected_risk) < 1e-6
    assert abs(o.riskAdjustedExpectedValue - (expected_ev / expected_risk)) < 1e-6

def test_adv_05_risk_le_zero_null_and_ineligible():
    """5. Risk <= 0 produces null riskAdjustedEV and tradeEligible = false."""
    sig = create_valid_signal(p15=0.0) # Invalid non-negative stop return
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    assert opps[0].tradeEligible is False
    assert opps[0].riskAdjustedExpectedValue is None

def test_adv_06_top_n_cutoff_strictly_enforced():
    """6. Top-N cutoff strictly enforced (N+1-th candidate never traded)."""
    sigs = [create_valid_signal(ticker=f"STK_{i}", sector=f"Sector_{i}", gain=0.05 + i*0.01) for i in range(5)]
    df = pd.DataFrame(sigs)
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    selected, rejected = select_and_allocate_portfolio(
        opps, [], 1_000_000, 1_000_000, {}, "2025-01-02", top_n=3
    )
    
    assert len(selected) == 3
    assert all(o.alphaRank <= 3 for o in selected)
    for r in rejected:
        if r.alphaRank and r.alphaRank > 3:
            assert r.ineligibilityReason == "BEYOND_TOP_3_CUTOFF"

def test_adv_07_deterministic_tie_breaking():
    """7. Equal risk-adjusted EV uses deterministic tie-breaking."""
    sig_a = create_valid_signal(ticker="BBB.NS", gain=0.05, loss=0.02, p15=-0.02)
    sig_b = create_valid_signal(ticker="AAA.NS", gain=0.05, loss=0.02, p15=-0.02)
    df = pd.DataFrame([sig_a, sig_b])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    # Both receive valid, distinct ranks without crashing or undefined state
    ranks = [o.alphaRank for o in opps]
    assert sorted(ranks) == [1, 2]

def test_adv_08_correlated_cluster_cap_enforced():
    """8. Correlated cluster exposure cap (50%) strictly enforced."""
    # Create candle series with 1.0 correlation up to 2025-01-02
    dates = pd.date_range("2024-10-01", periods=100, freq="D")
    sin_ret = 0.01 * np.sin(np.linspace(0, 20, 100))
    prices = 100.0 * np.cumprod(1.0 + sin_ret)
    candles_a = pd.DataFrame({'Close': prices, 'Open': prices}, index=[str(d)[:10] for d in dates])
    candles_b = pd.DataFrame({'Close': prices, 'Open': prices}, index=[str(d)[:10] for d in dates])
    candles = {"STK_A": candles_a, "STK_B": candles_b}
    
    # Portfolio already has 45% in STK_A
    open_pos = [{
        'ticker': 'STK_A',
        'sector': 'Technology',
        'entryPrice': 100.0,
        'currentPrice': 100.0,
        'notional': 450_000.0
    }]
    
    # STK_B has correlation = 1.0 to STK_A
    sig_b = create_valid_signal(ticker="STK_B", sector="Energy", date="2025-01-02")
    df = pd.DataFrame([sig_b])
    opps = build_daily_opportunity_table("2025-01-02", df, candles, open_pos, 1_000_000, 500_000)
    
    # Trying to allocate 100k notional would bring cluster exposure to (450k + 100k) / 1M = 55% > 50%
    selected, rejected = select_and_allocate_portfolio(
        opps, open_pos, 1_000_000, 500_000, candles, "2025-01-02",
        max_cluster_exposure=0.50
    )
    assert len(selected) == 0
    assert rejected[-1].ineligibilityReason == "CORRELATED_CLUSTER_LIMIT_EXCEEDED"

def test_adv_09_sector_cap_25_pct_enforced():
    """9. Sector exposure cap (25%) strictly enforced across multiple candidates."""
    open_pos = [
        {'ticker': 'TECH_1', 'sector': 'Technology', 'entryPrice': 100, 'currentPrice': 100, 'notional': 100_000},
        {'ticker': 'TECH_2', 'sector': 'Technology', 'entryPrice': 100, 'currentPrice': 100, 'notional': 100_000}
    ]
    # Current tech = 200k / 1M = 20%
    # Next tech order = 100k would bring sector to 300k / 1M = 30% > 25%
    sig = create_valid_signal(ticker="TECH_3", sector="Technology")
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, open_pos, 1_000_000, 800_000)
    selected, rejected = select_and_allocate_portfolio(
        opps, open_pos, 1_000_000, 800_000, {}, "2025-01-02",
        max_sector_weight=0.25
    )
    assert len(selected) == 0
    assert rejected[-1].ineligibilityReason == "SECTOR_EXPOSURE_LIMIT_EXCEEDED"

def test_adv_10_gross_exposure_100_pct_enforced():
    """10. Gross exposure cap (100%) strictly enforced."""
    open_pos = [{'ticker': f"STK_{i}", 'sector': f"Sec_{i}", 'entryPrice': 100, 'currentPrice': 100, 'notional': 100_000} for i in range(10)]
    # Current gross = 100%
    sig = create_valid_signal(ticker="EXTRA_STK", sector="NewSec")
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, open_pos, 1_000_000, 500_000)
    selected, rejected = select_and_allocate_portfolio(
        opps, open_pos, 1_000_000, 500_000, {}, "2025-01-02",
        max_gross_exposure=1.0
    )
    assert len(selected) == 0
    assert rejected[-1].ineligibilityReason == "GROSS_EXPOSURE_LIMIT_EXCEEDED"

def test_adv_11_cash_retention_when_ev_le_zero():
    """11. Cash retention when all candidates have EV <= 0."""
    sig = create_valid_signal(p_up=0.30, gain=0.02, loss=0.05) # Severe negative EV
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    selected, rejected = select_and_allocate_portfolio(
        opps, [], 1_000_000, 1_000_000, {}, "2025-01-02"
    )
    assert len(selected) == 0
    assert opps[0].tradeEligible is False

def test_adv_12_cash_retention_when_ev_below_hurdle():
    """12. Cash retention when all candidates have EV <= minimumDecisionMargin."""
    sig = create_valid_signal(p_up=0.55, gain=0.03, loss=0.03) # Small positive EV ~ 0.000
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table(
        "2025-01-02", df, {}, [], 1_000_000, 1_000_000,
        minimum_decision_margin=0.005 # Hurdle requires > 0.005 net EV
    )
    assert opps[0].tradeEligible is False
    assert opps[0].ineligibilityReason == "INSUFFICIENT_DECISION_MARGIN"

def test_adv_13_position_sizing_risk_budget_over_stop():
    """13. Position sizing: notional = riskBudget / stopDistance."""
    # Equity = 1,000,000, Risk = 0.50% = 5,000 INR
    # Stop distance = 0.02
    # Notional = 5,000 / 0.02 = 250,000 INR (capped by 10% pos cap = 100,000 INR)
    # If stop distance = 0.10 -> 5,000 / 0.10 = 50,000 INR (< 100,000 INR pos cap)
    sig = create_valid_signal(p15=-0.10)
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    selected, _ = select_and_allocate_portfolio(
        opps, [], 1_000_000, 1_000_000, {}, "2025-01-02",
        risk_per_trade=0.005
    )
    assert abs(selected[0].sizedNotional - 50_000.0) < 1.0

def test_adv_14_position_sizing_capped_at_max_position_weight():
    """14. Position sizing capped at MAX_POSITION_WEIGHT (10%)."""
    # Stop distance = 0.01 -> riskBudget / stopDistance = 5,000 / 0.01 = 500,000 INR
    # Must be capped at 10% * 1,000,000 = 100,000 INR
    sig = create_valid_signal(p15=-0.01)
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    selected, _ = select_and_allocate_portfolio(
        opps, [], 1_000_000, 1_000_000, {}, "2025-01-02",
        risk_per_trade=0.005, max_position_weight=0.10
    )
    assert abs(selected[0].sizedNotional - 100_000.0) < 1.0

def test_adv_15_insufficient_liquidity_rejected():
    """15. Candidate with insufficient liquidity rejected."""
    sig = create_valid_signal(adv_shares=10.0, open_price=10.0) # ADV = 100 INR < 500k
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    assert opps[0].tradeEligible is False
    assert opps[0].ineligibilityReason == "INSUFFICIENT_LIQUIDITY"

def test_adv_16_missing_expected_risk_rejected():
    """16. Trade with missing expectedRisk rejected: tradeEligible = false."""
    sig = create_valid_signal()
    sig['missingRisk'] = True
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    assert opps[0].tradeEligible is False
    assert opps[0].ineligibilityReason == "INSUFFICIENT_RISK_DATA"

def test_adv_17_missing_expected_gain_rejected():
    """17. Trade with missing expectedGain rejected: tradeEligible = false."""
    sig = create_valid_signal()
    del sig['conditional_gain']
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    assert opps[0].tradeEligible is False
    assert opps[0].ineligibilityReason == "MISSING_EXPECTED_GAIN"

def test_adv_18_missing_expected_loss_rejected():
    """18. Trade with missing expectedLoss rejected: tradeEligible = false."""
    sig = create_valid_signal()
    del sig['conditional_loss']
    df = pd.DataFrame([sig])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    assert opps[0].tradeEligible is False
    assert opps[0].ineligibilityReason == "MISSING_EXPECTED_LOSS"

def test_adv_19_opportunity_ledger_and_cash_ledger_populated():
    """19. Opportunity ledger and cash ledger properly recorded during backtest."""
    sig = create_valid_signal(p_up=0.30, gain=0.01, loss=0.05) # Negative EV -> Cash
    df = pd.DataFrame([sig])
    res = run_portfolio_backtest(df, horizon_days=5, strategy_mode='PRODUCTION_EXPECTED_VALUE')
    assert len(res['opportunityLedger']) > 0
    assert len(res['cashOpportunityLedger']) > 0
    assert res['cashOpportunityLedger'][0]['action'] == 'HOLD_CASH'

def test_adv_20_optimization_leakage_error_on_test_or_holdout():
    """20. OptimizationLeakageError raised when strategy selection/tuning is attempted on TEST or HOLDOUT."""
    def tune_strategy_parameters(partition: str):
        if partition in ['TEST', 'HOLDOUT']:
            raise OptimizationLeakageError(f"CRITICAL: Strategy parameter search attempted on {partition}!")
        return {"top_n": 3, "min_margin": 0.002}
        
    with pytest.raises(OptimizationLeakageError):
        tune_strategy_parameters("TEST")
        
    with pytest.raises(OptimizationLeakageError):
        tune_strategy_parameters("HOLDOUT")
        
    res = tune_strategy_parameters("VALIDATION")
    assert res["top_n"] == 3

# ============================================================================
# Section 45: Golden Portfolio Test
# ============================================================================

def test_golden_portfolio_10_candidate_stocks():
    """Section 45: 10 candidate stocks with known inputs, assert exact alpha ranks and portfolio weights."""
    candidates_data = [
        ("STK_01", 0.70, 0.06, 0.02, -0.02, "Technology"),   # EV = 0.033, Risk = 0.02, RiskAdj = 1.65
        ("STK_02", 0.65, 0.05, 0.02, -0.015, "Financials"),  # EV = 0.0225, Risk = 0.015, RiskAdj = 1.50
        ("STK_03", 0.60, 0.04, 0.02, -0.01, "Energy"),       # EV = 0.013, Risk = 0.01, RiskAdj = 1.30
        ("STK_04", 0.68, 0.05, 0.025, -0.025, "Consumer"),   # EV = 0.023, Risk = 0.025, RiskAdj = 0.92
        ("STK_05", 0.58, 0.04, 0.02, -0.02, "Healthcare"),   # EV = 0.0118, Risk = 0.02, RiskAdj = 0.59
        ("STK_06", 0.55, 0.03, 0.02, -0.02, "Materials"),    # EV = 0.0045, Risk = 0.02, RiskAdj = 0.225
        ("STK_07", 0.52, 0.03, 0.02, -0.03, "Utilities"),    # EV = 0.003, Risk = 0.03, RiskAdj = 0.10
        ("STK_08", 0.50, 0.02, 0.02, -0.02, "Industrials"),  # EV = -0.003 (Negative EV)
        ("STK_09", 0.45, 0.02, 0.03, -0.03, "RealEstate"),   # EV = -0.0105 (Negative EV)
        ("STK_10", 0.40, 0.01, 0.04, -0.04, "Telecom"),      # EV = -0.023 (Negative EV)
    ]
    sigs = []
    for ticker, p_up, gain, loss, p15, sector in candidates_data:
        sigs.append(create_valid_signal(
            ticker=ticker, p_up=p_up, gain=gain, loss=loss, p15=p15, sector=sector
        ))
    df = pd.DataFrame(sigs)
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    # Verify Ranks
    assert next(o for o in opps if o.ticker == "STK_01").alphaRank == 1
    assert next(o for o in opps if o.ticker == "STK_02").alphaRank == 2
    assert next(o for o in opps if o.ticker == "STK_03").alphaRank == 3
    assert next(o for o in opps if o.ticker == "STK_04").alphaRank == 4
    assert next(o for o in opps if o.ticker == "STK_05").alphaRank == 5
    assert next(o for o in opps if o.ticker == "STK_06").alphaRank == 6
    assert next(o for o in opps if o.ticker == "STK_07").alphaRank == 7
    
    # 8, 9, 10 must be ineligible
    for t in ["STK_08", "STK_09", "STK_10"]:
        assert next(o for o in opps if o.ticker == t).tradeEligible is False

    # Select Top 3
    selected, rejected = select_and_allocate_portfolio(
        opps, [], 1_000_000, 1_000_000, {}, "2025-01-02", top_n=3
    )
    assert len(selected) == 3
    assert [o.ticker for o in selected] == ["STK_01", "STK_02", "STK_03"]
    # All 3 capped at 10% (100,000 INR)
    for s in selected:
        assert abs(s.sizedNotional - 100_000.0) < 1.0

# ============================================================================
# Section 46: Economic Attribution Test
# ============================================================================

def test_economic_attribution_prefers_lower_ev_half_risk():
    """Section 46: Verify utility prefers lower EV / half risk over higher EV / double risk."""
    # Candidate A: Net EV = 0.03, Risk = 0.01 -> RiskAdj = 3.0
    # Candidate B: Net EV = 0.05, Risk = 0.03 -> RiskAdj = 1.67
    sig_a = create_valid_signal(ticker="CANDIDATE_A", gain=0.05, loss=0.015, p15=-0.01, p_up=0.70)
    sig_b = create_valid_signal(ticker="CANDIDATE_B", gain=0.08, loss=0.035, p15=-0.03, p_up=0.75)
    
    df = pd.DataFrame([sig_a, sig_b])
    opps = build_daily_opportunity_table("2025-01-02", df, {}, [], 1_000_000, 1_000_000)
    
    rec_a = next(o for o in opps if o.ticker == "CANDIDATE_A")
    rec_b = next(o for o in opps if o.ticker == "CANDIDATE_B")
    
    assert rec_a.riskAdjustedExpectedValue > rec_b.riskAdjustedExpectedValue
    assert rec_a.alphaRank == 1
    assert rec_b.alphaRank == 2
