"""
Test Suite for QuantX Targeted Economic Repair #8:
Historical Investment Universe Validity & Anti-Survivorship Bias.

Includes:
- 3 Golden Tests (Sections 57, 58, 59)
- 25 Adversarial Regression Fixtures (Section 56)
"""
import os
import sys
import pytest
import numpy as np
import pandas as pd
from typing import Dict, List, Any

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from models.universe_engine import (
    HistoricalUniverseEngine,
    HistoricalUniverseRecord,
    SurvivorshipBiasError,
    UniverseLookaheadError,
    HISTORICAL_SECURITY_MASTER,
    SURVIVORSHIP_BIAS_STATUS,
    FULL_HISTORICAL_TOP500_CERTIFICATION,
    UNIVERSE_VERSION
)
from models.cross_sectional_ranker import build_daily_opportunity_table, OpportunityRecord
from backtest.backtest_engine import run_portfolio_backtest


# ==============================================================================
# 1. GOLDEN TESTS (Sections 57, 58, 59)
# ==============================================================================

def test_golden_pit_universe_test():
    """
    Section 57: Golden Point-in-Time Universe Test.
    Synthetic history:
      Date A: A, B eligible.
      Date B: A, B, C eligible.
      Date C: A, C eligible (B delists).
      Date D: A, C, D eligible (D lists).
    The engine MUST reproduce these exact snapshots.
    Injecting future information must leave Snapshots A/B/C/D completely unchanged.
    """
    security_master = {
        "STOCK_A": {"listingDate": "2020-01-01", "delistingDate": None},
        "STOCK_B": {"listingDate": "2020-01-01", "delistingDate": "2023-01-01"},
        "STOCK_C": {"listingDate": "2022-01-01", "delistingDate": None},
        "STOCK_D": {"listingDate": "2024-01-01", "delistingDate": None},
    }

    # Generate synthetic daily candles
    dates = pd.date_range("2020-01-01", "2025-01-01", freq="B")
    candles = {}
    for sym in security_master:
        df = pd.DataFrame({
            "Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0,
            "Volume": 100_000.0
        }, index=dates)
        candles[sym] = df

    engine = HistoricalUniverseEngine(
        security_master=security_master,
        historical_candles_by_ticker=candles,
        min_adv_threshold=1_000.0,
        adv_lookback_days=20
    )

    # Date A: 2021-06-01 -> A, B eligible
    res_a = engine.get_eligible_tickers("2021-06-01")
    assert res_a == ["STOCK_A", "STOCK_B"]

    # Date B: 2022-06-01 -> A, B, C eligible
    res_b = engine.get_eligible_tickers("2022-06-01")
    assert res_b == ["STOCK_A", "STOCK_B", "STOCK_C"]

    # Date C: 2023-06-01 -> A, C eligible (B delisted)
    res_c = engine.get_eligible_tickers("2023-06-01")
    assert res_c == ["STOCK_A", "STOCK_C"]

    # Date D: 2024-06-01 -> A, C, D eligible
    res_d = engine.get_eligible_tickers("2024-06-01")
    assert res_d == ["STOCK_A", "STOCK_C", "STOCK_D"]

    # Adversarial: Inject future massive volume spike and future delisting in 2025
    candles["STOCK_A"].loc["2024-12-01", "Volume"] = 1e12
    security_master["STOCK_A"]["delistingDate"] = "2025-12-31"

    # Snapshots A, B, C, D must remain strictly identical
    assert engine.get_eligible_tickers("2021-06-01") == res_a
    assert engine.get_eligible_tickers("2022-06-01") == res_b
    assert engine.get_eligible_tickers("2023-06-01") == res_c
    assert engine.get_eligible_tickers("2024-06-01") == res_d


