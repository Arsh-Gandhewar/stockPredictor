import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EconomicCertificationService } from './engines/economic-certification.service';
import { ExecutedSimulatorTrade, DailyEquityPoint } from '../portfolio/engines/portfolio-simulator';

describe('P0 Invariant: Independent Economic Certification & Tamper Resistance', () => {
  let certService: EconomicCertificationService;
  const currentSha = 'c39a130ee577d8dc8adde4247d100373447a2323';

  // Sample valid long-only executed trades
  const sampleTrades: ExecutedSimulatorTrade[] = [
    {
      tradeId: 'trade_1_RELIANCE.NS_2026-03-01',
      ticker: 'RELIANCE.NS',
      sector: 'Energy',
      positionType: 'LONG',
      entryDate: '2026-03-01',
      entryPrice: 2800.0,
      exitDate: '2026-03-06',
      exitPrice: 2950.0,
      exitReason: 'TARGET_PROFIT',
      quantity: 35,
      notionalEntry: 98000.0,
      notionalExit: 103250.0,
      totalCosts: 134.23,
      grossReturn: 0.0536,
      netReturn: 0.0522,
      realizedPnL: 5115.77,
      holdingDays: 5,
      directionCorrect: true,
    },
    {
      tradeId: 'trade_2_TCS.NS_2026-03-02',
      ticker: 'TCS.NS',
      sector: 'Technology',
      positionType: 'LONG',
      entryDate: '2026-03-02',
      entryPrice: 4100.0,
      exitDate: '2026-03-07',
      exitPrice: 3980.0,
      exitReason: 'STOP_LOSS',
      quantity: 24,
      notionalEntry: 98400.0,
      notionalExit: 95520.0,
      totalCosts: 124.18,
      grossReturn: -0.0293,
      netReturn: -0.0305,
      realizedPnL: -3004.18,
      holdingDays: 5,
      directionCorrect: false,
    },
  ];

  const sampleEquityCurve: DailyEquityPoint[] = [
    {
      date: '2026-03-01',
      nav: 1_000_000,
      cash: 902000,
      investedValue: 98000,
      grossExposure: 0.098,
      positionsCount: 1,
      dailyReturn: 0,
    },
    {
      date: '2026-03-06',
      nav: 1_005_115.77,
      cash: 1_005_115.77,
      investedValue: 0,
      grossExposure: 0,
      positionsCount: 0,
      dailyReturn: 0.005115,
    },
    {
      date: '2026-03-07',
      nav: 1_002_111.59,
      cash: 1_002_111.59,
      investedValue: 0,
      grossExposure: 0,
      positionsCount: 0,
      dailyReturn: -0.002989,
    },
  ];

  const certPath = path.resolve(__dirname, '../../../data/artifacts/governance/economic-certification.json');
  const ledgerPath = path.resolve(__dirname, '../../../data/artifacts/governance/economic-trade-ledger.json');
  let originalCert: string | null = null;
  let originalLedger: string | null = null;

  beforeAll(() => {
    if (fs.existsSync(certPath)) originalCert = fs.readFileSync(certPath, 'utf-8');
    if (fs.existsSync(ledgerPath)) originalLedger = fs.readFileSync(ledgerPath, 'utf-8');
  });

  afterAll(() => {
    if (originalCert !== null) fs.writeFileSync(certPath, originalCert, 'utf-8');
    if (originalLedger !== null) fs.writeFileSync(ledgerPath, originalLedger, 'utf-8');
  });

  beforeEach(() => {
    certService = new EconomicCertificationService();
  });

  it('should generate valid cryptographic attestation and ledger for current commit', () => {
    const signedCert = certService.recordCertification(sampleTrades, sampleEquityCurve, currentSha);

    expect(signedCert.commitSha).toBe(currentSha);
    expect(signedCert.signature).toBeDefined();
    expect(signedCert.ledgerHash).toBe(EconomicCertificationService.computeLedgerHash(sampleTrades));
    expect(signedCert.mandate).toBe('LONG_ONLY');
    expect(signedCert.sourceModel).toBe('PRODUCTION_ONNX_ENGINE');

    // Validation must pass cleanly
    const validation = certService.loadAndValidateCertification(currentSha);
    expect(validation.isValid).toBe(true);
    expect(validation.failureReasons.length).toBe(0);
  });

  it('tampering with raw trade ledger content fails certification (ledger hash mismatch)', () => {
    // Record valid baseline
    certService.recordCertification(sampleTrades, sampleEquityCurve, currentSha);

    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));

    // Maliciously tamper with realizedPnL in raw ledger
    ledger.trades[0].realizedPnL = 999999;
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf-8');

    // Invariant: Validation must strictly fail closed
    const validation = certService.loadAndValidateCertification(currentSha);
    expect(validation.isValid).toBe(false);
    expect(validation.failureReasons.some((r) => r.includes('LEDGER_CHECKSUM_MISMATCH'))).toBe(true);
  });

  it('tampering with certified metrics fails certification (metric provenance mismatch)', () => {
    certService.recordCertification(sampleTrades, sampleEquityCurve, currentSha);

    const cert = JSON.parse(fs.readFileSync(certPath, 'utf-8'));

    // Maliciously tamper with certified winRate
    cert.metrics.winRate = 99.9;
    fs.writeFileSync(certPath, JSON.stringify(cert, null, 2), 'utf-8');

    // Invariant: Validation must strictly fail closed
    const validation = certService.loadAndValidateCertification(currentSha);
    expect(validation.isValid).toBe(false);
    expect(
      validation.failureReasons.some(
        (r) => r.includes('CERTIFICATION_SIGNATURE_TAMPERED') || r.includes('METRIC_RECALCULATION_MISMATCH')
      )
    ).toBe(true);
  });

  it('old or mismatched commit SHA fails certification', () => {
    certService.recordCertification(sampleTrades, sampleEquityCurve, currentSha);

    const oldCommit = 'deadbeef1234567890abcdef1234567890abcdef';
    const validation = certService.loadAndValidateCertification(oldCommit);

    expect(validation.isValid).toBe(false);
    expect(validation.failureReasons.some((r) => r.includes('COMMIT_SHA_MISMATCH'))).toBe(true);
  });

  it('attempting to certify unsupported SHORT position violates Long-Only mandate', () => {
    const invalidTrades: ExecutedSimulatorTrade[] = [
      {
        ...sampleTrades[0],
        positionType: 'SHORT' as any, // Prohibited short trade
      },
    ];

    certService.recordCertification(invalidTrades, sampleEquityCurve, currentSha);

    const validation = certService.loadAndValidateCertification(currentSha);
    expect(validation.isValid).toBe(false);
    expect(validation.failureReasons.some((r) => r.includes('UNSUPPORTED_SHORT'))).toBe(true);
  });
});
