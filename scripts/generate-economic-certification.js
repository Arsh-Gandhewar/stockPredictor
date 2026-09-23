const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const HMAC_SECRET = process.env.GOVERNANCE_CI_SECRET || 'quantx-gov-ci-salt-2026-v5-1';
const certPath = path.resolve(__dirname, '../apps/api/data/artifacts/governance/economic-certification.json');
const ledgerPath = path.resolve(__dirname, '../apps/api/data/artifacts/governance/economic-trade-ledger.json');
const feedPath = path.resolve(__dirname, '../apps/api/data/artifacts/governance/real-oos-feed.json');
const extractorScript = path.resolve(__dirname, 'extract-historical-backtest-feed.py');

console.log('--- QuantX Independent Economic Certification Generator ---');

// 1. Determine Commit SHA
let commitSha;
try {
  commitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
} catch {
  commitSha = process.env.COMMIT_SHA;
}
if (!commitSha) {
  console.error('ERROR: Unable to resolve active commit SHA.');
  process.exit(1);
}
console.log(`Target Commit SHA: ${commitSha}`);

// 2. Ensure Real Historical OOS Feed Exists
if (!fs.existsSync(feedPath)) {
  console.log('Real historical OOS feed not found. Running extractor script...');
  try {
    execSync(`python "${extractorScript}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('ERROR: Failed to run historical feed extractor:', err.message);
    process.exit(1);
  }
}

if (!fs.existsSync(feedPath)) {
  console.error(`ERROR: Historical feed file missing at ${feedPath}`);
  process.exit(1);
}

const feed = JSON.parse(fs.readFileSync(feedPath, 'utf-8'));
console.log(`Loaded real historical feed with ${feed.tradingDaysCount} sessions and ${feed.stocksCount} equities.`);

const tradingDates = feed.tradingDates;
const dailyCandles = feed.dailyCandles; // ticker -> list of candles
const opportunities = feed.opportunities; // list of candidate BUYs

// Index opportunities by date
const oppsByDate = new Map();
for (const opp of opportunities) {
  if (!oppsByDate.has(opp.date)) {
    oppsByDate.set(opp.date, []);
  }
  oppsByDate.get(opp.date).push(opp);
}

// Index candles by ticker -> date -> candle
const candleMap = new Map();
for (const [ticker, candles] of Object.entries(dailyCandles)) {
  const byDate = new Map();
  for (const c of candles) {
    byDate.set(c.date, c);
  }
  candleMap.set(ticker, byDate);
}

// 3. Institutional Portfolio Simulation Parameters (Aligned with EventDrivenPortfolioSimulator)
const INITIAL_CASH = 1_000_000;
const MAX_STOCK_WEIGHT = 0.10; // 10%
const MAX_SECTOR_WEIGHT = 0.25; // 25%
const MAX_GROSS_EXPOSURE = 1.00; // 100%
const MAX_POSITIONS = 10;
const BROKERAGE_RATE = 0.0003; // 3 bps
const STT_SELL_RATE = 0.0010; // 10 bps
const SLIPPAGE_RATE = 0.0005; // 5 bps

let cash = INITIAL_CASH;
const positions = new Map(); // ticker -> position object
const executedTrades = [];
const equityCurve = [];
let tradeCounter = 0;

function roundMoney(val) {
  return Math.round(val * 100) / 100;
}

function getNAV(quotesOnDay) {
  let invested = 0;
  for (const [ticker, pos] of positions.entries()) {
    const mark = quotesOnDay.get(ticker) || pos.currentPrice;
    invested += pos.quantity * mark;
  }
  return roundMoney(cash + invested);
}

function getSectorInvested(sector, quotesOnDay) {
  let val = 0;
  for (const [ticker, pos] of positions.entries()) {
    if (pos.sector === sector) {
      const mark = quotesOnDay.get(ticker) || pos.currentPrice;
      val += pos.quantity * mark;
    }
  }
  return roundMoney(val);
}

function getInvestedValue(quotesOnDay) {
  let val = 0;
  for (const [ticker, pos] of positions.entries()) {
    const mark = quotesOnDay.get(ticker) || pos.currentPrice;
    val += pos.quantity * mark;
  }
  return roundMoney(val);
}

// 4. Chronological Step-by-Step Simulation
for (let d = 0; d < tradingDates.length; d++) {
  const dateStr = tradingDates[d];

  // Collect quotes for today
  const quotesToday = new Map();
  for (const [ticker, byDate] of candleMap.entries()) {
    const c = byDate.get(dateStr);
    if (c && c.close > 0) {
      quotesToday.set(ticker, c.close);
    }
  }

  // Step A: Process intraday price path for held positions (Stops / Targets / Horizon Expiry)
  const heldTickers = Array.from(positions.keys());
  for (const ticker of heldTickers) {
    const pos = positions.get(ticker);
    if (!pos) continue;

    const candle = candleMap.get(ticker)?.get(dateStr);
    if (!candle) continue;

    pos.holdingDays += 1;
    pos.currentPrice = candle.close;

    let exitPrice = null;
    let exitReason = null;

    const touchedStop = pos.stopLossPrice !== null && candle.low <= pos.stopLossPrice;
    const touchedTarget = pos.targetPrice !== null && candle.high >= pos.targetPrice;

    if (touchedStop && touchedTarget) {
      // Conservative collision priority: stop loss triggers first
      exitPrice = pos.stopLossPrice;
      exitReason = 'STOP_LOSS';
    } else if (touchedStop) {
      exitPrice = pos.stopLossPrice;
      exitReason = 'STOP_LOSS';
    } else if (touchedTarget) {
      exitPrice = pos.targetPrice;
      exitReason = 'TARGET_PROFIT';
    } else if (pos.holdingDays >= pos.horizonDays) {
      exitPrice = candle.close;
      exitReason = 'HORIZON_EXPIRY';
    }

    if (exitPrice !== null && exitReason !== null) {
      // Execute SELL with adverse slippage and frictions
      const execExitPrice = roundMoney(exitPrice * (1 - SLIPPAGE_RATE));
      const notionalExit = roundMoney(pos.quantity * execExitPrice);
      const exitFriction = roundMoney(notionalExit * (BROKERAGE_RATE + STT_SELL_RATE));
      const netProceeds = roundMoney(notionalExit - exitFriction);

      const notionalEntry = roundMoney(pos.quantity * pos.averagePrice);
      const pnl = roundMoney(netProceeds - notionalEntry);
      const grossReturn = parseFloat(((execExitPrice - pos.entryPrice) / pos.entryPrice).toFixed(4));
      const netReturn = notionalEntry > 0 ? parseFloat(((netProceeds - notionalEntry) / notionalEntry).toFixed(4)) : 0;

      cash = roundMoney(cash + netProceeds);
      positions.delete(ticker);

      tradeCounter++;
      executedTrades.push({
        tradeId: `trade_${tradeCounter}_${ticker}_${dateStr}`,
        ticker,
        sector: pos.sector,
        positionType: 'LONG',
        entryDate: pos.entryDate,
        entryPrice: pos.entryPrice,
        exitDate: dateStr,
        exitPrice: execExitPrice,
        exitReason,
        quantity: pos.quantity,
        notionalEntry,
        notionalExit,
        totalCosts: roundMoney(pos.entryFriction + exitFriction),
        grossReturn,
        netReturn,
        realizedPnL: pnl,
        holdingDays: pos.holdingDays,
        directionCorrect: grossReturn > 0,
      });
    }
  }

  // Step B: Evaluate New BUY Candidate Opportunities
  const todayOpps = oppsByDate.get(dateStr) || [];
  for (const opp of todayOpps) {
    if (positions.has(opp.ticker)) continue;
    if (positions.size >= MAX_POSITIONS) break;

    const candle = candleMap.get(opp.ticker)?.get(dateStr);
    if (!candle || candle.open <= 0) continue;

    const nav = getNAV(quotesToday);
    const executionPrice = roundMoney(candle.open * (1 + SLIPPAGE_RATE));
    const costPerShare = executionPrice * (1 + BROKERAGE_RATE);

    const currentStockVal = 0;
    const currentSectorVal = getSectorInvested(opp.sector, quotesToday);
    const currentInvested = getInvestedValue(quotesToday);

    const remainingStockCap = Math.max(0, nav * MAX_STOCK_WEIGHT - currentStockVal);
    const remainingSectorCap = Math.max(0, nav * MAX_SECTOR_WEIGHT - currentSectorVal);
    const remainingGrossCap = Math.max(0, nav * MAX_GROSS_EXPOSURE - currentInvested);
    const availableCapital = Math.max(0, cash);

    const maxExpenditure = Math.min(remainingStockCap, remainingSectorCap, remainingGrossCap, availableCapital);
    if (maxExpenditure < costPerShare) continue;

    const targetQuantity = Math.floor(maxExpenditure / costPerShare);
    if (targetQuantity <= 0) continue;

    const notionalEntry = roundMoney(targetQuantity * executionPrice);
    const entryBrokerage = roundMoney(notionalEntry * BROKERAGE_RATE);
    const totalCost = roundMoney(notionalEntry + entryBrokerage);

    if (totalCost > cash) continue;

    // Deduct cash and record position with capitalized cost basis
    cash = roundMoney(cash - totalCost);
    const capitalizedAvgPrice = roundMoney(totalCost / targetQuantity);

    positions.set(opp.ticker, {
      ticker: opp.ticker,
      sector: opp.sector,
      quantity: targetQuantity,
      entryPrice: executionPrice,
      averagePrice: capitalizedAvgPrice,
      entryFriction: entryBrokerage,
      currentPrice: executionPrice,
      stopLossPrice: opp.stopLossPrice,
      targetPrice: opp.targetPrice,
      entryDate: dateStr,
      horizonDays: opp.horizonDays || 5,
      holdingDays: 0,
    });
  }

  // Step C: Mark-to-Market Snapshot
  let totalInvestedToday = 0;
  for (const [ticker, pos] of positions.entries()) {
    const mark = quotesToday.get(ticker) || pos.currentPrice;
    pos.currentPrice = mark;
    totalInvestedToday += pos.quantity * mark;
  }
  totalInvestedToday = roundMoney(totalInvestedToday);
  const endingNavToday = roundMoney(cash + totalInvestedToday);

  const prevNav = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : INITIAL_CASH;
  const dailyReturn = prevNav > 0 ? parseFloat(((endingNavToday - prevNav) / prevNav).toFixed(5)) : 0;
  const grossExposure = endingNavToday > 0 ? parseFloat((totalInvestedToday / endingNavToday).toFixed(4)) : 0;

  equityCurve.push({
    date: dateStr,
    nav: endingNavToday,
    cash,
    investedValue: totalInvestedToday,
    grossExposure,
    positionsCount: positions.size,
    dailyReturn,
  });
}

// 5. Compute Accurate Performance Metrics
const endingNav = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : INITIAL_CASH;
const totalTradesCount = executedTrades.length;
const winningTrades = executedTrades.filter((t) => t.realizedPnL > 0);
const losingTrades = executedTrades.filter((t) => t.realizedPnL < 0);
const winRate = totalTradesCount > 0 ? parseFloat(((winningTrades.length / totalTradesCount) * 100).toFixed(1)) : 0;

const totalReturn = parseFloat((((endingNav - INITIAL_CASH) / INITIAL_CASH) * 100).toFixed(2));
const days = Math.max(1, equityCurve.length);
const cagrRaw = days > 1 ? Math.pow(Math.max(0.001, endingNav / INITIAL_CASH), 252 / days) - 1 : totalReturn / 100;
const cagr = parseFloat((cagrRaw * 100).toFixed(2));

const dailyReturns = equityCurve.map((e) => e.dailyReturn);
const meanDaily = dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
const variance =
  dailyReturns.length > 1
    ? dailyReturns.reduce((s, r) => s + Math.pow(r - meanDaily, 2), 0) / (dailyReturns.length - 1)
    : 0;
const dailyVol = Math.sqrt(variance);
const annualizedVol = dailyVol * Math.sqrt(252);
const sharpeRatio = annualizedVol > 0 ? parseFloat(((meanDaily * 252 - 0.04) / annualizedVol).toFixed(2)) : 0;

const downsideDiffs = dailyReturns.filter((r) => r < 0);
const downsideVar =
  downsideDiffs.length > 0
    ? downsideDiffs.reduce((s, r) => s + Math.pow(r, 2), 0) / dailyReturns.length
    : 0;
const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(252);
const sortinoRatio = downsideVol > 0 ? parseFloat(((meanDaily * 252 - 0.04) / downsideVol).toFixed(2)) : 0;

let peak = INITIAL_CASH;
let maxDrawdown = 0;
for (const pt of equityCurve) {
  if (pt.nav > peak) peak = pt.nav;
  const dd = peak > 0 ? (peak - pt.nav) / peak : 0;
  if (dd > maxDrawdown) maxDrawdown = dd;
}
const maxDrawdownPct = parseFloat((maxDrawdown * 100).toFixed(2));

const grossGains = executedTrades.filter((t) => t.realizedPnL > 0).reduce((s, t) => s + t.realizedPnL, 0);
const grossLosses = Math.abs(executedTrades.filter((t) => t.realizedPnL < 0).reduce((s, t) => s + t.realizedPnL, 0));
const profitFactor =
  grossLosses > 0 ? parseFloat((grossGains / grossLosses).toFixed(2)) : grossGains > 0 ? 'NOT_MEANINGFUL' : 1.0;

const metrics = {
  totalTrades: totalTradesCount,
  winRate,
  sharpeRatio,
  sortinoRatio,
  maxDrawdown: maxDrawdownPct,
  totalReturn,
  cagr,
  profitFactor,
};

// 6. Compute Canonical Hashes and Signature
const ledgerCanonical = JSON.stringify(
  executedTrades.map((t) => ({
    tradeId: t.tradeId,
    ticker: t.ticker,
    sector: t.sector,
    positionType: t.positionType,
    entryDate: t.entryDate,
    entryPrice: t.entryPrice,
    exitDate: t.exitDate,
    exitPrice: t.exitPrice,
    exitReason: t.exitReason,
    quantity: t.quantity,
    notionalEntry: t.notionalEntry,
    notionalExit: t.notionalExit,
    totalCosts: t.totalCosts,
    grossReturn: t.grossReturn,
    netReturn: t.netReturn,
    realizedPnL: t.realizedPnL,
    holdingDays: t.holdingDays,
    directionCorrect: t.directionCorrect,
  }))
);

const ledgerHash = crypto.createHash('sha256').update(ledgerCanonical).digest('hex');
const evaluatedAt = new Date().toISOString();

const certPayload = {
  commitSha,
  evaluatedAt,
  ledgerHash,
  tradeCount: totalTradesCount,
  metrics,
  mandate: 'LONG_ONLY',
  sourceModel: 'PRODUCTION_ONNX_ENGINE',
  sourceDataset: 'REAL_HISTORICAL_PARQUET_NSE',
};

const certCanonical = JSON.stringify(certPayload);
const signature = crypto.createHmac('sha256', HMAC_SECRET).update(certCanonical).digest('hex');

const signedCert = {
  ...certPayload,
  signature,
};

const ledgerData = {
  commitSha,
  generatedAt: evaluatedAt,
  totalTrades: totalTradesCount,
  initialCash: INITIAL_CASH,
  endingNav,
  sourceDataset: 'REAL_HISTORICAL_PARQUET_NSE',
  trades: executedTrades,
  equityCurve,
};

// 7. Write to Governance Directory
const dir = path.dirname(certPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(ledgerPath, JSON.stringify(ledgerData, null, 2), 'utf-8');
fs.writeFileSync(certPath, JSON.stringify(signedCert, null, 2), 'utf-8');

console.log('✅ Generated authoritative economic-trade-ledger.json and signed economic-certification.json');
console.log(`  Commit:     ${commitSha}`);
console.log(`  Source:     REAL_HISTORICAL_PARQUET_NSE`);
console.log(`  Ledger Hash:${ledgerHash}`);
console.log(`  Signature:  ${signature}`);
console.log(`  Trades:     ${totalTradesCount}`);
console.log(`  Win Rate:   ${metrics.winRate}%`);
console.log(`  CAGR:       ${metrics.cagr}%`);
console.log(`  Sharpe:     ${metrics.sharpeRatio}`);
console.log(`  Sortino:    ${metrics.sortinoRatio}`);
console.log(`  Max DD:     ${metrics.maxDrawdown}%`);
console.log(`  Total Ret:  ${metrics.totalReturn}%`);
process.exit(0);