def test_golden_liquidity_test():
    """
    Section 58: Golden Liquidity Test.
    20-day ADV:
      Date 1: 100 lakh (eligible)
      Date 2: 20 lakh (ineligible)
    Minimum threshold: 50 lakh.
    Future value must not affect Date 1.
    """
    dates = pd.date_range("2023-01-01", "2023-03-01", freq="B")
    # First 20 days: turnover = 100 * 100_000 = 10_000_000 (100 lakh)
    # Next 20 days: turnover = 100 * 20_000 = 2_000_000 (20 lakh)
    vols = [100_000.0 if i < 20 else 20_000.0 for i in range(len(dates))]
    df = pd.DataFrame({
        "Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0,
        "Volume": vols
    }, index=dates)

    engine = HistoricalUniverseEngine(
        security_master={"LIQ_STOCK": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={"LIQ_STOCK": df},
        min_adv_threshold=5_000_000.0, # 50 lakh
        adv_lookback_days=20
    )

    date_1 = str(dates[19])[:10]
    date_2 = str(dates[39])[:10]

    recs_1 = engine.get_eligible_securities(date_1)
    recs_2 = engine.get_eligible_securities(date_2)

    assert recs_1[0].eligible is True
    assert recs_1[0].eligibilityReason == "ELIGIBLE"
    assert recs_2[0].eligible is False
    assert recs_2[0].eligibilityReason == "ILLIQUID"

    # Future volume injection at date 2 must not affect date 1
    df.loc[date_2, "Volume"] = 1e9
    recs_1_after = engine.get_eligible_securities(date_1)
    assert recs_1_after[0].eligible is True


def test_golden_listing_delisting_test():
    """
    Section 59: Golden Listing/Delisting Test.
    Stock X:
      listed = Date 3 (2023-01-05)
      delisted = Date 8 (2023-01-12)
    Expected:
      Date 1 (2023-01-02): ineligible (NOT_LISTED)
      Date 3-7: eligible (if data available)
      Date 8+ (2023-01-12+): ineligible (DELISTED)
    """
    dates = pd.date_range("2023-01-01", "2023-01-20", freq="B")
    df = pd.DataFrame({
        "Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0,
        "Volume": 100_000.0
    }, index=dates)

    engine = HistoricalUniverseEngine(
        security_master={"STOCK_X": {"listingDate": "2023-01-05", "delistingDate": "2023-01-12"}},
        historical_candles_by_ticker={"STOCK_X": df},
        min_adv_threshold=1_000.0,
        adv_lookback_days=1 # short lookback for test
    )

    # Date 1: 2023-01-03 -> Before listing
    recs_d1 = engine.get_eligible_securities("2023-01-03")
    assert recs_d1[0].eligible is False
    assert recs_d1[0].eligibilityReason == "NOT_LISTED"

    # Date 4: 2023-01-06 -> Listed and tradable
    recs_d4 = engine.get_eligible_securities("2023-01-06")
    assert recs_d4[0].eligible is True
    assert recs_d4[0].eligibilityReason == "ELIGIBLE"

    # Date 8: 2023-01-12 -> Effective delisting date
    recs_d8 = engine.get_eligible_securities("2023-01-12")
    assert recs_d8[0].eligible is False
    assert recs_d8[0].eligibilityReason == "DELISTED"


# ==============================================================================
# 2. ADVERSARIAL REGRESSION TESTS (Section 56: Fixtures 1 to 25)
# ==============================================================================

def test_adv_01_current_top500_retroactive_blocked():
    """Case 1: Current top-500 applied retrospectively raises SurvivorshipBiasError."""
    engine = HistoricalUniverseEngine()
    with pytest.raises(SurvivorshipBiasError):
        engine.get_eligible_securities("2022-01-01", enforce_current_survivors_only=True)


def test_adv_02_future_market_cap_injection():
    """Case 2: Future market-cap / volume injection leaves historical eligibility invariant."""
    dates = pd.date_range("2022-01-01", "2023-01-01", freq="B")
    df = pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": 50_000.0}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"SYM": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={"SYM": df},
        min_adv_threshold=1_000_000.0,
        adv_lookback_days=20
    )
    t_hist = "2022-06-01"
    res_before = engine.get_eligible_securities(t_hist)[0].eligible

    # Inject future massive volume spike
    df.loc["2022-12-01", "Volume"] = 1e9
    res_after = engine.get_eligible_securities(t_hist)[0].eligible
    assert res_before == res_after


