import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import {
  ExecutedSimulatorTrade,
  DailyEquityPoint,
  PortfolioMetrics,
} from '../../portfolio/engines/portfolio-simulator';

export interface EconomicTradeLedger {
  commitSha: string;
  generatedAt: string;
  totalTrades: number;
  initialCash: number;
  endingNav: number;
  trades: ExecutedSimulatorTrade[];
  equityCurve: DailyEquityPoint[];
}

export interface EconomicCertificationMetrics {
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  totalReturn: number;
  cagr: number;
  profitFactor: number | 'NOT_MEANINGFUL';
}

export interface EconomicCertificationPayload {
  commitSha: string;
  evaluatedAt: string;
  ledgerHash: string;
  tradeCount: number;
  metrics: EconomicCertificationMetrics;
  mandate: 'LONG_ONLY';
  sourceModel: 'PRODUCTION_ONNX_ENGINE';
}

export interface SignedEconomicCertification extends EconomicCertificationPayload {
  signature: string;
}

export interface EconomicValidationResult {
  isValid: boolean;
  commitSha?: string;
  tradeCount: number;
  metrics?: EconomicCertificationMetrics;
  failureReasons: string[];
}

@Injectable()
export class EconomicCertificationService {
  private readonly logger = new Logger(EconomicCertificationService.name);
  public static readonly HMAC_SECRET = process.env.GOVERNANCE_CI_SECRET || 'quantx-gov-ci-salt-2026-v5-1';

  private readonly ledgerPath = path.resolve(
    __dirname,
    '../../../../data/artifacts/governance/economic-trade-ledger.json'
  );
  private readonly certPath = path.resolve(
    __dirname,
    '../../../../data/artifacts/governance/economic-certification.json'
  );

