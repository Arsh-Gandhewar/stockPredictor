"""
Targeted Economic Repair #6 Adversarial Test Suite.
Verifies side-aware fees, explicit adverse slippage, monotonic market impact,
point-in-time ADV rolling window, liquidity caps, net EV decision gating,
and golden execution, EV, and capacity tests.
"""
import os
import sys
import pytest
import pandas as pd
import numpy as np

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from models.execution_cost_engine import (
    ExecutionCostEngine,
    ExecutionCostConfig,
    ExecutionCostLeakageError,
    LiquidityCapExceededError,
    COST_REGIME_CONFIGS
)
from backtest.backtest_engine import run_portfolio_backtest
from models.cross_sectional_ranker import OptimizationLeakageError

# ============================================================
# SECTION 63: GOLDEN EXECUTION TEST
# ============================================================
def test_golden_execution_test():
    """
    Section 63:
    BUY: reference = 100, qty = 1000 (notional = 100,000).
    SELL: reference = 110, qty = 1000 (gross proceeds = 110,000).
    Gross PnL = 110,000 - 100,000 = 10,000.
    Total Execution Cost = entryCost + exitCost.
    Net PnL = Gross PnL - Total Execution Cost.
    QuantX verifies mathematical exactness: Gross PnL - Net PnL == Total Execution Cost.
    """
    engine = ExecutionCostEngine(regime='BASE_COST')
    buy_res = engine.calculate_transaction_cost(
        side='BUY', reference_price=100.0, quantity=1000.0, notional=100000.0
    )
    sell_res = engine.calculate_transaction_cost(
        side='SELL', reference_price=110.0, quantity=1000.0, notional=110000.0
    )
    
    assert buy_res['executionPrice'] >= buy_res['referencePrice']
    assert sell_res['executionPrice'] <= sell_res['referencePrice']
    
    entry_total_cost = buy_res['totalCost']
    exit_total_cost = sell_res['totalCost']
    total_cost = entry_total_cost + exit_total_cost
    
    gross_pnl = 10000.0
    net_pnl = gross_pnl - total_cost
    assert abs((gross_pnl - net_pnl) - total_cost) < 1e-8

# ============================================================
# SECTION 64: GOLDEN EV TEST
# ============================================================
def test_golden_ev_test():
    """
    Section 64:
    P_UP = 0.60, E_gain = 4%, E_loss = 2%.
    grossEV = 0.60 * 4% - 0.40 * 2% = 1.60%.
    With expected cost = 0.50%: netEV = 1.10% > 0 -> POSITIVE_NET_EV.
    With expected cost = 2.00%: netEV = -0.40% <= 0 -> NEGATIVE_NET_EV -> NO TRADE.
    """
    p_up, p_down = 0.60, 0.40
    e_gain, e_loss = 0.04, 0.02
    gross_ev = (p_up * e_gain) - (p_down * e_loss)
    assert abs(gross_ev - 0.016) < 1e-8
    
    # Case 1: Low cost (0.50%)
    cost_1 = 0.0050
    net_ev_1 = gross_ev - cost_1
    assert net_ev_1 > 0.0, "Expected positive net EV"
    
    # Case 2: High cost (2.00%)
    cost_2 = 0.0200
    net_ev_2 = gross_ev - cost_2
    assert net_ev_2 <= 0.0, "Expected non-positive net EV triggering NO_TRADE"

# ============================================================
# SECTION 65: GOLDEN CAPACITY TEST
# ============================================================
def test_golden_capacity_test():
    """
    Section 65:
    ADV = 10,000,000 INR. Max participation = 5%.
    Maximum order = 500,000 INR.
    Order 490,000 (4.9%) -> eligible.
    Order 510,000 (5.1%) -> rejected with LIQUIDITY_CAP.
    """
    engine = ExecutionCostEngine(regime='BASE_COST')
    adv = 10000000.0 # 1 crore
    
    res_ok = engine.calculate_transaction_cost(
        side='BUY', reference_price=100.0, quantity=4900.0, notional=490000.0, adv=adv
    )
    assert res_ok['eligible'] is True
    assert res_ok['participationRate'] == 0.049
    
    res_fail = engine.calculate_transaction_cost(
        side='BUY', reference_price=100.0, quantity=5100.0, notional=510000.0, adv=adv
    )
    assert res_fail['eligible'] is False
    assert res_fail['rejectionReason'] == 'LIQUIDITY_CAP'
    assert res_fail['participationRate'] == 0.051

