import { fetcher } from './apps/web/src/lib/api';

const API_BASE = 'http://127.0.0.1:3001';
const WEB_BASE = 'http://127.0.0.1:3000';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: any;
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
  console.log('🚀 RUNNING COMPREHENSIVE AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  // ── 1. Backend Market Data API Tests ─────────────────────────
  console.log('--- Suite 1: Market Data & Quotes ---');

  await runTest('Market Data', 'GET /stock/market-status returns valid exchange state', async () => {
    const res = await fetch(`${API_BASE}/stock/market-status`);
    assert(res.ok, `Status HTTP ${res.status}`);
    const data = await res.json();
    assert(['PRE_OPEN', 'OPEN', 'CLOSED', 'HOLIDAY'].includes(data.status), `Invalid status: ${data.status}`);
    assert(data.timezone === 'Asia/Kolkata', `Timezone must be Asia/Kolkata`);
    assert(data.exchange === 'NSE', `Exchange must be NSE`);
  });

  await runTest('Market Data', 'GET /stock/market-summary returns multi-index benchmarks', async () => {
    const res = await fetch(`${API_BASE}/stock/market-summary`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), 'Expected array of indices');
    assert(data.length >= 2, `Expected at least 2 indices, got ${data.length}`);
    const nifty = data.find((i: any) => i.name === 'NIFTY 50');
    assert(!!nifty, 'NIFTY 50 index missing');
    assert(typeof nifty.value === 'number' && nifty.value > 0, `NIFTY value invalid: ${nifty.value}`);
  });

  await runTest('Market Data', 'GET /stock/movers returns gainers, losers, and mostActive', async () => {
    const res = await fetch(`${API_BASE}/stock/movers`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data.gainers) && data.gainers.length > 0, 'Gainers list missing');
    assert(Array.isArray(data.losers) && data.losers.length > 0, 'Losers list missing');
    assert(Array.isArray(data.mostActive) && data.mostActive.length > 0, 'MostActive list missing');
    assert(typeof data.gainers[0].price === 'number', 'Price must be numeric');
  });

  await runTest('Market Data', 'GET /stock/all returns NIFTY 50 universe', async () => {
    const res = await fetch(`${API_BASE}/stock/all`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), 'Expected array of stocks');
    assert(data.length >= 45, `Expected >= 45 stocks, got ${data.length}`);
  });

  await runTest('Market Data', 'GET /stock/search?q=HDFC finds matching equities', async () => {
    const res = await fetch(`${API_BASE}/stock/search?q=HDFC`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data) && data.length > 0, 'Search should return HDFC stocks');
    assert(data.some((s: any) => s.ticker.includes('HDFC')), 'HDFCBANK.NS missing in results');
  });

  await runTest('Market Data', 'GET /stock/RELIANCE.NS/quote returns live quote with metadata', async () => {
    const res = await fetch(`${API_BASE}/stock/RELIANCE.NS/quote`);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.ticker === 'RELIANCE.NS', 'Ticker mismatch');
    assert(typeof data.price === 'number' && data.price > 500 && data.price < 5000, `Unexpected price: ${data.price}`);
    assert(typeof data.dayHigh === 'number', 'dayHigh missing');
    assert(typeof data.dayLow === 'number', 'dayLow missing');
    assert(['LIVE', 'DELAYED', 'STALE', 'CLOSED'].includes(data.freshness), `Invalid freshness: ${data.freshness}`);
  });

  await runTest('Market Data', 'GET /stock/UNKNOWN_9999.NS/quote returns 404', async () => {
    const res = await fetch(`${API_BASE}/stock/UNKNOWN_9999.NS/quote`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await runTest('Market Data', 'GET /stock/RELIANCE.NS/chart returns OHLC candles across ranges', async () => {
    for (const range of ['1mo', '6mo', '1y']) {
      const res = await fetch(`${API_BASE}/stock/RELIANCE.NS/chart?range=${range}`);
      assert(res.ok, `HTTP ${res.status} for range ${range}`);
      const candles = await res.json();
      assert(Array.isArray(candles) && candles.length > 5, `Expected > 5 candles for ${range}, got ${candles.length}`);
      const first = candles[0];
      assert(typeof first.open === 'number', 'open missing');
      assert(typeof first.high === 'number', 'high missing');
      assert(typeof first.low === 'number', 'low missing');
      assert(typeof first.close === 'number', 'close missing');
      assert(first.high >= first.low, 'High must be >= low');
    }
  });

  // ── 2. Paper Trading & Portfolio Tests ───────────────────────
  console.log('\n--- Suite 2: Paper Trading & Portfolio Engine ---');

  const testUserId = `test_user_${Date.now()}`;

  await runTest('Portfolio', 'GET /portfolio creates/fetches default portfolio with cash', async () => {
    const res = await fetch(`${API_BASE}/portfolio`, {
      headers: { 'x-user-id': testUserId },
    });
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.userId === testUserId, 'userId mismatch');
    assert(data.availableCash === 1000000, `Expected default ₹10,00,000 cash, got ${data.availableCash}`);
  });

  await runTest('Portfolio', 'POST /portfolio/trade executes BUY order and updates cash & position', async () => {
    const buyPayload = {
      ticker: 'TCS.NS',
      type: 'BUY',
      quantity: 5,
      userId: testUserId,
    };

    const res = await fetch(`${API_BASE}/portfolio/trade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': testUserId,
      },
      body: JSON.stringify(buyPayload),
    });

    assert(res.ok, `Trade HTTP ${res.status}`);
    const tradeRes = await res.json();
    assert(tradeRes.success === true, 'Trade should report success');
    assert(tradeRes.availableCash < 1000000, 'Cash should be deducted after buy');

    // Verify portfolio reflects position
    const portRes = await fetch(`${API_BASE}/portfolio`, {
      headers: { 'x-user-id': testUserId },
    });
    const portData = await portRes.json();
    const position = portData.positions.find((p: any) => p.stock?.ticker === 'TCS.NS' || p.stockId);
    assert(!!position, 'Position for TCS.NS should exist in portfolio');
    assert(position.quantity === 5, `Expected 5 shares, got ${position.quantity}`);
  });

  await runTest('Portfolio', 'POST /portfolio/trade executes SELL order and credits cash', async () => {
    const sellPayload = {
      ticker: 'TCS.NS',
      type: 'SELL',
      quantity: 2,
      userId: testUserId,
    };

    const res = await fetch(`${API_BASE}/portfolio/trade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': testUserId,
      },
      body: JSON.stringify(sellPayload),
    });

    assert(res.ok, `Trade HTTP ${res.status}`);

    // Verify position reduced to 3
    const portRes = await fetch(`${API_BASE}/portfolio`, {
      headers: { 'x-user-id': testUserId },
    });
    const portData = await portRes.json();
    const position = portData.positions.find((p: any) => p.stock?.ticker === 'TCS.NS' || p.stockId);
    assert(position?.quantity === 3, `Expected remaining 3 shares, got ${position?.quantity}`);
  });

  await runTest('Portfolio', 'POST /portfolio/trade rejects selling more shares than held', async () => {
    const invalidSell = {
      ticker: 'TCS.NS',
      type: 'SELL',
      quantity: 1000, // holds only 3
      userId: testUserId,
    };

    const res = await fetch(`${API_BASE}/portfolio/trade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': testUserId,
      },
      body: JSON.stringify(invalidSell),
    });

    assert(res.status >= 400, `Expected error status for overselling, got ${res.status}`);
  });

  await runTest('Portfolio', 'GET /portfolio/sell-signals executes AI risk guardian evaluation', async () => {
    const res = await fetch(`${API_BASE}/portfolio/sell-signals`, {
      headers: { 'x-user-id': testUserId },
    });
    assert(res.ok, `HTTP ${res.status}`);
    const signals = await res.json();
    assert(Array.isArray(signals), 'Sell signals must be an array');
  });

  // ── 3. Frontend Web Route Health Checks ──────────────────────
  console.log('\n--- Suite 3: Frontend Routes & Rendering ---');

  const webRoutes = [
    '/',
    '/discover',
    '/markets',
    '/watchlist',
    '/portfolio',
    '/news',
    '/alerts',
    '/settings',
    '/stock/RELIANCE.NS',
    '/stock/TCS.NS',
    '/stock/INFY.NS',
  ];

  for (const route of webRoutes) {
    await runTest('Web Routes', `GET ${route} returns HTTP 200`, async () => {
      const res = await fetch(`${WEB_BASE}${route}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const html = await res.text();
      assert(html.length > 500, `HTML payload too short (${html.length} bytes)`);
      assert(!html.includes('Internal Server Error'), 'Page contains 500 error string');
    });
  }

  // ── Summary Report ───────────────────────────────────────────
  console.log('\n====================================================');
  console.log('📊 AUTOMATION TEST RESULTS SUMMARY');
  console.log('====================================================');

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log(`Total Tests Run: ${results.length}`);
  console.log(`Passed:          ${passedCount} ✅`);
  console.log(`Failed:          ${failedCount} ${failedCount > 0 ? '❌' : ''}`);

  if (failedCount > 0) {
    console.log('\nFailures:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  - [${r.suite}] ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL AUTOMATED TESTS PASSED WITH 100% SUCCESS RATE!');
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});
