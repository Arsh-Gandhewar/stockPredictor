import pandas as pd

def detect_regime(nifty_df, vix_df):
    df = nifty_df.copy()
    df['sma_200'] = df['Close'].rolling(200).mean()
    
    regimes = []
    for i in range(len(df)):
        if pd.isna(df['sma_200'].iloc[i]):
            regimes.append("UNKNOWN")
        elif df['Close'].iloc[i] > df['sma_200'].iloc[i]:
            regimes.append("BULL")
        else:
            regimes.append("BEAR")
            
    df['regime'] = regimes
    return df[['Close', 'regime']]
