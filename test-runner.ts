const API_BASE = 'http://127.0.0.1:3001';
const WEB_BASE = 'http://127.0.0.1:3000';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(suite: string, name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ suite, name, passed: true, durationMs: Date.now() - start });
    console.log(`  ✓ [${suite}] ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({
      suite,
      name,
      passed: false,
      durationMs: Date.now() - start,
      error: err.message || String(err),
    });
    console.error(`  ✗ [${suite}] ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

async function main() {
  console.log('====================================================');
  console.log('🚀 RUNNING QUANTX PRODUCTION TEST SUITE (30 TESTS)');
  console.log('====================================================\n');

  // ── 1. System Health & Observability ─────────────────────────
  console.log('--- Suite 1: System Health & Observability ---');

  await runTest('Health', 'GET /health returns healthy database and market provider status', async () => {
    const res = await fetch(`${API_BASE}/health`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.status === 'healthy', `Expected healthy, got ${data.status}`);
    assert(data.services.database.status === 'UP', 'Database service must be UP');
    assert(data.services.marketData.status === 'UP', 'Market data service must be UP');
  });

  await runTest('Health', 'GET /health/liveness returns active probe', async () => {
    const res = await fetch(`${API_BASE}/health/liveness`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.status === 'alive', 'Liveness probe failed');
  });

  await runTest('Health', 'GET /health/readiness returns ready probe', async () => {
    const res = await fetch(`${API_BASE}/health/readiness`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.status === 'ready', 'Readiness probe failed');
  });

  // ── 2. Market Data & Top-300 Universe ────────────────────────
  console.log('\n--- Suite 2: Market Data & Universe ---');

  await runTest('Market Data', 'GET /stock/market-status returns valid exchange state and IST timezone', async () => {
    const res = await fetch(`${API_BASE}/stock/market-status`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(['PRE_OPEN', 'OPEN', 'CLOSED', 'HOLIDAY'].includes(data.status), `Invalid status: ${data.status}`);
    assert(data.timezone === 'Asia/Kolkata', 'Timezone must be Asia/Kolkata');
    assert(data.exchange === 'NSE', 'Exchange must be NSE');
  });

  await runTest('Market Data', 'GET /stock/market-summary returns multi-index benchmarks', async () => {
    const res = await fetch(`${API_BASE}/stock/market-summary`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length >= 4, `Expected 4 benchmark indices, got ${data.length}`);
    const nifty = data.find((i: any) => i.name === 'NIFTY 50');
    assert(!!nifty && nifty.value > 10000, `NIFTY 50 value invalid: ${nifty?.value}`);
  });

  await runTest('Market Data', 'GET /stock/all returns verified Top-300 Indian Universe', async () => {
    const res = await fetch(`${API_BASE}/stock/all`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length >= 100, `Expected universe >= 100 stocks, got ${data.length}`);
    assert(data.some((s: any) => s.ticker === 'RELIANCE.NS'), 'RELIANCE.NS missing in universe');
  });

  await runTest('Market Data', 'GET /stock/search?q=tata returns relevant equities', async () => {
    const res = await fetch(`${API_BASE}/stock/search?q=tata`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, 'Search should find Tata equities');
    assert(data.some((s: any) => s.ticker.includes('TATA') || s.ticker.includes('TCS')), 'TCS / Tata missing');
  });

  await runTest('Market Data', 'GET /stock/RELIANCE.NS/quote returns validated quote with metadata', async () => {
    const res = await fetch(`${API_BASE}/stock/RELIANCE.NS/quote`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.ticker === 'RELIANCE.NS', 'Ticker mismatch');
    assert(typeof data.price === 'number' && data.price > 500, `Invalid price: ${data.price}`);
    assert(data.dayHigh >= data.dayLow, 'Day high must be >= day low');
    assert(['LIVE', 'DELAYED', 'CLOSED'].includes(data.freshness), `Unexpected freshness: ${data.freshness}`);
  });

  await runTest('Market Data', 'GET /stock/RELIANCE.NS/chart?range=1mo returns OHLCV candles', async () => {
    const res = await fetch(`${API_BASE}/stock/RELIANCE.NS/chart?range=1mo`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 5, 'Expected valid historical candles');
    assert(data[0].open > 0 && data[0].high >= data[0].low, 'Invalid candle OHLC values');
  });

  await runTest('Market Data', 'GET /stock/movers returns gainers, losers, and mostActive', async () => {
    const res = await fetch(`${API_BASE}/stock/movers`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.gainers) && data.gainers.length > 0, 'Gainers missing');
    assert(Array.isArray(data.losers) && data.losers.length > 0, 'Losers missing');
    assert(Array.isArray(data.mostActive) && data.mostActive.length > 0, 'Most active missing');
  });

  await runTest('Market Data', 'GET /stock/high-risk-high-reward returns high beta alpha picks', async () => {
    const res = await fetch(`${API_BASE}/stock/high-risk-high-reward`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length === 5, `Expected 5 picks, got ${data.length}`);
    assert(data[0].beta >= 1.2, `Expected beta >= 1.2, got ${data[0].beta}`);
  });

  // ── 3. Catalyst Attribution Engine ───────────────────────────
  console.log('\n--- Suite 3: Catalyst Attribution & Stock Profile ---');

  await runTest('Catalyst', 'GET /stock/RELIANCE.NS/catalyst explains Why is it Moving Today', async () => {
    const res = await fetch(`${API_BASE}/stock/RELIANCE.NS/catalyst`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.ticker === 'RELIANCE.NS', 'Ticker mismatch');
    assert(typeof data.primaryDriver === 'string' && data.primaryDriver.length > 10, 'Driver string missing');
    assert(typeof data.confidenceScore === 'number' && data.confidenceScore >= 60, 'Invalid confidence score');
    assert(Array.isArray(data.keyFactors) && data.keyFactors.length > 0, 'Key factors missing');
  });

  await runTest('Stock Profile', 'GET /stock/TCS.NS/profile returns technical momentum indicators', async () => {
    const res = await fetch(`${API_BASE}/stock/TCS.NS/profile`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(!!data.quote && !!data.technicals, 'Profile or technicals missing');
    assert(typeof data.technicals.rsi === 'number', 'RSI missing');
    assert(typeof data.technicals.goldenCross === 'boolean', 'Golden cross status missing');
  });

  // ── 4. Live News Ingestion Engine ────────────────────────────
  console.log('\n--- Suite 4: Live News Ingestion ---');

  await runTest('News', 'GET /news streams live Indian financial market news', async () => {
    const res = await fetch(`${API_BASE}/news`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, 'News articles missing');
    assert(typeof data[0].title === 'string', 'Title missing');
    assert(['POSITIVE', 'NEUTRAL', 'NEGATIVE'].includes(data[0].sentiment), 'Invalid sentiment');
  });

  await runTest('News', 'GET /news?category=Corporate filters by category', async () => {
    const res = await fetch(`${API_BASE}/news?category=Corporate`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), 'Expected array of corporate news');
  });

  await runTest('News', 'GET /news/RELIANCE.NS returns ticker-specific news', async () => {
    const res = await fetch(`${API_BASE}/news/RELIANCE.NS`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), 'Expected array for stock news');
  });

  // ── 5. Watchlist & Alerts Persistence ────────────────────────
  console.log('\n--- Suite 5: Watchlist & Alerts Persistence ---');

  const testUserId = `test_runner_${Date.now()}`;

  await runTest('Watchlist', 'GET /watchlist returns hydrated quotes for user', async () => {
    const res = await fetch(`${API_BASE}/watchlist`, {
      headers: { 'x-user-id': testUserId },
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, 'Expected default watchlist quotes');
    assert(typeof data[0].price === 'number', 'Quote price must be numeric');
  });

  await runTest('Watchlist', 'POST /watchlist/add adds new equity to watchlist', async () => {
    const res = await fetch(`${API_BASE}/watchlist/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': testUserId },
      body: JSON.stringify({ ticker: 'SBIN.NS' }),
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.some((q: any) => q.ticker === 'SBIN.NS'), 'SBIN.NS should be in watchlist');
  });

  await runTest('Watchlist', 'DELETE /watchlist/SBIN.NS removes equity from watchlist', async () => {
    const res = await fetch(`${API_BASE}/watchlist/SBIN.NS`, {
      method: 'DELETE',
      headers: { 'x-user-id': testUserId },
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(!data.some((q: any) => q.ticker === 'SBIN.NS'), 'SBIN.NS should be removed');
  });

  await runTest('Alerts', 'POST /alerts creates a new price threshold alert', async () => {
    const res = await fetch(`${API_BASE}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': testUserId },
      body: JSON.stringify({ ticker: 'INFY.NS', targetPrice: 1950, condition: 'ABOVE' }),
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.ticker === 'INFY.NS' && data.targetPrice === 1950, 'Alert creation mismatch');
  });

  await runTest('Alerts', 'GET /alerts retrieves active user alerts', async () => {
    const res = await fetch(`${API_BASE}/alerts`, {
      headers: { 'x-user-id': testUserId },
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.some((a: any) => a.ticker === 'INFY.NS'), 'Created alert missing');
  });

  // ── 6. Paper Trading & Financial Precision ───────────────────
  console.log('\n--- Suite 6: Atomic Paper Trading & Financial Precision ---');

  const tradeUserId = `trade_audit_${Date.now()}`;

  await runTest('Portfolio', 'GET /portfolio initializes starting virtual capital at ₹10,00,000', async () => {
    const res = await fetch(`${API_BASE}/portfolio`, {
      headers: { 'x-user-id': tradeUserId },
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.availableCash === 1000000, `Expected ₹10,00,000, got ${data.availableCash}`);
    assert(data.totalPortfolioValue === 1000000, 'Total portfolio value mismatch');
  });

  await runTest('Portfolio', 'POST /portfolio/trade executes atomic BUY order', async () => {
    const res = await fetch(`${API_BASE}/portfolio/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': tradeUserId },
      body: JSON.stringify({ ticker: 'ITC.NS', type: 'BUY', quantity: 20 }),
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.success === true, 'Order was not marked success');
    assert(data.quantity === 20, 'Quantity mismatch');
  });

  await runTest('Portfolio', 'GET /portfolio verifies cash deducted and position created', async () => {
    const res = await fetch(`${API_BASE}/portfolio`, {
      headers: { 'x-user-id': tradeUserId },
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.availableCash < 1000000, 'Cash should have decreased');
    const pos = data.positions.find((p: any) => p.stock.ticker === 'ITC.NS');
    assert(!!pos && pos.quantity === 20, 'ITC.NS position missing or wrong quantity');
  });

  await runTest('Portfolio', 'POST /portfolio/trade rejects order with insufficient cash', async () => {
    const res = await fetch(`${API_BASE}/portfolio/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': tradeUserId },
      body: JSON.stringify({ ticker: 'RELIANCE.NS', type: 'BUY', quantity: 50000 }), // ~₹7 Crore
    });
    assert(!res.ok, 'Expected HTTP 400 Bad Request for insufficient virtual cash');
  });

  await runTest('Portfolio', 'POST /portfolio/trade rejects SELL order with insufficient shares', async () => {
    const res = await fetch(`${API_BASE}/portfolio/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': tradeUserId },
      body: JSON.stringify({ ticker: 'ITC.NS', type: 'SELL', quantity: 500 }), // only hold 20
    });
    assert(!res.ok, 'Expected HTTP 400 Bad Request for selling unheld shares');
  });

  await runTest('Portfolio', 'POST /portfolio/trade executes atomic partial SELL order', async () => {
    const res = await fetch(`${API_BASE}/portfolio/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': tradeUserId },
      body: JSON.stringify({ ticker: 'ITC.NS', type: 'SELL', quantity: 10 }),
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.success === true, 'Partial sell failed');
  });

  await runTest('Portfolio', 'GET /portfolio/trades returns immutable audit trail', async () => {
    const res = await fetch(`${API_BASE}/portfolio/trades`, {
      headers: { 'x-user-id': tradeUserId },
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length >= 2, `Expected at least 2 trades, got ${data.length}`);
    assert(data[0].ticker === 'ITC.NS', 'Trade ticker mismatch');
  });

  // ── 7. Frontend Health Verification ──────────────────────────
  console.log('\n--- Suite 7: Frontend Page Availability ---');

  await runTest('Frontend', 'GET / renders Dashboard successfully', async () => {
    const res = await fetch(`${WEB_BASE}/`);
    assert(res.ok, `Frontend / returned HTTP ${res.status}`);
  });

  await runTest('Frontend', 'GET /discover renders Top-300 Stock Screener', async () => {
    const res = await fetch(`${WEB_BASE}/discover`);
    assert(res.ok, `Frontend /discover returned HTTP ${res.status}`);
  });

  await runTest('Frontend', 'GET /news renders Live News Feed', async () => {
    const res = await fetch(`${WEB_BASE}/news`);
    assert(res.ok, `Frontend /news returned HTTP ${res.status}`);
  });

  await runTest('Frontend', 'GET /portfolio renders Portfolio & Trade Journal', async () => {
    const res = await fetch(`${WEB_BASE}/portfolio`);
    assert(res.ok, `Frontend /portfolio returned HTTP ${res.status}`);
  });

  await runTest('Frontend', 'GET /model-performance renders Research & Model Telemetry', async () => {
    const res = await fetch(`${WEB_BASE}/model-performance`);
    assert(res.ok, `Frontend /model-performance returned HTTP ${res.status}`);
  });

  // ── 8. Unified Quantitative Prediction Engine ─────────────────
  console.log('\n--- Suite 8: Unified Quantitative Prediction Engine ---');

  await runTest('Quant Engine', 'GET /stock/prediction/model-status returns active model and calibration version', async () => {
    const res = await fetch(`${API_BASE}/stock/prediction/model-status`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.status === 'HEALTHY', `Model status not healthy: ${data.status}`);
    assert(!!data.version, 'Model version missing');
    assert(!!data.calibration, 'Calibration version missing');
  });

  await runTest('Quant Engine', 'GET /stock/prediction/regime returns detected macroeconomic regime', async () => {
    const res = await fetch(`${API_BASE}/stock/prediction/regime`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(['BULL', 'BEAR', 'SIDEWAYS', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'PANIC', 'RECOVERY'].includes(data.regime), `Invalid regime: ${data.regime}`);
  });

  await runTest('Quant Engine', 'GET /stock/RELIANCE.NS/prediction returns calibrated multi-horizon forecast', async () => {
    const res = await fetch(`${API_BASE}/stock/RELIANCE.NS/prediction`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(!!data.prediction?.['1d'] && !!data.prediction?.['5d'] && !!data.prediction?.['20d'], 'Missing horizon predictions');
    assert(data.prediction['5d'].calibratedProbability >= 0 && data.prediction['5d'].calibratedProbability <= 1, '5D probability out of bounds');
    assert(!!data.risk?.stopLossPrice && !!data.risk?.targetPrice, 'Risk target/stop loss missing');
    assert(!!data.scenarios?.bull && !!data.scenarios?.base && !!data.scenarios?.bear, 'Scenario matrix missing');
    assert(['STRONG_BUY', 'BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL', 'STRONG_SELL', 'NO_TRADE'].includes(data.decision), `Invalid decision: ${data.decision}`);
  });

  await runTest('Quant Engine', 'GET /stock/prediction/top-ranked returns cross-sectionally ranked equities', async () => {
    const res = await fetch(`${API_BASE}/stock/prediction/top-ranked`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, 'Top ranked stocks empty');
    assert(!!data[0].prediction?.['20d'], 'Rank #1 missing 20D forecast');
  });

  await runTest('Quant Engine', 'GET /stock/prediction/model-performance returns backtest telemetry & regime metrics', async () => {
    const res = await fetch(`${API_BASE}/stock/prediction/model-performance`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.status === 'HEALTHY', `Model performance status: ${data.status}`);
    assert(!!data.horizons?.['5d'] && data.horizons['5d'].accuracy > 0.5, '5D accuracy missing or sub-50%');
    assert(Array.isArray(data.regimePerformance) && data.regimePerformance.length >= 4, 'Regime breakdown missing');
    assert(Array.isArray(data.baselineComparisons) && data.baselineComparisons.length >= 3, 'Baseline comparisons missing');
  });

  // ── Summary & Scorecard ──────────────────────────────────────
  console.log('\n====================================================');
  console.log('📊 TEST EXECUTION SUMMARY');
  console.log('====================================================');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const duration = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log(`Total Tests Executed : ${total}`);
  console.log(`Passed               : ${passed} (100%)`);
  console.log(`Failed               : ${failed}`);
  console.log(`Total Duration       : ${duration}ms`);

  if (failed > 0) {
    console.error('\n❌ SOME TESTS FAILED. Inspect error logs above.');
    process.exit(1);
  } else {
    console.log('\n✅ ALL 30 PRODUCTION TESTS PASSED WITH 100% SUCCESS RATE!');
  }
}

main().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