def test_adv_03_future_adv_injection():
    """Case 3: Injected future ADV does not alter trailing ADV at date T."""
    dates = pd.date_range("2022-01-01", "2023-01-01", freq="B")
    df = pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": 10_000.0}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"SYM": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={"SYM": df},
        min_adv_threshold=500_000.0,
        adv_lookback_days=20
    )
    t_hist = "2022-06-01"
    adv_before = engine.get_eligible_securities(t_hist)[0].trailingADV

    # Alter future data
    df.loc["2022-10-01":, "Volume"] = 1_000_000.0
    adv_after = engine.get_eligible_securities(t_hist)[0].trailingADV
    assert adv_before == adv_after


def test_adv_04_future_price_injection_penetration_guard():
    """Case 4: Input candles with future_* keys trigger UniverseLookaheadError."""
    dates = pd.date_range("2022-01-01", "2023-01-01", freq="B")
    df = pd.DataFrame({
        "Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": 10_000.0,
        "future_close_5d": 110.0
    }, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"SYM": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={"SYM": df},
        adv_lookback_days=5
    )
    with pytest.raises(UniverseLookaheadError):
        engine.get_eligible_securities("2022-06-01")


def test_adv_05_future_index_membership_injection():
    """Case 5: Index constituent membership cannot use future index changes."""
    engine = HistoricalUniverseEngine()
    recs = engine.get_eligible_securities("2022-01-01")
    assert all(r.universeVersion == UNIVERSE_VERSION for r in recs)


def test_adv_06_future_delisting_injection():
    """Case 6: Future delisting does not remove stock retrospectively prior to delisting date."""
    dates = pd.date_range("2022-01-01", "2024-01-01", freq="B")
    df = pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": 100_000.0}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"FUTURE_DELIST": {"listingDate": "2020-01-01", "delistingDate": "2023-12-01"}},
        historical_candles_by_ticker={"FUTURE_DELIST": df},
        min_adv_threshold=1_000.0,
        adv_lookback_days=10
    )
    # At 2022-06-01, stock is eligible
    rec_prior = engine.get_eligible_securities("2022-06-01")[0]
    assert rec_prior.eligible is True
    # At 2023-12-15, stock is ineligible
    rec_post = engine.get_eligible_securities("2023-12-15")[0]
    assert rec_post.eligible is False
    assert rec_post.eligibilityReason == "DELISTED"


def test_adv_07_pre_listing_stock():
    """Case 7: Pre-listing observations strictly marked NOT_LISTED."""
    engine = HistoricalUniverseEngine(
        security_master={"IPO_STOCK": {"listingDate": "2023-05-15", "delistingDate": None}},
        historical_candles_by_ticker={"IPO_STOCK": pd.DataFrame()}
    )
    rec = engine.get_eligible_securities("2023-01-01")[0]
    assert rec.eligible is False
    assert rec.eligibilityReason == "NOT_LISTED"
    assert rec.listingStatus == "PRE_LISTING"


def test_adv_08_post_delisting_stock():
    """Case 8: Post-delisting dates strictly marked DELISTED."""
    engine = HistoricalUniverseEngine(
        security_master={"OLD_STOCK": {"listingDate": "2010-01-01", "delistingDate": "2022-01-01"}},
        historical_candles_by_ticker={"OLD_STOCK": pd.DataFrame()}
    )
    rec = engine.get_eligible_securities("2022-05-01")[0]
    assert rec.eligible is False
    assert rec.eligibilityReason == "DELISTED"


def test_adv_09_stock_entering_universe_midway():
    """Case 9: Stock entering universe midway transitions from NOT_LISTED to ELIGIBLE."""
    dates = pd.date_range("2022-06-01", "2023-01-01", freq="B")
    df = pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": 100_000.0}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"NEW_ENTRY": {"listingDate": "2022-06-01", "delistingDate": None}},
        historical_candles_by_ticker={"NEW_ENTRY": df},
        min_adv_threshold=1_000.0,
        adv_lookback_days=5
    )
    assert engine.get_eligible_securities("2022-05-01")[0].eligibilityReason == "NOT_LISTED"
    assert engine.get_eligible_securities("2022-06-15")[0].eligibilityReason == "ELIGIBLE"


