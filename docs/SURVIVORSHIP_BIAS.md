# Point-in-Time Universe & Survivorship Bias Assessment (docs/SURVIVORSHIP_BIAS.md)

## 1. Formal Survivorship Bias Disclosure
- **Governance Status**: `SURVIVORSHIP_BIAS_STATUS = NOT_FULLY_RESOLVED`
- **Universe Construction**: Evaluates liquid Indian equities with active NSE listings over the 2021-2026 window.
- **Limitation**: Historical historical constituents that were delisted, suspended, or merged prior to 2026 are not currently captured in the historical Yahoo Finance universe. Consequently, backtest performance may exhibit survivorship bias relative to a fully point-in-time constituent tape.
- **Mitigation**:
  1. Point-in-time trailing liquidity ranking is applied to eliminate illiquid stocks at each historical decision point.
  2. All disclosures in the UI, manifest, and scorecard transparently state the survivorship limitation.

---

# Model Assumptions & Practical Limitations (docs/LIMITATIONS.md)

## 1. Operational & Quantitative Limitations
1. **Daily Bar Resolution**: Inference and backtesting operate on daily OHLCV bars. Intraday price spikes occurring between bars are modeled using conservative same-candle priority rules.
2. **Slippage Under High Volatility**: In fast-moving market regimes or during circuit limit hits, actual slippage may exceed the baseline 5 basis points.
3. **Sentiment Lookahead Prevention**: News sentiment is incorporated during live inference but set to neutral (0.0) during historical backtesting to avoid lookahead leakage from retrospective news scrapers.
4. **Capacity Constraints**: The strategy assumes an institutional capacity of up to ₹50 Crore before substantial market impact. Larger order sizes require volume-weighted execution algorithms.
