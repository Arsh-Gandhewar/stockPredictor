# QuantX MCP Server

Production-grade Model Context Protocol (MCP) server for the **QuantX Quantitative Trading & Research Platform**.

The QuantX MCP Server exposes QuantX's quantitative research, multi-horizon return predictions, cross-sectional opportunity rankings, risk management, and paper trading capabilities as standardized MCP tools and resources. MCP-compatible AI clients (such as Claude Desktop, Cursor, or custom LLM agents) can interact with QuantX programmatically while ensuring full adherence to quantitative rigor, user isolation, and execution safety.

---

## 1. Architectural Principles

```
  ┌─────────────────────────────────────────────────────────────┐
  │                 MCP AI Client (e.g. Claude)                 │
  └──────────────────────────────┬──────────────────────────────┘
                                 │ STDIO (JSON-RPC 2.0)
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                      QuantX MCP Server                      │
  │  ┌────────────────────────┐     ┌────────────────────────┐  │
  │  │  STDOUT Protection     │     │ Zod Schema Validation  │  │
  │  │  (Logs strictly STDERR)│     │ & Input Sanitization   │  │
  │  └────────────────────────┘     └────────────────────────┘  │
  │  ┌────────────────────────┐     ┌────────────────────────┐  │
  │  │  Role & IDOR Guard     │     │ Rate & Concurrency     │  │
  │  │  (User-Scoped Context) │     │ Token Limiter          │  │
  │  └────────────────────────┘     └────────────────────────┘  │
  └──────────────────────────────┬──────────────────────────────┘
                                 │ HTTP (Authenticated REST)
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │               QuantX Core Backend Gateway                   │
  │      StockService | QuantPredictionService | Portfolio      │
  │      RiskGuardian | NewsService | ModelScorecard            │
  └─────────────────────────────────────────────────────────────┘
```

- **Adapter Over Truth**: The MCP server is strictly an interface adapter. All mathematical algorithms, LightGBM models, calibration knots, portfolio metrics, and transaction friction rules remain inside the QuantX backend.
- **Zero Duplicate Quant Logic**: No duplicate RSI, Sharpe, Sortino, or EV calculations. One business rule = one authoritative implementation.
- **Fail-Closed Semantics**: Missing data returns explicit `status: "INSUFFICIENT_DATA"` with `null` fields. No fake percentages or synthetic defaults.
- **STDOUT Invariant**: Standard Output (`stdout`) is reserved exclusively for MCP JSON-RPC protocol traffic. All diagnostic, informational, debug, and error messages write strictly to `stderr`.

---

## 2. Supported Versions

- **Node.js**: `>= 20.0.0` (Tested on Node v22.18.0)
- **TypeScript**: `^5.7.3`
- **Model Context Protocol SDK**: `@modelcontextprotocol/sdk ^1.6.0`
- **Zod**: `^3.24.2`

---

## 3. Environment Variables

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `QUANTX_API_URL` | **Yes** | — | URL pointing to the QuantX API Gateway (e.g. `http://127.0.0.1:3001`). Validated at startup. |
| `QUANTX_API_KEY` | **Yes** | — | Secret API key for backend service authentication. |
| `MCP_SERVER_NAME` | No | `quantx-mcp` | MCP server identification name. |
| `MCP_SERVER_VERSION` | No | `1.0.0` | MCP server release version. |
| `MCP_LOG_LEVEL` | No | `info` | Log verbosity (`debug`, `info`, `warn`, `error`). Logs output strictly to `stderr`. |
| `MCP_REQUEST_TIMEOUT_MS` | No | `10000` | Timeout in milliseconds for upstream QuantX requests (default: 10 seconds). |
| `MCP_AUTH_USER_ID` | No | `default_user` | Default user identity for authenticated paper trading sessions. |

*Note: Startup fails immediately with exit code 1 if `QUANTX_API_URL` or `QUANTX_API_KEY` are missing or malformed.*

---

## 4. MCP Tools Reference

The server exposes 13 action-level tools with strict input schemas:

| Tool Name | Purpose | Read/Write | Required Role | Rate Limit |
| :--- | :--- | :---: | :---: | :---: |
| `quantx_get_stock` | Retrieves live market quote, price, day change, volume, and optional quantitative prediction & risk. | Read | `PUBLIC_READ` | 60/min |
| `quantx_search_stocks` | Searches universe by symbol or name with optional sector filter (capped at 50). | Read | `PUBLIC_READ` | 30/min |
| `quantx_get_opportunities` | Returns top cross-sectionally ranked opportunities from QuantX LightGBM expected value model. | Read | `AUTHENTICATED_READ` | 20/min |
| `quantx_analyze_stock` | Comprehensive multi-factor deep dive (probability, scenarios, regime, RSI/MACD, invalidations). | Read | `AUTHENTICATED_READ` | 20/min |
| `quantx_model_performance` | Institutional walk-forward backtest metrics, Brier scores, Sharpe, Sortino, and governance scorecard. | Read | `PUBLIC_READ` | 30/min |
| `quantx_get_portfolio` | User's live paper trading portfolio balance, current holdings, gross exposure, and P&L. | Read | `AUTHENTICATED_READ` | 60/min |
| `quantx_get_position_risk` | Position-specific risk evaluation against active stop loss, target, downside probability, and regime. | Read | `AUTHENTICATED_READ` | 30/min |
| `quantx_risk_guardian` | Scans portfolio positions for multi-dimensional exit triggers, stop breaches, and regime warnings. Read-only. | Read | `AUTHENTICATED_READ` | 20/min |
| `quantx_get_stock_sentiment` | Aggregated financial news sentiment and sanitized headlines for a given stock ticker. | Read | `PUBLIC_READ` | 30/min |
| `quantx_run_backtest` | Runs controlled historical backtest simulation with strict date boundaries and transaction costs. | Read | `ADMIN` | 5/min |
| `quantx_paper_buy` | Executes simulated paper trading BUY order. Requires `idempotencyKey` to prevent duplicate execution. | Write | `PAPER_TRADING` | 10/min |
| `quantx_paper_sell` | Executes simulated paper trading SELL order. Requires `idempotencyKey` to prevent duplicate execution. | Write | `PAPER_TRADING` | 10/min |
| `quantx_health` | Health and connectivity check for MCP server, QuantX backend, database, and active model artifact. | Read | `PUBLIC_READ` | 120/min |

