# Feature Engineering Methodology (docs/FEATURE_METHODOLOGY.md)

## 1. 25 Multi-Factor Point-in-Time Features
All features at prediction timestamp $t$ are derived exclusively using candles at or before $t$:

| Feature Key | Category | Formula / Lookback | Description |
|---|---|---|---|
| `rsi_14` | Momentum | 14-day Wilder RSI | Overbought / oversold oscillator |
| `macd_hist` | Momentum | $(EMA_{12} - EMA_{26}) - EMA_9$ normalized by Close | Moving average convergence divergence |
| `sma_20_dist` | Trend | $(Close - SMA_{20}) / SMA_{20}$ | 20-day mean distance |
| `sma_50_dist` | Trend | $(Close - SMA_{50}) / SMA_{50}$ | 50-day structural trend distance |
| `ema_20_dist` | Trend | $(Close - EMA_{20}) / EMA_{20}$ | 20-day exponential trend distance |
| `atr_percent` | Volatility | $ATR_{14} / Close$ | Average true range normalized volatility |
| `bb_width` | Volatility | $(Upper_{20} - Lower_{20}) / SMA_{20}$ | Bollinger band volatility width |
| `stoch_k` | Momentum | $100 \times (Close - Low_{14}) / (High_{14} - Low_{14})$ | 14-day Stochastic %K |
| `volume_z_score` | Liquidity | $(Vol - \mu_{Vol, 20}) / \sigma_{Vol, 20}$ | Normalized 20-day volume Z-score |
| `annualized_volatility` | Volatility | $\sigma_{returns, 20} \times \sqrt{252}$ | 20-day annualized realized volatility |
| `downside_deviation` | Risk | $\sigma_{negative\_returns, 20} \times \sqrt{252}$ | Downside semivariance |
| `beta_nifty` | Benchmark | $Cov(r_{stock}, r_{nifty}) / Var(r_{nifty})$ (60d) | Systematic market exposure |
| `relative_strength_nifty`| Benchmark | $r_{stock, 20d} - r_{nifty, 20d}$ | 20-day alpha vs Nifty 50 |
| `momentum_5` | Momentum | $Close_t / Close_{t-5} - 1$ | 5-day price return |
| `momentum_20` | Momentum | $Close_t / Close_{t-20} - 1$ | 20-day price return |
| `ret_1d` | Price Action | $Close_t / Close_{t-1} - 1$ | 1-day return |
| `ret_5d` | Price Action | $Close_t / Close_{t-5} - 1$ | 5-day return |
| `ret_20d` | Price Action | $Close_t / Close_{t-20} - 1$ | 20-day return |
| `gap_pct` | Price Action | $(Open_t - Close_{t-1}) / Close_{t-1}$ | Overnight opening gap percentage |
| `dist_52w_high` | Range | $Close_t / Max_{252}(High) - 1$ | Proximity to 52-week high |
| `dist_52w_low` | Range | $Close_t / Min_{252}(Low) - 1$ | Proximity to 52-week low |
| `roc_12` | Momentum | $(Close_t - Close_{t-12}) / Close_{t-12} \times 100$ | 12-day Rate of Change |
| `rel_volume` | Liquidity | $Vol_t / SMA_{20}(Vol)$ | Relative volume expansion |
| `vol_20d` | Volatility | 20-day rolling standard deviation | Short-term volatility |
| `vol_60d` | Volatility | 60-day rolling standard deviation | Medium-term volatility |

## 2. Invariant Sanitization
- All `NaN`, `null`, and infinite values are replaced with neutral values before tensor creation (`50.0` for RSI/Stochastics, `0.0` for returns/distances).
- Feature calculation functions operate on immutably copied slices of past historical candles.
