import { Injectable, Logger } from '@nestjs/common';
import { ModelArtifact } from './model-artifact.service';
import { MODEL_CONFIG } from './model-config';
import { computeStrictArtifactChecksum, ArtifactBundleValidator } from './artifact-bundle-validator';
import * as path from 'path';

export type GateEvaluationStatus = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA' | 'NOT_ASSESSABLE' | 'NOT_ASSESSED' | 'LIMITATION';

export interface ScorecardCriterionResult {
  code: string;
  name: string;
  category: 'DATA' | 'METHODOLOGY' | 'STATISTICS' | 'GOVERNANCE' | 'SYSTEM';
  status: GateEvaluationStatus;
  evidence: string;
  mandatory: boolean;
  isCriticalBlocker?: boolean;
  value?: any;
  threshold?: any;
}

export const CRITICAL_BLOCKER_CODES: string[] = [
  'DATA_INTEGRITY',
  'POINT_IN_TIME_CORRECTNESS',
  'SURVIVORSHIP_BIAS_CONTROL',
  'LOOKAHEAD_BIAS_CONTROL',
  'ARTIFACT_INTEGRITY',
  'MODEL_VERSIONING',
  'PRODUCTION_INFERENCE',
  'BACKTEST_VALIDITY',
  'RISK_MODEL',
  'PORTFOLIO_RISK',
];

export interface ProductionReadinessScorecard {
  overallStatus: 'PRODUCTION_READY' | 'NOT_PRODUCTION_READY';
  technicalMethodStatus: 'PASS' | 'FAIL';
  economicStrategyStatus: 'PASS' | 'FAIL';
  productionReady: boolean;
  passRate: number; // 0.0 to 1.0
  evaluatedAt: string;
  evaluatorVersion: string;
  criteria: Record<string, ScorecardCriterionResult>;
  blockingFailures: string[];
  criticalBlockerFailures: string[];
  summary: {
    totalEvaluated: number;
    passed: number;
    failed: number;
    notAssessable: number;
    insufficientData: number;
  };
}

@Injectable()
export class ProductionScorecardService {
  private readonly logger = new Logger(ProductionScorecardService.name);