  public static getHeadCommitSha(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return process.env.COMMIT_SHA || 'c39a130ee577d8dc8adde4247d100373447a2323';
    }
  }

  public static computeLedgerHash(trades: ExecutedSimulatorTrade[]): string {
    const canonical = JSON.stringify(
      trades.map((t) => ({
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
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  public static computeMetricsFromLedger(
    trades: ExecutedSimulatorTrade[],
    equityCurve: DailyEquityPoint[],
    initialCash: number = 1_000_000
  ): EconomicCertificationMetrics {
    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.netReturn > 0);
    const winRate = totalTrades > 0 ? parseFloat(((wins.length / totalTrades) * 100).toFixed(1)) : 0;

    const endingNav = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : initialCash;
    const totalReturn = initialCash > 0 ? parseFloat((((endingNav - initialCash) / initialCash) * 100).toFixed(2)) : 0;

    const days = Math.max(1, equityCurve.length);
    const cagrRaw = days > 1 ? Math.pow(Math.max(0.001, endingNav / initialCash), 252 / days) - 1 : totalReturn / 100;
    const cagr = parseFloat((cagrRaw * 100).toFixed(2));

    const dailyReturns = equityCurve.map((p) => p.dailyReturn);
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

    let peak = initialCash;
    let maxDrawdown = 0;
    for (const point of equityCurve) {
      if (point.nav > peak) peak = point.nav;
      const dd = peak > 0 ? (peak - point.nav) / peak : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const grossGains = trades.filter((t) => t.realizedPnL > 0).reduce((s, t) => s + t.realizedPnL, 0);
    const grossLosses = Math.abs(trades.filter((t) => t.realizedPnL < 0).reduce((s, t) => s + t.realizedPnL, 0));
    const profitFactor =
      grossLosses > 0 ? parseFloat((grossGains / grossLosses).toFixed(2)) : grossGains > 0 ? 'NOT_MEANINGFUL' : 1.0;

    return {
      totalTrades,
      winRate,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
      totalReturn,
      cagr,
      profitFactor,
    };
  }

  public static signCertification(payload: EconomicCertificationPayload): string {
    const canonical = JSON.stringify({
      commitSha: payload.commitSha,
      evaluatedAt: payload.evaluatedAt,
      ledgerHash: payload.ledgerHash,
      tradeCount: payload.tradeCount,
      metrics: payload.metrics,
      mandate: payload.mandate,
      sourceModel: payload.sourceModel,
    });
    return crypto.createHmac('sha256', EconomicCertificationService.HMAC_SECRET).update(canonical).digest('hex');
  }

  /**
   * Records immutable trade ledger and creates signed economic certification artifact
   */
  public recordCertification(
    trades: ExecutedSimulatorTrade[],
    equityCurve: DailyEquityPoint[],
    commitSha?: string
  ): SignedEconomicCertification {
    const sha = commitSha || EconomicCertificationService.getHeadCommitSha();
    const evaluatedAt = new Date().toISOString();
    const ledgerHash = EconomicCertificationService.computeLedgerHash(trades);
    const metrics = EconomicCertificationService.computeMetricsFromLedger(trades, equityCurve);

    const ledgerData: EconomicTradeLedger = {
      commitSha: sha,
      generatedAt: evaluatedAt,
      totalTrades: trades.length,
      initialCash: equityCurve.length > 0 ? equityCurve[0].cash + equityCurve[0].investedValue : 1_000_000,
      endingNav: equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].nav : 1_000_000,
      trades,
      equityCurve,
    };

    const certPayload: EconomicCertificationPayload = {
      commitSha: sha,
      evaluatedAt,
      ledgerHash,
      tradeCount: trades.length,
      metrics,
      mandate: 'LONG_ONLY',
      sourceModel: 'PRODUCTION_ONNX_ENGINE',
    };

    const signature = EconomicCertificationService.signCertification(certPayload);
    const signedCert: SignedEconomicCertification = {
      ...certPayload,
      signature,
    };

    const dir = path.dirname(this.certPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.ledgerPath, JSON.stringify(ledgerData, null, 2), 'utf-8');
    fs.writeFileSync(this.certPath, JSON.stringify(signedCert, null, 2), 'utf-8');
    this.logger.log(`Economic certification and raw trade ledger recorded for commit ${sha.slice(0, 7)} (Hash: ${ledgerHash.slice(0, 10)}...)`);

    return signedCert;
  }

  /**
   * Loads and validates economic certification and guarantees cryptographic provenance to raw trade ledger
   */
  public loadAndValidateCertification(expectedCommitSha?: string): EconomicValidationResult {
    const failureReasons: string[] = [];

    if (!fs.existsSync(this.certPath)) {
      return {
        isValid: false,
        tradeCount: 0,
        failureReasons: ['CERTIFICATION_FILE_MISSING: No economic-certification.json found in governance artifacts.'],
      };
    }

    if (!fs.existsSync(this.ledgerPath)) {
      return {
        isValid: false,
        tradeCount: 0,
        failureReasons: ['LEDGER_FILE_MISSING: No economic-trade-ledger.json found in governance artifacts.'],
      };
    }

    try {
      const certRaw = fs.readFileSync(this.certPath, 'utf-8');
      const cert: SignedEconomicCertification = JSON.parse(certRaw);

      const ledgerRaw = fs.readFileSync(this.ledgerPath, 'utf-8');
      const ledger: EconomicTradeLedger = JSON.parse(ledgerRaw);

      if (!cert.signature) {
        failureReasons.push('CERTIFICATION_UNSIGNED: economic-certification.json lacks cryptographic signature.');
      } else {
        const expectedSig = EconomicCertificationService.signCertification(cert);
        if (cert.signature !== expectedSig) {
          failureReasons.push('CERTIFICATION_SIGNATURE_TAMPERED: HMAC signature mismatch in economic-certification.json.');
        }
      }

      // 1. Verify ledger hash against raw trades
      const computedLedgerHash = EconomicCertificationService.computeLedgerHash(ledger.trades || []);
      if (computedLedgerHash !== cert.ledgerHash) {
        failureReasons.push(
          `LEDGER_CHECKSUM_MISMATCH: Computed trade hash '${computedLedgerHash}' does not match certification hash '${cert.ledgerHash}'. Raw trade ledger has been altered.`
        );
      }

      // 2. Verify mathematical consistency between raw trades and claimed metrics
      const recalculatedMetrics = EconomicCertificationService.computeMetricsFromLedger(
        ledger.trades || [],
        ledger.equityCurve || []
      );

      if (recalculatedMetrics.winRate !== cert.metrics.winRate) {
        failureReasons.push(
          `METRIC_RECALCULATION_MISMATCH: Claimed win rate ${cert.metrics.winRate}% differs from recalculated ${recalculatedMetrics.winRate}%.`
        );
      }
      if (recalculatedMetrics.sharpeRatio !== cert.metrics.sharpeRatio) {
        failureReasons.push(
          `METRIC_RECALCULATION_MISMATCH: Claimed Sharpe ${cert.metrics.sharpeRatio} differs from recalculated ${recalculatedMetrics.sharpeRatio}.`
        );
      }
      if (recalculatedMetrics.maxDrawdown !== cert.metrics.maxDrawdown) {
        failureReasons.push(
          `METRIC_RECALCULATION_MISMATCH: Claimed MaxDD ${cert.metrics.maxDrawdown}% differs from recalculated ${recalculatedMetrics.maxDrawdown}%.`
        );
      }

      // 3. Verify Mandate and Position Types
      if (cert.mandate !== 'LONG_ONLY') {
        failureReasons.push(`INVALID_MANDATE: Certified mandate must be 'LONG_ONLY', got '${cert.mandate}'.`);
      }
      const hasShortPositions = (ledger.trades || []).some((t) => (t.positionType as string) !== 'LONG');
      if (hasShortPositions) {
        failureReasons.push('UNSUPPORTED_SHORT_POSITIONS: Raw trade ledger contains positions that violate Long-Only mandate.');
      }

      // 4. Verify Commit SHA (Strict binding: zero parent commit or HEAD~1 exceptions)
      if (expectedCommitSha && cert.commitSha !== expectedCommitSha) {
        failureReasons.push(
          `COMMIT_SHA_MISMATCH: Certification was generated for ${cert.commitSha.slice(0, 7)} but expected commit is ${expectedCommitSha.slice(0, 7)}.`
        );
      }

      return {
        isValid: failureReasons.length === 0,
        commitSha: cert.commitSha,
        tradeCount: cert.tradeCount,
        metrics: cert.metrics,
        failureReasons,
      };
    } catch (err: any) {
      return {
        isValid: false,
        tradeCount: 0,
        failureReasons: [`CERTIFICATION_READ_ERROR: ${err.message}`],
      };
    }
  }
}
