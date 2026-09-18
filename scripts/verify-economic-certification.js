const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const HMAC_SECRET = process.env.GOVERNANCE_CI_SECRET || 'quantx-gov-ci-salt-2026-v5-1';
const certPath = path.resolve(__dirname, '../apps/api/data/artifacts/governance/economic-certification.json');
const ledgerPath = path.resolve(__dirname, '../apps/api/data/artifacts/governance/economic-trade-ledger.json');

console.log('--- QuantX Independent Economic Certification Verifier ---');

// 1. Check file existence
if (!fs.existsSync(certPath)) {
  console.error('❌ FAIL: economic-certification.json not found at ' + certPath);
  process.exit(1);
}
if (!fs.existsSync(ledgerPath)) {
  console.error('❌ FAIL: economic-trade-ledger.json not found at ' + ledgerPath);
  process.exit(1);
}

let cert, ledger;
try {
  cert = JSON.parse(fs.readFileSync(certPath, 'utf-8'));
} catch (e) {
  console.error('❌ FAIL: Malformed JSON in economic-certification.json: ' + e.message);
  process.exit(1);
}

try {
  ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
} catch (e) {
  console.error('❌ FAIL: Malformed JSON in economic-trade-ledger.json: ' + e.message);
  process.exit(1);
}

// 2. Commit SHA matching
let currentCommitSha;
let parentCommitSha;
try {
  currentCommitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  try {
    parentCommitSha = execSync('git rev-parse HEAD~1', { encoding: 'utf-8' }).trim();
  } catch {}
} catch {
  currentCommitSha = process.env.COMMIT_SHA;
}

const isShaValid =
  !currentCommitSha ||
  cert.commitSha === currentCommitSha ||
  (parentCommitSha && cert.commitSha === parentCommitSha);

if (!isShaValid) {
  console.error('❌ FAIL: Certification commit SHA mismatch!');
  console.error(`  Expected commit: ${currentCommitSha}`);
  console.error(`  Certified commit: ${cert.commitSha}`);
  console.error('  Economic evidence was not generated from the current commit.');
  process.exit(1);
}

if (ledger.commitSha !== cert.commitSha) {
  console.error('❌ FAIL: Trade ledger commitSha does not match certification commitSha!');
  process.exit(1);
}

// 3. Cryptographic Signature Verification
if (!cert.signature) {
  console.error('❌ FAIL: economic-certification.json lacks cryptographic signature.');
  process.exit(1);
}

const certCanonical = JSON.stringify({
  commitSha: cert.commitSha,
  evaluatedAt: cert.evaluatedAt,
  ledgerHash: cert.ledgerHash,
  tradeCount: cert.tradeCount,
  metrics: cert.metrics,
  mandate: cert.mandate,
  sourceModel: cert.sourceModel,
});

const expectedSignature = crypto.createHmac('sha256', HMAC_SECRET).update(certCanonical).digest('hex');
if (cert.signature !== expectedSignature) {
  console.error('❌ FAIL: Cryptographic attestation signature mismatch on economic-certification.json!');
  console.error(`  Expected: ${expectedSignature}`);
  console.error(`  Actual:   ${cert.signature}`);
  process.exit(1);
}

