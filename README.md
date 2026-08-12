# QuantX — Indian Equity Research & Paper-Trading Platform

**QuantX** is an Indian stock-market research, AI analysis, market monitoring, and atomic paper-trading platform built for the National Stock Exchange (NSE).

---

## 🏛 Architecture Overview

```
QuantX Platform
├── apps/
│   ├── api/                 # NestJS 11 Backend (Node.js / TypeScript)
│   │   ├── common/          # Money arithmetic, Guards, DTOs, Filters, Interceptors
│   │   ├── modules/         # Stock, News, Portfolio, Watchlist, Alerts, Health, AI
│   │   └── prisma/          # PostgreSQL schema & migrations
│   └── web/                 # Next.js 15 App Router Frontend (React / Tailwind / Lightweight-Charts)
│       ├── src/app/         # Dashboard, Discover (Screener), News, Portfolio, Stock Details
│       ├── src/components/  # UI design system
│       └── src/hooks/       # React Query streaming hooks (5s live quotes)
└── test-runner.ts           # 32-test end-to-end integration test suite
```

---

## ⚡ Key Production Capabilities

1. **Financial Precision Engine**: Strict 2-decimal paise precision across all trade turnover, cash balances, and unrealized/realized P&L calculations (`Money` utility).
2. **Atomic Paper Trading**: Powered by PostgreSQL transactions (`$transaction`), preventing race conditions, negative cash balances, and unheld share sales.
3. **Market Data Provider Abstraction**: Modular `MarketDataProvider` architecture with real IST trading session hours (`PRE_OPEN`, `OPEN`, `CLOSED`) and OHLC anomaly rejection.
4. **Top-300 Indian Universe**: Categorized database of 300 Indian equities (Large, Mid, Small-cap) across Sectors and Industries.
5. **"Why is this Stock Moving Today?"**: Quantitative catalyst synthesis analyzing volume surge ratios, institutional accumulation, delivery action, and invalidation levels.
6. **Live Market News Feed**: Real-time Indian financial RSS parser with sentiment classification and stock tagging.
7. **Security & Observability**: OWASP Helmet headers, rate limiting (120 req/min), Request ID tracing, Global Exception Filter, and `/health` Kubernetes readiness/liveness probes.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js 18+
- PostgreSQL database
- npm / npx

### 2. Environment Configuration
Create a root `.env` file:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/quantx?schema=public"
PORT=3001
NEXT_PUBLIC_API_URL="http://127.0.0.1:3001"
```

### 3. Install & Migrate Database
```bash
npm install
cd apps/api && npx prisma migrate deploy && npx prisma generate
```

### 4. Running the Development Servers
```bash
# Terminal 1: Backend API (Port 3001)
cd apps/api
npm run start:dev

# Terminal 2: Frontend Web App (Port 3000)
cd apps/web
npm run dev
```

### 5. Running the 32-Test Automated Verification Suite
```bash
npx tsx test-runner.ts
```

---

## 🛡 Verification & Production Audit

- **Integration Tests**: 32 / 32 Passed (100%)
- **Backend Build**: `nest build` completed cleanly
- **Frontend Build**: `next build --turbopack` 11/11 pages compiled
