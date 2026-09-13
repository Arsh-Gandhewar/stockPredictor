"""
QuantX Maximum Historical Data Ingestion Engine.
=================================================
Fetches maximum reliable point-in-time daily OHLCV data from Yahoo Finance for
NSE liquid equities, historical constituents (survivorship guards), and benchmarks.
Stores cached parquets in packages/quant-engine/data/historical_long/.
"""
import os
import sys
import time
import pandas as pd
import numpy as np
import yfinance as yf

# Target directory for long historical data
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), 'historical_long'))
os.makedirs(DATA_DIR, exist_ok=True)

# Complete historical + current NIFTY 50 constituent universe + benchmarks
# Expanded to include ALL historical NIFTY 50 members for survivorship-bias-free backtesting
ALL_SYMBOLS = [
    # Benchmarks
    "^NSEI", "^INDIAVIX", "^BSESN", "^NSEBANK",
    # Core NIFTY / Liquid Bluechips (current constituents)
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    "LT.NS", "AXISBANK.NS", "ASIANPAINT.NS", "MARUTI.NS", "TITAN.NS",
    "BAJFINANCE.NS", "SUNPHARMA.NS", "ULTRACEMCO.NS", "TATASTEEL.NS", "NTPC.NS",
    "POWERGRID.NS", "M&M.NS", "WIPRO.NS", "HCLTECH.NS", "ONGC.NS",
    "JSWSTEEL.NS", "ADANIENT.NS", "ADANIPORTS.NS", "COALINDIA.NS", "BAJAJFINSV.NS",
    # Historical / Former NIFTY 50 / Delisted / Stressed Equities (original set)
    "BHEL.NS", "VEDL.NS", "SAIL.NS", "PNB.NS", "YESBANK.NS", "ZEEL.NS",
    "IDEA.NS", "RCOM.NS", "SUZLON.NS", "GAIL.NS", "BPCL.NS", "IOC.NS",
    "CIPLA.NS", "DRREDDY.NS", "GRASIM.NS", "HEROMOTOCO.NS", "HINDALCO.NS",
    "DIVISLAB.NS", "UPL.NS", "TECHM.NS", "EICHERMOT.NS", "SHRIRAMFIN.NS",
    "TRENT.NS", "BEL.NS", "HAL.NS",
    # === NEW: Historical NIFTY 50 constituents for survivorship-bias-free universe ===
    # Former large-caps that crashed/delisted (critical for removing upward bias)
    "DLF.NS",           # NIFTY 50 2007-2014, ~90% drawdown from peak
    "UNITECH.NS",       # NIFTY 50 2007-2008, delisted 2020
    "RPOWER.NS",        # NIFTY 50 2008-2009, Reliance Power ~95% crash
    "JPASSOCIAT.NS",    # NIFTY 50 2008, Jaiprakash Associates, penny stock
    "RELINFRA.NS",      # NIFTY 50 2007-2009, Reliance Infra (ADAG group)
    "TATAMOTORS.NS",    # In security master but no parquet (delisting date set 2024)
    # Historical NIFTY 50 members (merged/acquired/removed)
    "HDFC.NS",          # NIFTY 50 heavyweight until 2023 merger with HDFCBANK
    "CAIRN.NS",         # NIFTY 50 ~2009-2015, merged into Vedanta
    "RANBAXY.NS",       # NIFTY 50 until ~2014, merged into Sun Pharma
    "ACC.NS",           # NIFTY 50 multiple periods, cement
    "AMBUJACEM.NS",     # NIFTY 50 multiple periods, cement
    # Historical NIFTY 50 members (still listed, just removed from index)
    "SIEMENS.NS",       # NIFTY 50 multiple periods
    "BANKBARODA.NS",    # NIFTY 50 multiple periods (Bank of Baroda)
    "INDUSINDBK.NS",    # NIFTY 50 2019-2023
    "BAJAJ-AUTO.NS",    # NIFTY 50 2009-present
    "SBILIFE.NS",       # NIFTY 50 recent periods
    "HDFCLIFE.NS",      # NIFTY 50 2019-2023
    "NESTLEIND.NS",     # NIFTY 50 recent periods
    "BRITANNIA.NS",     # NIFTY 50 recent periods
    "APOLLOHOSP.NS",    # NIFTY 50 recent periods
    "TATACONSUM.NS",    # NIFTY 50 recent (formerly Tata Global Beverages)
    "LTIM.NS",          # NIFTY 50 2022-2024 (LTIMindtree, formerly LTI+Mindtree)
    "LUPIN.NS",         # NIFTY 50 2014-2019
    "BOSCHLTD.NS",      # NIFTY 50 2015-2017
    "IDFCFIRSTB.NS",    # Former NIFTY constituent (IDFC First Bank)
    "SBICARD.NS",       # NIFTY 50 recent periods
    "WIPRO.NS",         # Already included above but ensuring completeness
    "Dixon.NS",         # Was in security master, new NIFTY entrant
    "COCHINSHIP.NS",    # Was in security master
    "POLICYBZR.NS",     # Was in security master (PB Fintech)
]

def ingest_symbol(symbol: str, force_refresh: bool = False) -> bool:
    clean_sym = symbol.replace('^', '')
    dest_path = os.path.join(DATA_DIR, f"{clean_sym}.parquet")
    
    if os.path.exists(dest_path) and not force_refresh:
        try:
            existing = pd.read_parquet(dest_path)
            if len(existing) > 500:
                print(f"[{symbol}] Already ingested: {len(existing)} bars ({existing.index.min().strftime('%Y-%m-%d')} to {existing.index.max().strftime('%Y-%m-%d')})")
                return True
        except Exception:
            pass
            
    print(f"[{symbol}] Downloading maximum history from Yahoo Finance...")
    try:
        t = yf.Ticker(symbol)
        df = t.history(period="max", auto_adjust=True)
        if df.empty or len(df) < 50:
            print(f"[{symbol}] Warning: Insufficient data returned ({len(df)} rows)")
            return False
            
        # Handle multi-index columns
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [c[0] for c in df.columns]
        df = df.loc[:, ~df.columns.duplicated()]
        
        # Standardize index to Datetime
        df.index = pd.to_datetime(df.index)
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
            
        # Ensure standard OHLCV fields
        for col in ['Open', 'High', 'Low', 'Close', 'Volume']:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
                
        # Drop rows with non-positive or NaN prices
        df = df.dropna(subset=['Open', 'High', 'Low', 'Close'])
        df = df[(df['Open'] > 0) & (df['High'] > 0) & (df['Low'] > 0) & (df['Close'] > 0)]
        df.sort_index(inplace=True)
        
        df.to_parquet(dest_path)
        print(f"[{symbol}] Ingested {len(df)} bars from {df.index.min().strftime('%Y-%m-%d')} to {df.index.max().strftime('%Y-%m-%d')}")
        return True
    except Exception as e:
        print(f"[{symbol}] Ingestion error: {e}")
        return False

def ingest_all_symbols(force_refresh: bool = False):
    print("=" * 70)
    print(f"INGESTING MAXIMUM VALID HISTORY FOR {len(ALL_SYMBOLS)} SYMBOLS")
    print("=" * 70)
    
    success_count = 0
    for sym in ALL_SYMBOLS:
        ok = ingest_symbol(sym, force_refresh=force_refresh)
        if ok:
            success_count += 1
        time.sleep(0.2)
        
    print(f"\nIngestion complete: {success_count}/{len(ALL_SYMBOLS)} symbols cached in {DATA_DIR}")

if __name__ == '__main__':
    ingest_all_symbols()
