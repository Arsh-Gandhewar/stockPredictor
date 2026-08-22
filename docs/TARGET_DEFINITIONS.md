# Multi-Horizon Target Formulations (docs/TARGET_DEFINITIONS.md)

## 1. Target Definition
QuantX formulates directional probability targets net of round-trip institutional transaction friction:

For horizon $h \in \{1\text{d}, 5\text{d}, 20\text{d}\}$:
\[
y_{t, h} = \begin{cases}
1 & \text{if } \text{Gross Return}_{t, t+h} - c_{\text{round-trip}} > 0 \\
0 & \text{otherwise}
\end{cases}
\]
where $c_{\text{round-trip}} = 0.0013$ (13 basis points).

## 2. Horizon Specializations
- **1-Day Horizon (`1d`)**: Predicts next-day net positive drift. Captures short-term momentum continuation and intraday liquidity imbalances.
- **5-Day Horizon (`5d`)**: Primary swing horizon (Recommended). Aligns with short-term mean-reversion and multi-day breakout setups.
- **20-Day Horizon (`20d`)**: Position horizon. Models monthly trend persistence, earnings drifts, and structural institutional accumulation.

Three independent LightGBM gradient-boosted classifier models are trained (`model_1d.onnx`, `model_5d.onnx`, `model_20d.onnx`), avoiding cross-horizon target leakage.