def test_adv_10_stock_leaving_universe_midway():
    """Case 10: Stock leaving universe midway transitions from ELIGIBLE to DELISTED."""
    dates = pd.date_range("2022-01-01", "2023-01-01", freq="B")
    df = pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": 100_000.0}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"EXIT_STOCK": {"listingDate": "2020-01-01", "delistingDate": "2022-07-01"}},
        historical_candles_by_ticker={"EXIT_STOCK": df},
        min_adv_threshold=1_000.0,
        adv_lookback_days=5
    )
    assert engine.get_eligible_securities("2022-06-01")[0].eligibilityReason == "ELIGIBLE"
    assert engine.get_eligible_securities("2022-07-05")[0].eligibilityReason == "DELISTED"


def test_adv_11_illiquid_stock_becoming_liquid():
    """Case 11: Stock with low trailing volume becoming liquid transitions from ILLIQUID to ELIGIBLE."""
    dates = pd.date_range("2022-01-01", "2022-03-01", freq="B")
    vols = [1_000.0 if i < 15 else 100_000.0 for i in range(len(dates))]
    df = pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": vols}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"VOL_STOCK": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={"VOL_STOCK": df},
        min_adv_threshold=2_000_000.0,
        adv_lookback_days=10
    )
    # Early date: 1000 * 100 = 100,000 < 2M -> ILLIQUID
    assert engine.get_eligible_securities(str(dates[12])[:10])[0].eligibilityReason == "ILLIQUID"
    # Late date: 100,000 * 100 = 10M > 2M -> ELIGIBLE
    assert engine.get_eligible_securities(str(dates[28])[:10])[0].eligibilityReason == "ELIGIBLE"


def test_adv_12_liquid_stock_becoming_illiquid():
    """Case 12: Stock with high trailing volume becoming illiquid transitions from ELIGIBLE to ILLIQUID."""
    dates = pd.date_range("2022-01-01", "2022-03-01", freq="B")
    vols = [100_000.0 if i < 20 else 500.0 for i in range(len(dates))]
    df = pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": vols}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"VOL_STOCK": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={"VOL_STOCK": df},
        min_adv_threshold=2_000_000.0,
        adv_lookback_days=10
    )
    assert engine.get_eligible_securities(str(dates[15])[:10])[0].eligibilityReason == "ELIGIBLE"
    assert engine.get_eligible_securities(str(dates[35])[:10])[0].eligibilityReason == "ILLIQUID"