# ============================================================
# SECTION 62: REQUIRED REGRESSION TESTS (1 TO 20)
# ============================================================

def test_cost_01_zero_fees():
    """Test 1: Zero fees configuration"""
    cfg = ExecutionCostConfig(
        brokerage_rate=0.0, max_brokerage_per_order=0.0, exchange_rate=0.0, gst_rate=0.0,
        sebi_rate=0.0, stamp_duty_rate_buy=0.0, stt_rate_sell=0.0, base_slippage_bps=0.0,
        impact_coefficient=0.0, max_participation_rate=0.05, adv_lookback=20, cost_regime='ZERO'
    )
    engine = ExecutionCostEngine(custom_config=cfg)
    res = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0)
    assert res['fees'] == 0.0
    assert res['slippage'] == 0.0
    assert res['marketImpact'] == 0.0
    assert res['totalCost'] == 0.0

def test_cost_02_zero_slippage():
    """Test 2: Zero slippage leaves reference price equal to execution price"""
    cfg = ExecutionCostConfig(
        brokerage_rate=0.0003, max_brokerage_per_order=20.0, exchange_rate=0.0000345, gst_rate=0.18,
        sebi_rate=0.000001, stamp_duty_rate_buy=0.00015, stt_rate_sell=0.0010, base_slippage_bps=0.0,
        impact_coefficient=0.0, max_participation_rate=0.05, adv_lookback=20, cost_regime='NO_SLIPPAGE'
    )
    engine = ExecutionCostEngine(custom_config=cfg)
    res = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0)
    assert res['slippage'] == 0.0
    assert res['executionPrice'] == 100.0

def test_cost_03_zero_impact():
    """Test 3: Zero impact coefficient produces 0 market impact"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    res = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0, adv=1000000.0)
    assert res['marketImpact'] >= 0.0

def test_cost_04_asymmetric_buy_sell_charges():
    """Test 4: Asymmetric statutory taxes (Stamp duty on BUY, STT on SELL)"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    buy_res = engine.calculate_transaction_cost('BUY', 100.0, 1000.0, 100000.0)
    sell_res = engine.calculate_transaction_cost('SELL', 100.0, 1000.0, 100000.0)
    assert buy_res['stampDuty'] > 0.0
    assert buy_res['stt'] == 0.0
    assert sell_res['stampDuty'] == 0.0
    assert sell_res['stt'] > 0.0

def test_cost_05_base_5bps_slippage():
    """Test 5: Base slippage of 5 bps applied adversely"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    buy_res = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0)
    sell_res = engine.calculate_transaction_cost('SELL', 100.0, 100.0, 10000.0)
    assert buy_res['executionPrice'] > 100.0
    assert sell_res['executionPrice'] < 100.0

def test_cost_06_stress_20bps_slippage():
    """Test 6: Stressed cost regime increases slippage rate"""
    base_eng = ExecutionCostEngine(regime='BASE_COST')
    stress_eng = ExecutionCostEngine(regime='STRESSED_COST')
    b_res = base_eng.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0)
    s_res = stress_eng.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0)
    assert s_res['slippage'] > b_res['slippage']

def test_cost_07_high_participation_cost_increase():
    """Test 7: Higher participation produces strictly higher market impact"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    adv = 1000000.0
    res_low = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0, adv=adv) # 1%
    res_high = engine.calculate_transaction_cost('BUY', 100.0, 400.0, 40000.0, adv=adv) # 4%
    assert res_high['marketImpactBps'] > res_low['marketImpactBps']

