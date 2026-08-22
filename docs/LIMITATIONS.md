# Model Assumptions & Practical Limitations (docs/LIMITATIONS.md)

## 1. Operational & Quantitative Limitations
1. **Daily Bar Resolution**: Inference and backtesting operate on daily OHLCV bars. Intraday price spikes occurring between bars are modeled using conservative same-candle priority rules.
2. **Slippage Under High Volatility**: In fast-moving market regimes or during circuit limit hits, actual slippage may exceed the baseline 5 basis points.
3. **Sentiment Lookahead Prevention**: News sentiment is incorporated during live inference but set to neutral (0.0) during historical backtesting to avoid lookahead leakage from retrospective news scrapers.
4. **Capacity Constraints**: The strategy assumes an institutional capacity of up to ₹50 Crore before substantial market impact. Larger order sizes require volume-weighted execution algorithms.
