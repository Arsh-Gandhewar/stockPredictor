"""
Point-in-Time Universe Management with Survivorship Bias Limitation Disclosure.
"""
from typing import List, Dict, Any
import pandas as pd
import numpy as np

# Universe definition: Top liquid representative NSE equities
NSE_UNIVERSE = [
    {"ticker": "RELIANCE.NS", "name": "Reliance Industries", "sector": "Energy"},
    {"ticker": "TCS.NS", "name": "Tata Consultancy Services", "sector": "IT"},
    {"ticker": "HDFCBANK.NS", "name": "HDFC Bank", "sector": "Financials"},
    {"ticker": "ICICIBANK.NS", "name": "ICICI Bank", "sector": "Financials"},
    {"ticker": "INFY.NS", "name": "Infosys", "sector": "IT"},
    {"ticker": "ITC.NS", "name": "ITC Limited", "sector": "Consumer Goods"},
    {"ticker": "BHARTIARTL.NS", "name": "Bharti Airtel", "sector": "Telecom"},
    {"ticker": "SBIN.NS", "name": "State Bank of India", "sector": "Financials"},
    {"ticker": "LT.NS", "name": "Larsen & Toubro", "sector": "Industrials"},
    {"ticker": "TATAMOTORS.NS", "name": "Tata Motors", "sector": "Automobile"},
    {"ticker": "SUNPHARMA.NS", "name": "Sun Pharma", "sector": "Healthcare"},
    {"ticker": "TITAN.NS", "name": "Titan Company", "sector": "Consumer Goods"},
    {"ticker": "BAJFINANCE.NS", "name": "Bajaj Finance", "sector": "Financials"},
    {"ticker": "MARUTI.NS", "name": "Maruti Suzuki", "sector": "Automobile"},
    {"ticker": "KOTAKBANK.NS", "name": "Kotak Mahindra Bank", "sector": "Financials"},
    {"ticker": "AXISBANK.NS", "name": "Axis Bank", "sector": "Financials"},
    {"ticker": "NTPC.NS", "name": "NTPC Limited", "sector": "Utilities"},
    {"ticker": "POWERGRID.NS", "name": "Power Grid Corp", "sector": "Utilities"},
    {"ticker": "TATASTEEL.NS", "name": "Tata Steel", "sector": "Materials"},
    {"ticker": "ADANIENT.NS", "name": "Adani Enterprises", "sector": "Energy"},
    {"ticker": "COALINDIA.NS", "name": "Coal India", "sector": "Energy"},
    {"ticker": "BHEL.NS", "name": "Bharat Heavy Electricals", "sector": "Industrials"},
    {"ticker": "DIXON.NS", "name": "Dixon Technologies", "sector": "Industrials"},
    {"ticker": "POLICYBZR.NS", "name": "PB Fintech", "sector": "Financials"},
    {"ticker": "COCHINSHIP.NS", "name": "Cochin Shipyard", "sector": "Industrials"},
]

INDICES = {
    "NIFTY": "^NSEI",
    "BANKNIFTY": "^NSEBANK",
    "VIX": "^INDIAVIX"
}

TICKER_SECTOR_MAP: Dict[str, str] = {s["ticker"]: s["sector"] for s in NSE_UNIVERSE}

# Explicit survivorship bias limitation disclosure
SURVIVORSHIP_BIAS_STATUS = "NOT_FULLY_RESOLVED"
SURVIVORSHIP_BIAS_DISCLOSURE = (
    "Historical constituent tracking is limited to currently listed and historical liquid NSE securities. "
    "Survivorship bias status is explicitly marked NOT_FULLY_RESOLVED due to absence of historical delisted equity tapes."
)

def rank_point_in_time_liquidity(df_dict: Dict[str, pd.DataFrame], as_of_date: str, lookback_days: int = 60) -> List[str]:
    """
    Ranks universe securities strictly on trailing historical median turnover (Price * Volume)
    available at as_of_date with zero lookahead.
    """
    liquidity_scores = {}
    
    for ticker, df in df_dict.items():
        if ticker.startswith('^'): continue
        if df is None or len(df) == 0: continue
        
        # Truncate strictly to as_of_date
        past_df = df.loc[df.index <= as_of_date]
        if len(past_df) < 20: continue
        
        recent_slice = past_df.tail(lookback_days)
        turnover = (recent_slice['Close'] * recent_slice['Volume']).median()
        if not np.isnan(turnover) and turnover > 0:
            liquidity_scores[ticker] = turnover
            
    # Sort descending by trailing turnover
    ranked = sorted(liquidity_scores.keys(), key=lambda k: liquidity_scores[k], reverse=True)
    return ranked