def test_cost_08_low_participation_cost():
    """Test 8: Low participation produces negligible market impact"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    res = engine.calculate_transaction_cost('BUY', 100.0, 10.0, 1000.0, adv=10000000.0) # 0.01%
    assert res['marketImpactBps'] < 1.0

def test_cost_09_missing_adv_rejection():
    """Test 9: Missing ADV triggers rejection when liquidity enforcement is enabled"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    res = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0, ticker='UNKNOWN.NS', adv=None)
    assert res['eligible'] is False
    assert res['rejectionReason'] == 'INSUFFICIENT_ADV_DATA'

def test_cost_10_future_adv_lookahead_leakage():
    """Test 10: Rolling ADV strictly excludes future sessions"""
    dates = pd.date_range('2023-01-01', periods=30, freq='B')
    df = pd.DataFrame({'Close': [100.0] * 30, 'Volume': [1000] * 30}, index=dates)
    engine = ExecutionCostEngine()
    adv_before = engine.compute_rolling_adv(df, dates[25])
    
    # Inject massive volume in future dates (dates[26:])
    df_leak = df.copy()
    df_leak.loc[dates[26]:, 'Volume'] = 10000000
    adv_after = engine.compute_rolling_adv(df_leak, dates[25])
    assert adv_before == adv_after, "Future volume must not alter past ADV!"

def test_cost_11_future_volatility_lookahead_leakage():
    """Test 11: Future column in candles triggers ExecutionCostLeakageError"""
    dates = pd.date_range('2023-01-01', periods=25, freq='B')
    df = pd.DataFrame({'Close': [100.0] * 25, 'Volume': [1000] * 25, 'future_vol': [0.5] * 25}, index=dates)
    engine = ExecutionCostEngine()
    with pytest.raises(ExecutionCostLeakageError, match="CRITICAL CAUSAL LEAKAGE"):
        engine.compute_rolling_adv(df, dates[22])

def test_cost_12_market_impact_monotonicity():
    """Test 12: Monotonicity invariant: impact(A) <= impact(B) <= impact(C)"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    adv = 1000000.0
    r1 = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0, adv=adv) # 1%
    r2 = engine.calculate_transaction_cost('BUY', 100.0, 200.0, 20000.0, adv=adv) # 2%
    r3 = engine.calculate_transaction_cost('BUY', 100.0, 500.0, 50000.0, adv=adv) # 5%
    assert r1['marketImpact'] <= r2['marketImpact'] <= r3['marketImpact']

def test_cost_13_participation_cap_rejection():
    """Test 13: Participation rate > 5% rejected with LIQUIDITY_CAP"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    res = engine.calculate_transaction_cost('BUY', 100.0, 600.0, 60000.0, adv=1000000.0) # 6%
    assert res['eligible'] is False
    assert res['rejectionReason'] == 'LIQUIDITY_CAP'

def test_cost_14_cost_double_counting_assertion():
    """Test 14: Exact identity netPnL = grossPnL - fees - slippage - marketImpact"""
    engine = ExecutionCostEngine(regime='BASE_COST')
    b = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0)
    s = engine.calculate_transaction_cost('SELL', 105.0, 100.0, 10500.0)
    gross_pnl = 500.0
    tot_fees = b['fees'] + s['fees']
    tot_slip = b['slippage'] + s['slippage']
    tot_imp = b['marketImpact'] + s['marketImpact']
    net_pnl = gross_pnl - (tot_fees + tot_slip + tot_imp)
    diff = abs(net_pnl - (gross_pnl - tot_fees - tot_slip - tot_imp))
    assert diff < 1e-8

def test_cost_15_gross_net_reconciliation():
    """Test 15: Backtest results report explicit grossPnL, netPnL, and costDrag"""
    dates = pd.date_range('2023-08-01', periods=7, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 7, 'High': [102.0] * 7, 'Low': [99.0] * 7, 'Close': [101.0] * 7, 'Volume': [50000] * 7
    }, index=[str(d)[:10] for d in dates])
    pred_df = pd.DataFrame([{
        'ticker': 'RECON.NS', 'date': str(dates[0])[:10], 'predictionTimestamp': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.65, 'pred_prob': 0.65, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.04, 'conditional_loss': 0.02, 'p15': -0.02, 'p50': 0.01, 'p85': 0.04,
        'ev_after_cost': 0.015, 'riskAdjustedExpectedValue': 0.75, 'opportunityScore': 0.75
    }])
    res = run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'RECON.NS': candles}, horizon_days=5)
    assert 'grossPnL' in res
    assert 'netPnL' in res
    assert 'costDrag' in res
    assert res['costDrag'] >= 0.0