---

## 5. MCP Resources Reference

| Resource URI | Description | Freshness Window | Stale Disclosure |
| :--- | :--- | :---: | :---: |
| `quantx://market/status` | Real-time market status, trading session state, and benchmark index quotes. | 60 seconds | Yes (`staleAfter`) |
| `quantx://portfolio` | Authenticated user portfolio valuations, cash balance, and concentration metrics. | 15 seconds | Yes (`staleAfter`) |
| `quantx://model/current` | Active LightGBM model status, governance scorecard, and calibration validation. | 300 seconds | Yes (`staleAfter`) |
| `quantx://model/performance` | Summary of out-of-sample walk-forward backtest metrics, CAGR, and Sharpe ratio. | 3600 seconds | Yes (`staleAfter`) |
| `quantx://risk/current` | Real-time market regime classification (Bull Trend, Sideways, Panic, etc.) and risk posture. | 60 seconds | Yes (`staleAfter`) |

---

## 6. Security & Governance Invariants

1. **User Isolation (Anti-IDOR)**:
   - For all portfolio operations, user identity is extracted strictly from the authenticated context.
   - Non-admin callers cannot access or inspect portfolios belonging to other users.
2. **Idempotency on Write Operations**:
   - Both `quantx_paper_buy` and `quantx_paper_sell` require a unique `idempotencyKey` (8–128 characters).
   - Duplicate calls with the same key return the previous execution result without executing twice.
3. **No Arbitrary Execution**:
   - Zero arbitrary shell commands (`exec`, `spawn`).
   - Zero arbitrary SQL (`run_sql` or raw DB queries).
   - Zero arbitrary URL fetching or file reading.
4. **Prompt Injection Resistance**:
   - News headlines and external descriptions are sanitized to prevent prompt-override attacks.
5. **Standard Error Contract**:
   - Internal stack traces and database credentials are never leaked to the client. Errors map to:
     `INVALID_INPUT`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `STALE_DATA`, `INSUFFICIENT_DATA`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `TIMEOUT`, `CONFLICT`, `INTERNAL_ERROR`.

---

## 7. Developer & Client Setup

### Installation & Build

```bash
# From repository root
npm run mcp:build

# Or directly in apps/mcp-server
cd apps/mcp-server
npm install
npm run build
```

### Running Tests

```bash
# Run unit, security, error translation, and protocol subprocess tests
npm run mcp:test
```

### Starting the Server

```bash
# Development mode (with tsx live execution)
npm run mcp:dev

# Production mode
npm run mcp:start
```

---

## 8. Client Configuration Examples

### Claude Desktop Configuration (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "quantx": {
      "command": "node",
      "args": [
        "C:\\Users\\arshg\\OneDrive\\Desktop\\stockPredictor\\apps\\mcp-server\\dist\\index.js"
      ],
      "env": {
        "QUANTX_API_URL": "http://127.0.0.1:3001",
        "QUANTX_API_KEY": "YOUR_QUANTX_API_KEY",
        "MCP_LOG_LEVEL": "info",
        "MCP_AUTH_USER_ID": "default_user"
      }
    }
  }
}
```

### Cursor IDE Configuration (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "quantx": {
      "command": "node",
      "args": ["./apps/mcp-server/dist/index.js"],
      "env": {
        "QUANTX_API_URL": "http://127.0.0.1:3001",
        "QUANTX_API_KEY": "YOUR_QUANTX_API_KEY"
      }
    }
  }
}
```

---

## 9. Example Tool Response

### `quantx_analyze_stock`
```json
{
  "ticker": "TCS.NS",
  "companyName": "Tata Consultancy Services",
  "currentPrice": 3500.5,
  "marketRegime": "BULL_TREND",
  "horizon": "20d",
  "decision": "BUY",
  "signalQuality": "HIGH",
  "dataQuality": "HIGH",
  "prediction": {
    "calibratedProbability": 0.72,
    "expectedReturn": 0.058,
    "expectedValue": 0.041,
    "confidenceInterval": [0.012, 0.095]
  },
  "scenarios": {
    "bull": { "targetPrice": 3750.0, "expectedReturn": 7.1 },
    "base": { "targetPrice": 3580.0, "expectedReturn": 2.3 },
    "bear": { "targetPrice": 3380.0, "expectedReturn": -3.4 }
  },
  "risk": {
    "stopLossPrice": 3400.0,
    "targetPrice": 3700.0,
    "rewardRiskRatio": 2.0,
    "downsideProbability": 0.32,
    "compositeRiskScore": 35,
    "riskState": "NORMAL"
  },
  "technicals": {
    "rsi": 58.4,
    "rsiStance": "Neutral Momentum Zone",
    "macdTrend": "Bullish Crossover",
    "goldenCross": true
  },
  "invalidationConditions": [
    "Stop loss hit at 3400.00",
    "Market regime shifts to BEAR_TREND"
  ],
  "modelVersion": "5.0.0",
  "timestamp": "2026-08-27T21:30:00.000Z",
  "dataStatus": "AVAILABLE"
}
```