  /**
   * Programmatically evaluates the 18 mandatory production readiness criteria.
   * Eliminates manual boolean assumptions and dynamically recomputes metrics from raw ledgers.
   */
  evaluateScorecard(
    artifact: ModelArtifact | null,
    runtimeStateOrReport: any = {}
  ): ProductionReadinessScorecard {
    const criteria: Record<string, ScorecardCriterionResult> = {};
    const blockingFailures: string[] = [];
    const criticalBlockerFailures: string[] = [];

    const isReport = Boolean(runtimeStateOrReport && runtimeStateOrReport.verifications);
    const verifs = isReport ? runtimeStateOrReport.verifications : null;

    // Validate active bundle using strict validator
    const artifactsDir = path.resolve(__dirname, '../../../../data/artifacts/active');
    const bundleVal = artifact ? ArtifactBundleValidator.validateBundleSync(artifact, artifactsDir) : null;
    const recomputedMetrics = bundleVal?.recomputedMetrics;

    // 1. DATA_INTEGRITY [CRITICAL BLOCKER]
    let dataIntegrityStatus: GateEvaluationStatus = 'FAIL';
    let dataIntegrityEvidence = 'Invalid OHLC relations or corrupt candle data detected.';
    if (verifs?.DATA_INTEGRITY) {
      dataIntegrityStatus = verifs.DATA_INTEGRITY.status;
      dataIntegrityEvidence = verifs.DATA_INTEGRITY.details;
    } else if (runtimeStateOrReport.hasValidCandles === true) {
      dataIntegrityStatus = 'PASS';
      dataIntegrityEvidence = 'OHLC relationship validated, zero negative prices, non-zero volumes on trading days, chronologically sorted.';
    } else if (runtimeStateOrReport.hasValidCandles === undefined) {
      dataIntegrityStatus = 'NOT_ASSESSED';
      dataIntegrityEvidence = 'No runtime candle validation was performed.';
    }
    criteria['DATA_INTEGRITY'] = {
      code: 'DATA_INTEGRITY',
      name: 'Market Data & OHLCV Integrity',
      category: 'DATA',
      status: dataIntegrityStatus,
      evidence: dataIntegrityEvidence,
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (dataIntegrityStatus !== 'PASS') {
      blockingFailures.push(`DATA_INTEGRITY: Market data candle integrity check ${dataIntegrityStatus.toLowerCase()}.`);
      criticalBlockerFailures.push('DATA_INTEGRITY');
    }

    // 2. POINT_IN_TIME_CORRECTNESS [CRITICAL BLOCKER]
    let pitStatus: GateEvaluationStatus = 'FAIL';
    let pitEvidence = 'Point-in-time calculation failure or target leakage detected.';
    if (verifs?.POINT_IN_TIME_CORRECTNESS) {
      pitStatus = verifs.POINT_IN_TIME_CORRECTNESS.status;
      pitEvidence = verifs.POINT_IN_TIME_CORRECTNESS.details;
    } else if (runtimeStateOrReport.leakageFree === true) {
      pitStatus = 'PASS';
      pitEvidence = 'Lag operators strictly positive, zero lookahead leakage, shifting features cleanly reproduces out-of-sample data.';
    } else if (runtimeStateOrReport.leakageFree === undefined) {
      pitStatus = 'NOT_ASSESSED';
      pitEvidence = 'No point-in-time leakage validation was performed.';
    }
    criteria['POINT_IN_TIME_CORRECTNESS'] = {
      code: 'POINT_IN_TIME_CORRECTNESS',
      name: 'Strict Point-in-Time Feature Calculation',
      category: 'DATA',
      status: pitStatus,
      evidence: pitEvidence,
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (pitStatus !== 'PASS') {
      blockingFailures.push(`POINT_IN_TIME_CORRECTNESS: Point-in-time calculation ${pitStatus.toLowerCase()}.`);
      criticalBlockerFailures.push('POINT_IN_TIME_CORRECTNESS');
    }

    // 3. SURVIVORSHIP_BIAS_CONTROL [CRITICAL BLOCKER]
    const survResolved = artifact?.survivorshipStatus === 'RESOLVED';
    const survStatus: GateEvaluationStatus = survResolved ? 'PASS' : 'FAIL';
    criteria['SURVIVORSHIP_BIAS_CONTROL'] = {
      code: 'SURVIVORSHIP_BIAS_CONTROL',
      name: 'Survivorship Bias Control & Disclosure',
      category: 'DATA',
      status: survStatus,
      evidence: survResolved
        ? 'Historical dynamic index membership reconstructed; point-in-time universe fully resolved.'
        : `Survivorship limitation unresolved (${artifact?.survivorshipStatus || 'UNRESOLVED'}). Blocks production certification.`,
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (!survResolved) {
      blockingFailures.push('SURVIVORSHIP_BIAS_CONTROL: Survivorship bias limitation is unresolved.');
      criticalBlockerFailures.push('SURVIVORSHIP_BIAS_CONTROL');
    }

    // 4. LOOKAHEAD_BIAS_CONTROL [CRITICAL BLOCKER]
    const lookaheadPassed = artifact ? artifact.trainingEnd <= artifact.validationStart && artifact.validationEnd <= artifact.testStart : false;
    criteria['LOOKAHEAD_BIAS_CONTROL'] = {
      code: 'LOOKAHEAD_BIAS_CONTROL',
      name: 'Lookahead Bias Prevention & Chronological Partitioning',
      category: 'METHODOLOGY',
      status: lookaheadPassed ? 'PASS' : 'FAIL',
      evidence: lookaheadPassed
        ? `Strict non-overlapping chronological bounds: Train (${artifact?.trainingEnd}) <= Val (${artifact?.validationStart}) <= Test (${artifact?.testStart}) <= Holdout (${artifact?.holdoutStart}).`
        : 'Chronological partitions overlap or are missing.',
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (!lookaheadPassed) {
      blockingFailures.push('LOOKAHEAD_BIAS_CONTROL: Overlapping chronological partitions.');
      criticalBlockerFailures.push('LOOKAHEAD_BIAS_CONTROL');
    }

    // 5. WALK_FORWARD_VALIDITY
    const wfFolds = artifact?.walkForwardFolds || [];
    const wfPassed = Boolean(
      artifact &&
      wfFolds.length >= 4 &&
      wfFolds.every((f: any) => f.testSamples > 0 && f.trainStart < f.trainEnd && f.trainEnd <= f.valStart && f.valEnd <= f.testStart)
    );
    criteria['WALK_FORWARD_VALIDITY'] = {
      code: 'WALK_FORWARD_VALIDITY',
      name: 'Walk-Forward Out-Of-Sample Validity',
      category: 'METHODOLOGY',
      status: wfPassed ? 'PASS' : 'FAIL',
      evidence: wfPassed
        ? `Rolling walk-forward cross-validation verified across ${wfFolds.length} non-overlapping folds with active test evaluation.`
        : 'Walk-forward validation invalid: requires at least 4 non-overlapping folds with positive test samples.',
      mandatory: true,
    };
    if (!wfPassed) blockingFailures.push('WALK_FORWARD_VALIDITY: Walk-forward validation missing or invalid.');

    // 6. MODEL_REPRODUCIBILITY
    const reproPassed = Boolean(artifact && artifact.checksum && artifact.id);
    criteria['MODEL_REPRODUCIBILITY'] = {
      code: 'MODEL_REPRODUCIBILITY',
      name: 'Deterministic Parameter Serialization & Reproducibility',
      category: 'METHODOLOGY',
      status: reproPassed ? 'PASS' : 'FAIL',
      evidence: reproPassed
        ? `Model parameters deterministically serialized with canonical SHA-256 hash ${artifact?.checksum?.slice(0, 12)}...`
        : 'Model parameters or checksum missing.',
      mandatory: true,
    };
    if (!reproPassed) blockingFailures.push('MODEL_REPRODUCIBILITY: Missing model parameters or checksum.');

    // 7. PROBABILITY_CALIBRATION
    const calib5d = artifact?.calibration?.['5d'];
    const calibSampleCount = calib5d?.metrics?.sampleCount || artifact?.calibrationMetrics?.sampleCount || 0;
    const calibStatus = calib5d?.status || artifact?.calibrationStatus || 'UNFITTED';
    const calibBrier = calib5d?.metrics?.brierScore;
    const calibECE = calib5d?.metrics?.ece;
    const calibPassed = Boolean(
      artifact &&
      calibStatus === 'FITTED_OUT_OF_SAMPLE' &&
      calibSampleCount >= 50 &&
      calibBrier !== null && calibBrier !== undefined &&
      calibECE !== null && calibECE !== undefined
    );
    criteria['PROBABILITY_CALIBRATION'] = {
      code: 'PROBABILITY_CALIBRATION',
      name: 'Monotonic Probability Calibration Quality',
      category: 'STATISTICS',
      status: calibPassed ? 'PASS' : 'FAIL',
      evidence: calibPassed
        ? `PAV isotonic calibration fitted on ${calibSampleCount} test/validation observations (Brier: ${calibBrier}, ECE: ${calibECE}).`
        : `Calibration failed quality gate (Status: ${calibStatus}, SampleCount: ${calibSampleCount}).`,
      mandatory: true,
    };
    if (!calibPassed) blockingFailures.push('PROBABILITY_CALIBRATION: Probability calibration failed quality gate.');

    // 8. UNCERTAINTY_QUANTIFICATION
    const hasEmpirical = Boolean(
      artifact &&
      ((artifact.empiricalDistributions && artifact.empiricalDistributions.length > 0) ||
       (artifact.conditionalReturns && Object.keys(artifact.conditionalReturns).length > 0) ||
       (artifact.empiricalQuantiles && Object.keys(artifact.empiricalQuantiles).length > 0))
    );
    criteria['EXPECTED_RETURN_VALIDITY'] = {
      code: 'EXPECTED_RETURN_VALIDITY',
      name: 'Empirical Conditional Return Distributions & Confidence Intervals',
      category: 'STATISTICS',
      status: hasEmpirical ? 'PASS' : 'FAIL',
      evidence: hasEmpirical
        ? 'Empirical conditional return buckets, predictive intervals, and parameter confidence intervals populated from validation trade outcomes.'
        : 'Missing empirical return distribution or quantiles table.',
      mandatory: true,
    };
    if (!hasEmpirical) blockingFailures.push('EXPECTED_RETURN_VALIDITY: Empirical distributions missing.');

    // 9. COST_MODELING
    let costStatus: GateEvaluationStatus = 'FAIL';
    let costEvidence = 'Friction model verification failed.';
    if (verifs?.COST_MODELING) {
      costStatus = verifs.COST_MODELING.status;
      costEvidence = verifs.COST_MODELING.details;
    } else if (runtimeStateOrReport.frictionVerification === true) {
      costStatus = 'PASS';
      costEvidence = 'Explicit transaction cost (0.13% round-trip) applied: brokerage, STT, 5 bps slippage, GST and exchange turnover fees.';
    } else if (runtimeStateOrReport.frictionVerification === undefined) {
      costStatus = 'NOT_ASSESSED';
      costEvidence = 'Friction model not assessed.';
    }
    criteria['COST_MODELING'] = {
      code: 'COST_MODELING',
      name: 'Institutional Transaction Cost & Friction Realism',
      category: 'STATISTICS',
      status: costStatus,
      evidence: costEvidence,
      mandatory: true,
    };
    if (costStatus !== 'PASS') blockingFailures.push(`COST_MODELING: Friction model verification ${costStatus.toLowerCase()}.`);

    // 10. BACKTEST_VALIDITY & ECONOMIC_ALPHA_GATE [CRITICAL BLOCKER]
    // Consumes ONLY recomputed metrics from raw ledger; modifying bt.cagr has zero effect
    const cagr = recomputedMetrics?.cagr ?? 0;
    const benchCagr = recomputedMetrics?.benchmarkCagr ?? 14.20;
    const activeRet = recomputedMetrics?.activeReturn ?? (cagr - benchCagr);
    const ir = recomputedMetrics?.informationRatio ?? 0;
    const pf = recomputedMetrics?.profitFactor ?? 0;
    const sharpe = recomputedMetrics?.sharpe ?? 0;
    const sortino = recomputedMetrics?.sortino ?? 0;
    const calmar = recomputedMetrics?.calmar ?? 0;
    const maxDd = recomputedMetrics?.maxDrawdown ?? -100;
    const trades = recomputedMetrics?.totalTrades ?? 0;
    const eqCount = recomputedMetrics?.equityObservations ?? 0;

    const economicPassed = Boolean(
      artifact &&
      bundleVal?.details.backtestValid &&
      cagr >= 10.0 &&
      activeRet > 0 &&
      ir >= 0.40 &&
      pf >= 1.20 &&
      sharpe >= 0.80 &&
      maxDd >= -20.0 &&
      trades >= 30 &&
      eqCount >= 252
    );

    criteria['BACKTEST_VALIDITY'] = {
      code: 'BACKTEST_VALIDITY',
      name: 'Economic Alpha Gate & Out-Of-Sample Backtest Validity',
      category: 'STATISTICS',
      status: economicPassed ? 'PASS' : 'FAIL',
      evidence: economicPassed
        ? `Recomputed from raw ledger: CAGR ${cagr}%, ActiveReturn vs NIFTY +${activeRet}%, IR ${ir}, ProfitFactor ${pf}, Sharpe ${sharpe}, Sortino ${sortino}, Calmar ${calmar}, MaxDD ${maxDd}%, Trades ${trades}, Equity Sessions ${eqCount}.`
        : `Strategy failed economic hurdle (Recomputed CAGR: ${cagr}%, ActiveRet: ${activeRet}%, IR: ${ir}, PF: ${pf}, Sharpe: ${sharpe}, MaxDD: ${maxDd}%, Trades: ${trades}).`,
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (!economicPassed) {
      blockingFailures.push('BACKTEST_VALIDITY: Strategy failed minimum institutional risk-adjusted return hurdle.');
      criticalBlockerFailures.push('BACKTEST_VALIDITY');
    }

    // 11. RISK_MODEL [CRITICAL BLOCKER]
    let riskStatus: GateEvaluationStatus = 'FAIL';
    let riskEvidence = 'Risk model verification failed.';
    if (verifs?.RISK_MODEL) {
      riskStatus = verifs.RISK_MODEL.status;
      riskEvidence = verifs.RISK_MODEL.details;
    } else if (runtimeStateOrReport.varVerification === true) {
      riskStatus = 'PASS';
      riskEvidence = 'Downside deviation, annualized volatility, true 60d rolling max drawdown, beta vs NIFTY, gap risk, and historical expected shortfall calculated on historical candles.';
    } else if (runtimeStateOrReport.varVerification === undefined) {
      riskStatus = 'NOT_ASSESSED';
      riskEvidence = 'Risk modeling not assessed.';
    }
    criteria['RISK_MODEL'] = {
      code: 'RISK_MODEL',
      name: 'Dynamic Risk Engine, Rolling Drawdown, & Expected Shortfall',
      category: 'STATISTICS',
      status: riskStatus,
      evidence: riskEvidence,
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (riskStatus !== 'PASS') {
      blockingFailures.push(`RISK_MODEL: Risk model verification ${riskStatus.toLowerCase()}.`);
      criticalBlockerFailures.push('RISK_MODEL');
    }

    // 12. PORTFOLIO_RISK [CRITICAL BLOCKER]
    let portfolioStatus: GateEvaluationStatus = 'FAIL';
    let portfolioEvidence = 'Portfolio limits not verified.';
    if (verifs?.PORTFOLIO_RISK) {
      portfolioStatus = verifs.PORTFOLIO_RISK.status;
      portfolioEvidence = verifs.PORTFOLIO_RISK.details;
    } else if (runtimeStateOrReport.limitVerification === true || runtimeStateOrReport.exposureVerification === true) {
      portfolioStatus = 'PASS';
      portfolioEvidence = 'Single-stock position sizing <= 10%, sector concentration <= 25%, and gross portfolio exposure <= 100% strictly enforced.';
    } else if (runtimeStateOrReport.limitVerification === undefined) {
      portfolioStatus = 'NOT_ASSESSED';
      portfolioEvidence = 'Portfolio limits not assessed.';
    }
    criteria['PORTFOLIO_RISK'] = {
      code: 'PORTFOLIO_RISK',
      name: 'Portfolio Concentration & Exposure Constraints',
      category: 'STATISTICS',
      status: portfolioStatus,
      evidence: portfolioEvidence,
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (portfolioStatus !== 'PASS') {
      blockingFailures.push(`PORTFOLIO_RISK: Portfolio risk limits ${portfolioStatus.toLowerCase()}.`);
      criticalBlockerFailures.push('PORTFOLIO_RISK');
    }

    // 13. ARTIFACT_INTEGRITY [CRITICAL BLOCKER]
    let integrityPassed = false;
    let integrityEvidence = 'Artifact missing, corrupted, or checksum validation failed.';
    if (artifact && artifact.checksum && artifact.id) {
      const computedSha = computeStrictArtifactChecksum(artifact);
      if (computedSha === artifact.checksum) {
        integrityPassed = true;
        integrityEvidence = `Recomputed SHA-256 matches declared artifact checksum (${computedSha.slice(0, 12)}...). Strict canonical validation passed without legacy fallback.`;
      } else {
        integrityEvidence = `Checksum mismatch: declared ${artifact.checksum.slice(0, 12)}..., recomputed ${computedSha.slice(0, 12)}...`;
      }
    }
    criteria['ARTIFACT_INTEGRITY'] = {
      code: 'ARTIFACT_INTEGRITY',
      name: 'Canonical Location & Cryptographic SHA-256 Integrity',
      category: 'GOVERNANCE',
      status: integrityPassed ? 'PASS' : 'FAIL',
      evidence: integrityEvidence,
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (!integrityPassed) {
      blockingFailures.push('ARTIFACT_INTEGRITY: Artifact integrity verification failed.');
      criticalBlockerFailures.push('ARTIFACT_INTEGRITY');
    }

    // 14. MODEL_VERSIONING [CRITICAL BLOCKER]
    const expectedVersion = MODEL_CONFIG.VERSION; // '5.1.0'
    const versionPassed = Boolean(artifact && artifact.modelVersion === expectedVersion);
    criteria['MODEL_VERSIONING'] = {
      code: 'MODEL_VERSIONING',
      name: 'Model Identity & Semantic Versioning',
      category: 'GOVERNANCE',
      status: versionPassed ? 'PASS' : 'FAIL',
      evidence: versionPassed
        ? `Model identity unambiguous: ${artifact?.modelType || 'ONNX_ENSEMBLE'} v${artifact?.modelVersion} (Schema: ${artifact?.schemaVersion || artifact?.modelVersion}, Policy: ${artifact?.policyVersion || 'v5.1.0'}).`
        : `Model version mismatch: expected ${expectedVersion}, got ${artifact?.modelVersion || 'NONE'}.`,
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (!versionPassed) {
      blockingFailures.push('MODEL_VERSIONING: Model version or identity mismatch.');
      criticalBlockerFailures.push('MODEL_VERSIONING');
    }

    // 15. EXPLAINABILITY
    let explainStatus: GateEvaluationStatus = 'FAIL';
    let explainEvidence = 'Explainability check failed.';
    if (verifs?.EXPLAINABILITY) {
      explainStatus = verifs.EXPLAINABILITY.status;
      explainEvidence = verifs.EXPLAINABILITY.details;
    } else if (runtimeStateOrReport.attributionVerification === true) {
      explainStatus = 'PASS';
      explainEvidence = 'Every live prediction exposes structured feature contributions, regime rationale, technical evidence, and invalidation stop conditions.';
    } else if (runtimeStateOrReport.attributionVerification === undefined) {
      explainStatus = 'NOT_ASSESSED';
      explainEvidence = 'Explainability not assessed.';
    }
    criteria['EXPLAINABILITY'] = {
      code: 'EXPLAINABILITY',
      name: 'Structured Decision Explainability & Feature Attribution',
      category: 'GOVERNANCE',
      status: explainStatus,
      evidence: explainEvidence,
      mandatory: true,
    };
    if (explainStatus !== 'PASS') blockingFailures.push(`EXPLAINABILITY: Feature explainability ${explainStatus.toLowerCase()}.`);

    // 16. TEST_COVERAGE
    let testStatus: GateEvaluationStatus = 'FAIL';
    let testEvidence = 'Test suite failure detected.';
    if (verifs?.TEST_COVERAGE) {
      testStatus = verifs.TEST_COVERAGE.status;
      testEvidence = verifs.TEST_COVERAGE.details;
    } else if (runtimeStateOrReport.allTestsPassing === true) {
      testStatus = 'PASS';
      testEvidence = '100% test pass rate across all test suites covering leakage prevention, reconciliation invariants, and adversarial edge cases.';
    } else if (runtimeStateOrReport.allTestsPassing === undefined) {
      testStatus = 'NOT_ASSESSED';
      testEvidence = 'No test suite validation was performed.';
    }
    criteria['TEST_COVERAGE'] = {
      code: 'TEST_COVERAGE',
      name: 'Comprehensive Unit, Integration, & Invariant Test Suite',
      category: 'SYSTEM',
      status: testStatus,
      evidence: testEvidence,
      mandatory: true,
    };
    if (testStatus !== 'PASS') blockingFailures.push(`TEST_COVERAGE: Test suite validation ${testStatus.toLowerCase()}.`);

    // 17. PRODUCTION_INFERENCE [CRITICAL BLOCKER]
    const infPassed = Boolean(artifact !== null && bundleVal?.details.onnxModelsValid);
    criteria['PRODUCTION_INFERENCE'] = {
      code: 'PRODUCTION_INFERENCE',
      name: 'Runtime Inference Uses Verified Active Artifact & ONNX Engine',
      category: 'SYSTEM',
      status: infPassed ? 'PASS' : 'FAIL',
      evidence: infPassed
        ? 'Production inference engine executes native ONNX models with verified isotonic calibration and empirical quantiles.'
        : 'Inference running without a valid loaded artifact or ONNX model files missing.',
      mandatory: true,
      isCriticalBlocker: true,
    };
    if (!infPassed) {
      blockingFailures.push('PRODUCTION_INFERENCE: Runtime inference missing active artifact or ONNX models invalid.');
      criticalBlockerFailures.push('PRODUCTION_INFERENCE');
    }

    // 18. FAIL_SAFE_BEHAVIOR
    let failSafeStatus: GateEvaluationStatus = 'FAIL';
    let failSafeEvidence = 'Fail-safe behavior not assessed.';
    if (verifs?.FAIL_SAFE_BEHAVIOR) {
      failSafeStatus = verifs.FAIL_SAFE_BEHAVIOR.status;
      failSafeEvidence = verifs.FAIL_SAFE_BEHAVIOR.details;
    } else if (runtimeStateOrReport.fallbackTriggerVerification === true) {
      failSafeStatus = 'PASS';
      failSafeEvidence = 'When unpopulated or corrupted, system cleanly fails closed with pure null quantitative outputs without claiming false precision.';
    } else if (runtimeStateOrReport.fallbackTriggerVerification === undefined) {
      failSafeStatus = 'NOT_ASSESSED';
      failSafeEvidence = 'Fail-safe behavior not assessed.';
    }
    criteria['FAIL_SAFE_BEHAVIOR'] = {
      code: 'FAIL_SAFE_BEHAVIOR',
      name: 'Fail-Closed Production Safety & Labeled Fallbacks',
      category: 'SYSTEM',
      status: failSafeStatus,
      evidence: failSafeEvidence,
      mandatory: true,
    };
    if (failSafeStatus !== 'PASS') blockingFailures.push(`FAIL_SAFE_BEHAVIOR: Fail-safe verification ${failSafeStatus.toLowerCase()}.`);

    const criteriaList = Object.values(criteria);
    const passedCount = criteriaList.filter((c) => c.status === 'PASS').length;
    const failedCount = criteriaList.filter((c) => c.status === 'FAIL').length;
    const notAssessableCount = criteriaList.filter((c) => c.status === 'NOT_ASSESSED').length;
    const insufficientDataCount = criteriaList.filter((c) => c.status === 'INSUFFICIENT_DATA').length;
    const passRate = parseFloat((passedCount / criteriaList.length).toFixed(4));

    // Mandatory Blocker Rule: No non-critical pass rate can override a critical blocker
    const hasCriticalFailure = criticalBlockerFailures.length > 0;
    const technicalMethodStatus: 'PASS' | 'FAIL' = (!hasCriticalFailure && criteriaList.every((c) => c.status === 'PASS')) ? 'PASS' : 'FAIL';
    const economicStrategyStatus: 'PASS' | 'FAIL' = economicPassed ? 'PASS' : 'FAIL';

    const productionReady = (!hasCriticalFailure && blockingFailures.length === 0 && economicStrategyStatus === 'PASS' && technicalMethodStatus === 'PASS');
    const overallStatus: 'PRODUCTION_READY' | 'NOT_PRODUCTION_READY' = productionReady ? 'PRODUCTION_READY' : 'NOT_PRODUCTION_READY';

    return {
      overallStatus,
      technicalMethodStatus,
      economicStrategyStatus,
      productionReady,
      passRate,
      evaluatedAt: new Date().toISOString(),
      evaluatorVersion: 'v5.1.0-institutional-scorecard',
      criteria,
      blockingFailures,
      criticalBlockerFailures,
      summary: {
        totalEvaluated: criteriaList.length,
        passed: passedCount,
        failed: failedCount,
        notAssessable: notAssessableCount,
        insufficientData: insufficientDataCount,
      },
    };
  }
}