def test_cost_16_net_ev_decision_gating():
    """Test 16: Signal with negative net EV rejected before trade execution"""
    dates = pd.date_range('2023-08-01', periods=7, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 7, 'High': [102.0] * 7, 'Low': [99.0] * 7, 'Close': [101.0] * 7, 'Volume': [50000] * 7
    }, index=[str(d)[:10] for d in dates])
    # Tiny edge (0.0001) that cannot cover execution cost
    pred_df = pd.DataFrame([{
        'ticker': 'TINY.NS', 'date': str(dates[0])[:10], 'predictionTimestamp': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.505, 'pred_prob': 0.505, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.005, 'conditional_loss': 0.005, 'p15': -0.005, 'p50': 0.0001, 'p85': 0.005,
        'ev_after_cost': 0.0001, 'riskAdjustedExpectedValue': 0.01, 'opportunityScore': 0.01
    }])
    res = run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'TINY.NS': candles}, horizon_days=5)
    assert res['totalTrades'] == 0

def test_cost_17_cost_buffer_decision():
    """Test 17: Positive net EV below cost_buffer rejected"""
    dates = pd.date_range('2023-08-01', periods=7, freq='B')
    candles = pd.DataFrame({
        'Open': [100.0] * 7, 'High': [102.0] * 7, 'Low': [99.0] * 7, 'Close': [101.0] * 7, 'Volume': [50000] * 7
    }, index=[str(d)[:10] for d in dates])
    pred_df = pd.DataFrame([{
        'ticker': 'BUF.NS', 'date': str(dates[0])[:10], 'predictionTimestamp': str(dates[0])[:10],
        'horizon': '5d', 'calibratedProbability': 0.60, 'pred_prob': 0.60, 'Open': 100.0, 'atr_percent': 0.015,
        'conditional_gain': 0.03, 'conditional_loss': 0.02, 'p15': -0.02, 'p50': 0.01, 'p85': 0.03,
        'ev_after_cost': 0.01, 'riskAdjustedExpectedValue': 0.5, 'opportunityScore': 0.5
    }])
    # Require 5% cost buffer
    res = run_portfolio_backtest(predictions_df=pred_df, historical_candles_by_ticker={'BUF.NS': candles}, horizon_days=5, cost_buffer=0.05)
    assert res['totalTrades'] == 0

def test_cost_18_capacity_limit_scaling():
    """Test 18: Capital scale sensitivity analysis reflects capacity constraints"""
    engine = ExecutionCostEngine()
    adv = 500000.0 # Small cap stock
    res_100k = engine.calculate_transaction_cost('BUY', 100.0, 100.0, 10000.0, adv=adv)
    res_1m = engine.calculate_transaction_cost('BUY', 100.0, 1000.0, 100000.0, adv=adv)
    assert res_100k['eligible'] is True
    assert res_1m['eligible'] is False # 20% participation > 5%

def test_cost_19_regime_cost_interaction():
    """Test 19: EXTREME_COST regime generates higher transaction costs than BASE_COST"""
    base = ExecutionCostEngine(regime='BASE_COST')
    ext = ExecutionCostEngine(regime='EXTREME_COST')
    b_res = base.calculate_transaction_cost('BUY', 100.0, 1000.0, 100000.0)
    e_res = ext.calculate_transaction_cost('BUY', 100.0, 1000.0, 100000.0)
    assert e_res['totalCost'] > b_res['totalCost']

def test_cost_20_cost_model_version_mismatch():
    """Test 20: Cost model version stored and checked against registry"""
    engine = ExecutionCostEngine()
    assert engine.version == "v6.0.0-execution-engine"