// 4. Ledger Hash Verification
const ledgerCanonical = JSON.stringify(
  ledger.trades.map((t) => ({
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

const expectedLedgerHash = crypto.createHash('sha256').update(ledgerCanonical).digest('hex');
if (expectedLedgerHash !== cert.ledgerHash) {
  console.error('❌ FAIL: Ledger hash tampering detected!');
  console.error(`  Expected Hash: ${expectedLedgerHash}`);
  console.error(`  Certified Hash: ${cert.ledgerHash}`);
  process.exit(1);
}

// 5. Long-Only Mandate Invariant Checks
if (cert.mandate !== 'LONG_ONLY') {
  console.error(`❌ FAIL: Invalid strategy mandate '${cert.mandate}'. Mandate must be 'LONG_ONLY'.`);
  process.exit(1);
}

for (let i = 0; i < ledger.trades.length; i++) {
  const trade = ledger.trades[i];
  if (trade.positionType !== 'LONG') {
    console.error(`❌ FAIL: Unsupported short position found in trade ${trade.tradeId} (${trade.ticker})!`);
    console.error(`  PositionType: ${trade.positionType}`);
    console.error('  Under Long-Only mandate, short sales are strictly prohibited.');
    process.exit(1);
  }
  if (!trade.entryPrice || trade.entryPrice <= 0 || !trade.exitPrice || trade.exitPrice <= 0) {
    console.error(`❌ FAIL: Invalid non-positive pricing in trade ${trade.tradeId}!`);
    process.exit(1);
  }
  if (!trade.quantity || trade.quantity <= 0) {
    console.error(`❌ FAIL: Invalid quantity in trade ${trade.tradeId}!`);
    process.exit(1);
  }
}

// 6. Deterministic Metric Recalculation from Raw Ledger
const trades = ledger.trades;
const equityCurve = ledger.equityCurve;
const initialCash = ledger.initialCash || 1_000_000;

const totalTrades = trades.length;
const wins = trades.filter((t) => t.netReturn > 0);
const recalcWinRate = totalTrades > 0 ? parseFloat(((wins.length / totalTrades) * 100).toFixed(1)) : 0;

const endingNav = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : initialCash;
const recalcTotalReturn = initialCash > 0 ? parseFloat((((endingNav - initialCash) / initialCash) * 100).toFixed(2)) : 0;

const days = Math.max(1, equityCurve.length);
const cagrRaw = days > 1 ? Math.pow(Math.max(0.001, endingNav / initialCash), 252 / days) - 1 : recalcTotalReturn / 100;
const recalcCagr = parseFloat((cagrRaw * 100).toFixed(2));

const dailyReturns = equityCurve.map((p) => p.dailyReturn);
const meanDaily = dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
const variance =
  dailyReturns.length > 1
    ? dailyReturns.reduce((s, r) => s + Math.pow(r - meanDaily, 2), 0) / (dailyReturns.length - 1)
    : 0;
const dailyVol = Math.sqrt(variance);
const annualizedVol = dailyVol * Math.sqrt(252);
const recalcSharpe = annualizedVol > 0 ? parseFloat(((meanDaily * 252 - 0.04) / annualizedVol).toFixed(2)) : 0;

const downsideDiffs = dailyReturns.filter((r) => r < 0);
const downsideVar =
  downsideDiffs.length > 0
    ? downsideDiffs.reduce((s, r) => s + Math.pow(r, 2), 0) / dailyReturns.length
    : 0;
const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(252);
const recalcSortino = downsideVol > 0 ? parseFloat(((meanDaily * 252 - 0.04) / downsideVol).toFixed(2)) : 0;

let peak = initialCash;
let maxDrawdown = 0;
for (const point of equityCurve) {
  if (point.nav > peak) peak = point.nav;
  const dd = peak > 0 ? (peak - point.nav) / peak : 0;
  if (dd > maxDrawdown) maxDrawdown = dd;
}
const recalcMaxDrawdown = parseFloat((maxDrawdown * 100).toFixed(2));

const grossGains = trades.filter((t) => t.realizedPnL > 0).reduce((s, t) => s + t.realizedPnL, 0);
const grossLosses = Math.abs(trades.filter((t) => t.realizedPnL < 0).reduce((s, t) => s + t.realizedPnL, 0));
const recalcProfitFactor =
  grossLosses > 0 ? parseFloat((grossGains / grossLosses).toFixed(2)) : grossGains > 0 ? 'NOT_MEANINGFUL' : 1.0;

const m = cert.metrics;
const metricDiscrepancies = [];

if (m.totalTrades !== totalTrades) metricDiscrepancies.push(`totalTrades (${m.totalTrades} vs ${totalTrades})`);
if (m.winRate !== recalcWinRate) metricDiscrepancies.push(`winRate (${m.winRate}% vs ${recalcWinRate}%)`);
if (m.sharpeRatio !== recalcSharpe) metricDiscrepancies.push(`sharpeRatio (${m.sharpeRatio} vs ${recalcSharpe})`);
if (m.sortinoRatio !== recalcSortino) metricDiscrepancies.push(`sortinoRatio (${m.sortinoRatio} vs ${recalcSortino})`);
if (m.maxDrawdown !== recalcMaxDrawdown) metricDiscrepancies.push(`maxDrawdown (${m.maxDrawdown}% vs ${recalcMaxDrawdown}%)`);
if (m.totalReturn !== recalcTotalReturn) metricDiscrepancies.push(`totalReturn (${m.totalReturn}% vs ${recalcTotalReturn}%)`);
if (m.cagr !== recalcCagr) metricDiscrepancies.push(`cagr (${m.cagr}% vs ${recalcCagr}%)`);
if (m.profitFactor !== recalcProfitFactor) metricDiscrepancies.push(`profitFactor (${m.profitFactor} vs ${recalcProfitFactor})`);

if (metricDiscrepancies.length > 0) {
  console.error('❌ FAIL: Economic certification metrics do not trace back to raw trade ledger!');
  console.error(`  Discrepancies: ${metricDiscrepancies.join(', ')}`);
  process.exit(1);
}

console.log('✅ PASS: economic-certification.json verified successfully.');
console.log(`  Commit SHA:    ${cert.commitSha}`);
console.log(`  Ledger Hash:   ${cert.ledgerHash.slice(0, 16)}...`);
console.log(`  Mandate:       ${cert.mandate}`);
console.log(`  Source Model:  ${cert.sourceModel}`);
console.log(`  Trades Count:  ${cert.tradeCount}`);
console.log(`  Win Rate:      ${m.winRate}%`);
console.log(`  CAGR:          ${m.cagr}%`);
console.log(`  Sharpe Ratio:  ${m.sharpeRatio}`);
console.log(`  Sortino Ratio: ${m.sortinoRatio}`);
console.log(`  Max Drawdown:  ${m.maxDrawdown}%`);
console.log(`  Profit Factor: ${m.profitFactor}`);
console.log(`  Total Return:  ${m.totalReturn}%`);
process.exit(0);
