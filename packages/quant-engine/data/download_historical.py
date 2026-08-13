import yfinance as yf
import pandas as pd
import os, time
import sys

# Ensure universe can be imported
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from universe import UNIVERSE, INDICES

DATA_DIR = os.path.join(os.path.dirname(__file__), 'historical')

def download_data():
    os.makedirs(DATA_DIR, exist_ok=True)
    tickers = [s["ticker"] for s in UNIVERSE] + list(INDICES.values())
    
    for ticker in tickers:
        print(f"Downloading {ticker}...")
        try:
            df = yf.download(ticker, period="5y", progress=False)
            if not df.empty:
                # Handle multi-index columns from newer yfinance
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = [c[0] for c in df.columns]
                # Ensure no duplicated columns
                df = df.loc[:, ~df.columns.duplicated()]
                df.to_parquet(os.path.join(DATA_DIR, f"{ticker.replace('^', '')}.parquet"))
            time.sleep(0.5) # Rate limit
        except Exception as e:
            print(f"Failed {ticker}: {e}")

if __name__ == "__main__":
    download_data()