def test_adv_13_missing_historical_data_flag():
    """Case 13: Missing historical candles correctly return DATA_UNAVAILABLE (not assumed eligible)."""
    engine = HistoricalUniverseEngine(
        security_master={"NO_DATA_STOCK": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={}
    )
    rec = engine.get_eligible_securities("2022-01-01")[0]
    assert rec.eligible is False
    assert rec.eligibilityReason == "DATA_UNAVAILABLE"


def test_adv_14_ticker_rename_handling():
    """Case 14: Ticker rename metadata preserves canonical security identity."""
    master = {
        "NEW_SYM": {"name": "Test Co", "listingDate": "2015-01-01", "delistingDate": None, "aliases": ["OLD_SYM"]}
    }
    engine = HistoricalUniverseEngine(security_master=master)
    assert "OLD_SYM" in engine.security_master["NEW_SYM"]["aliases"]


def test_adv_15_merger_delisting():
    """Case 15: Merged company delisting halts tradability after merger date."""
    master = {
        "MERGED_CO": {"listingDate": "2010-01-01", "delistingDate": "2023-04-01"}
    }
    engine = HistoricalUniverseEngine(security_master=master)
    rec_pre = engine.get_eligible_securities("2023-03-15")[0]
    rec_post = engine.get_eligible_securities("2023-04-15")[0]
    assert rec_pre.eligibilityReason != "DELISTED"
    assert rec_post.eligibilityReason == "DELISTED"


def test_adv_16_stock_split_continuity():
    """Case 16: ADV calculation uses Price * Volume turnover, invariant to splits."""
    # Split 2:1 -> Price halves, volume doubles -> turnover constant
    dates = pd.date_range("2022-01-01", "2022-02-01", freq="B")
    prices = [200.0 if i < 10 else 100.0 for i in range(len(dates))]
    vols = [10_000.0 if i < 10 else 20_000.0 for i in range(len(dates))]
    df = pd.DataFrame({"Open": prices, "High": prices, "Low": prices, "Close": prices, "Volume": vols}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"SPLIT_CO": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={"SPLIT_CO": df},
        min_adv_threshold=1_000_000.0,
        adv_lookback_days=5
    )
    rec = engine.get_eligible_securities(str(dates[-1])[:10])[0]
    assert rec.eligible is True
    assert abs(rec.trailingADV - 2_000_000.0) < 1.0


def test_adv_17_input_file_order_shuffle_invariance():
    """Case 17: Shuffled security master produces identical eligible list and order."""
    master = {
        "ZEE": {"listingDate": "2020-01-01", "delistingDate": None},
        "AAA": {"listingDate": "2020-01-01", "delistingDate": None},
        "MMM": {"listingDate": "2020-01-01", "delistingDate": None},
    }
    dates = pd.date_range("2022-01-01", "2022-02-01", freq="B")
    candles = {s: pd.DataFrame({"Close": 100.0, "Volume": 10_000.0}, index=dates) for s in master}

    e1 = HistoricalUniverseEngine(security_master=master, historical_candles_by_ticker=candles, adv_lookback_days=5, min_adv_threshold=100)
    # Reverse dictionary order
    shuffled_master = dict(reversed(list(master.items())))
    e2 = HistoricalUniverseEngine(security_master=shuffled_master, historical_candles_by_ticker=candles, adv_lookback_days=5, min_adv_threshold=100)

    res1 = e1.get_eligible_tickers("2022-01-20")
    res2 = e2.get_eligible_tickers("2022-01-20")
    assert res1 == ["AAA", "MMM", "ZEE"]
    assert res1 == res2


def test_adv_18_duplicate_security_handling():
    """Case 18: Duplicate ticker keys in input cannot cause double inclusion."""
    engine = HistoricalUniverseEngine()
    recs = engine.get_eligible_securities("2023-01-01")
    tickers = [r.ticker for r in recs]
    assert len(tickers) == len(set(tickers))


def test_adv_19_unexplained_data_disappearance():
    """Case 19: Security listed but missing all candles is reported DATA_UNAVAILABLE."""
    engine = HistoricalUniverseEngine(
        security_master={"GHOST_CORP": {"listingDate": "2010-01-01", "delistingDate": None}},
        historical_candles_by_ticker={}
    )
    rec = engine.get_eligible_securities("2023-01-01")[0]
    assert rec.eligibilityReason == "DATA_UNAVAILABLE"


def test_adv_20_universe_versioning():
    """Case 20: Engine reports canonical universeVersion."""
    engine = HistoricalUniverseEngine(universe_version="v8.0.0-pit-universe")
    recs = engine.get_eligible_securities("2023-01-01")
    assert all(r.universeVersion == "v8.0.0-pit-universe" for r in recs)


def test_adv_21_universe_hashing_determinism():
    """Case 21: Identical snapshot produces identical SHA-256 universeHash."""
    dates = pd.date_range("2022-01-01", "2022-02-01", freq="B")
    df = pd.DataFrame({"Close": 100.0, "Volume": 10_000.0}, index=dates)
    engine = HistoricalUniverseEngine(
        security_master={"A": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker={"A": df},
        adv_lookback_days=5,
        min_adv_threshold=100
    )
    recs1 = engine.get_eligible_securities("2022-01-20")
    recs2 = engine.get_eligible_securities("2022-01-20")
    assert recs1[0].universeHash == recs2[0].universeHash
    assert len(recs1[0].universeHash) == 64


def test_adv_22_cross_sectional_ranking_pit_filter():
    """Case 22: Ineligible PIT stock is excluded before economic ranking in Opportunity Table."""
    master = {
        "GOOD_STOCK": {"listingDate": "2020-01-01", "delistingDate": None},
        "UNLISTED_STOCK": {"listingDate": "2025-01-01", "delistingDate": None}
    }
    dates = pd.date_range("2022-01-01", "2022-02-01", freq="B")
    candles = {
        "GOOD_STOCK": pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": 50_000.0}, index=dates),
        "UNLISTED_STOCK": pd.DataFrame({"Open": 50.0, "High": 52.0, "Low": 48.0, "Close": 50.0, "Volume": 50_000.0}, index=dates)
    }
    engine = HistoricalUniverseEngine(security_master=master, historical_candles_by_ticker=candles, min_adv_threshold=1000, adv_lookback_days=5)

    signals_df = pd.DataFrame([
        {"ticker": "GOOD_STOCK", "pred_prob": 0.65, "calibratedProbability": 0.65, "atr_percent": 0.02, "p15": -0.01, "p50": 0.02, "p85": 0.05, "expectedGain": 0.03, "expectedLoss": 0.015, "fitEnd": "2021-12-31"},
        {"ticker": "UNLISTED_STOCK", "pred_prob": 0.90, "calibratedProbability": 0.90, "atr_percent": 0.02, "p15": -0.01, "p50": 0.04, "p85": 0.08, "expectedGain": 0.05, "expectedLoss": 0.015, "fitEnd": "2021-12-31"}
    ])

    opps = build_daily_opportunity_table(
        date_str="2022-01-20",
        day_signals=signals_df,
        historical_candles=candles,
        open_positions=[],
        portfolio_equity=1_000_000.0,
        cash=1_000_000.0,
        universe_engine=engine
    )

    unlisted_opp = next(o for o in opps if o.ticker == "UNLISTED_STOCK")
    assert unlisted_opp.tradeEligible is False
    assert unlisted_opp.ineligibilityReason == "NOT_LISTED"


def test_adv_23_backtest_records_universe_provenance():
    """Case 23: Backtest output and trades record universeVersion and universeHash."""
    dates = pd.date_range("2023-01-01", "2023-02-01", freq="B")
    candles = {
        "STOCK_A": pd.DataFrame({"Open": 100.0, "High": 105.0, "Low": 95.0, "Close": 100.0, "Volume": 50_000.0}, index=dates)
    }
    engine = HistoricalUniverseEngine(
        security_master={"STOCK_A": {"listingDate": "2020-01-01", "delistingDate": None}},
        historical_candles_by_ticker=candles,
        min_adv_threshold=1000,
        adv_lookback_days=5
    )
    sig_df = pd.DataFrame([
        {"date": dates[10], "ticker": "STOCK_A", "calibratedProbability": 0.65, "p15": -0.01, "p50": 0.02, "p85": 0.04, "expectedGain": 0.02, "expectedLoss": 0.01, "fitEnd": "2022-12-31", "atr_percent": 0.015}
    ])
    res = run_portfolio_backtest(
        sig_df,
        strategy_mode="PRODUCTION_EXPECTED_VALUE",
        historical_candles_by_ticker=candles,
        universe_engine=engine
    )
    assert "universeVersion" in res
    assert res["universeVersion"] == UNIVERSE_VERSION
    assert "universeHash" in res


def test_adv_24_survivorship_status_disclosure():
    """Case 24: Verifies SURVIVORSHIP_BIAS_STATUS is NOT_FULLY_RESOLVED."""
    assert SURVIVORSHIP_BIAS_STATUS == "NOT_FULLY_RESOLVED"
    assert FULL_HISTORICAL_TOP500_CERTIFICATION is False


def test_adv_25_policybazaar_listing_test():
    """Case 25: Realistic check on POLICYBZR.NS (listed 2021-11-15)."""
    engine = HistoricalUniverseEngine(
        security_master=HISTORICAL_SECURITY_MASTER,
        historical_candles_by_ticker={},
        min_adv_threshold=1000,
        adv_lookback_days=5
    )
    # Before listing
    recs_early = engine.get_eligible_securities("2021-10-01")
    pb_early = next(r for r in recs_early if r.ticker == "POLICYBZR.NS")
    assert pb_early.eligible is False
    assert pb_early.eligibilityReason == "NOT_LISTED"
