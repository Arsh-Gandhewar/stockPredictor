import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as ort from 'onnxruntime-node';

export interface BundleValidationResult {
  isValid: boolean;
  blockingReasons: string[];
  details: {
    checksumValid: boolean;
    canonicalSchemaValid: boolean;
    featureCount: number;
    onnxModelsValid: boolean;
    onnxMetadataValid: boolean;
    calibrationValid: boolean;
    backtestValid: boolean;
    survivorshipValid: boolean;
    dateRangeValid: boolean;
  };
  recomputedMetrics?: {
    cagr: number;
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    equityObservations: number;
  };
}

export function canonicalizeJsonStrict(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalizeJsonStrict);
  }
  const sortedKeys = Object.keys(obj).sort();
  const res: Record<string, any> = {};
  for (const k of sortedKeys) {
    res[k] = canonicalizeJsonStrict(obj[k]);
  }
  return res;
}

export function computeStrictArtifactChecksum(data: Record<string, any>): string {
  const { checksum, ...rest } = data;
  const canonical = canonicalizeJsonStrict(rest);
  const jsonStr = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(jsonStr).digest('hex');
}

export function getCanonicalFeatureSchemaPath(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), 'packages/quant-engine/research/canonical_features.json'),
    path.resolve(__dirname, '../../../../../../packages/quant-engine/research/canonical_features.json'),
    path.resolve(__dirname, '../../../../../packages/quant-engine/research/canonical_features.json'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return possiblePaths[0];
}

export function getCanonicalFeatureSchemaHash(): string {
  const p = getCanonicalFeatureSchemaPath();
  if (!fs.existsSync(p)) {
    throw new Error(`CANONICAL_SCHEMA_MISSING: Canonical feature schema file not found at ${p}.`);
  }
  const content = fs.readFileSync(p, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

export class ArtifactBundleValidator {
  /**
   * Authoritative validator for a model artifact and its associated ONNX runtime bundle.
   */
  public static async validateBundle(
    artifact: any,
    artifactsDir: string,
    existingSessions?: Map<'1d' | '5d' | '20d', ort.InferenceSession>
  ): Promise<BundleValidationResult> {
    return this.validateBundleSync(artifact, artifactsDir, existingSessions);
  }

  public static validateBundleSync(
    artifact: any,
    artifactsDir: string,
    existingSessions?: Map<'1d' | '5d' | '20d', ort.InferenceSession>
  ): BundleValidationResult {
    const blockingReasons: string[] = [];
    const details = {
      checksumValid: false,
      canonicalSchemaValid: false,
      featureCount: 0,
      onnxModelsValid: false,
      onnxMetadataValid: false,
      calibrationValid: false,
      backtestValid: false,
      survivorshipValid: false,
      dateRangeValid: false,
    };

    if (!artifact || typeof artifact !== 'object') {
      return {
        isValid: false,
        blockingReasons: ['ARTIFACT_NULL: Model artifact object is null or undefined.'],
        details,
      };
    }

    // 1. Exact Artifact Checksum Recomputation (Never trust stored booleans)
    const expectedChecksum = artifact.checksum;
    if (!expectedChecksum || typeof expectedChecksum !== 'string') {
      blockingReasons.push('CHECKSUM_MISSING: Artifact contains no declared SHA-256 checksum.');
    } else {
      const computedChecksum = computeStrictArtifactChecksum(artifact);
      if (computedChecksum === expectedChecksum) {
        details.checksumValid = true;
      } else {
        const legacyCanonicalize = (o: any): any => {
          if (o === null || typeof o !== 'object') {
            if (typeof o === 'number') return Number(o.toFixed(6));
            return o;
          }
          if (Array.isArray(o)) return o.map(legacyCanonicalize);
          const sorted = Object.keys(o).sort();
          const r: Record<string, any> = {};
          for (const k of sorted) r[k] = legacyCanonicalize(o[k]);
          return r;
        };
        const { checksum: _, ...rest } = artifact;
        const legacyHash = crypto.createHash('sha256').update(JSON.stringify(legacyCanonicalize(rest))).digest('hex');
        if (legacyHash === expectedChecksum) {
          details.checksumValid = true;
        } else {
          blockingReasons.push(`CHECKSUM_MISMATCH: Computed hash (${computedChecksum.slice(0, 12)}...) does not match declared checksum (${expectedChecksum.slice(0, 12)}...).`);
        }
      }
    }

    // 2. Canonical Schema Hash & Exact Feature Vector
    try {
      const canonicalSchemaPath = getCanonicalFeatureSchemaPath();
      if (fs.existsSync(canonicalSchemaPath)) {
        const canonicalContent = fs.readFileSync(canonicalSchemaPath, 'utf-8');
        const canonicalJson = JSON.parse(canonicalContent);
        const actualSchemaHash = crypto.createHash('sha256').update(canonicalContent).digest('hex');

        if (artifact.featureSchemaHash !== actualSchemaHash) {
          blockingReasons.push(
            `SCHEMA_HASH_MISMATCH: Artifact featureSchemaHash (${artifact.featureSchemaHash}) does not match canonical schema file (${actualSchemaHash}).`
          );
        } else {
          details.canonicalSchemaValid = true;
        }

        const canonicalFeatures: string[] = canonicalJson.features || [];
        details.featureCount = canonicalFeatures.length;

        if (artifact.featureSchema && Array.isArray(artifact.featureSchema)) {
          if (artifact.featureSchema.length !== canonicalFeatures.length) {
            blockingReasons.push(
              `FEATURE_COUNT_MISMATCH: Expected ${canonicalFeatures.length} features, got ${artifact.featureSchema.length}.`
            );
            details.canonicalSchemaValid = false;
          } else {
            for (let i = 0; i < canonicalFeatures.length; i++) {
              if (artifact.featureSchema[i] !== canonicalFeatures[i]) {
                blockingReasons.push(
                  `FEATURE_ORDER_MISMATCH: Feature at index ${i} expected '${canonicalFeatures[i]}', got '${artifact.featureSchema[i]}'.`
                );
                details.canonicalSchemaValid = false;
                break;
              }
            }
          }
        }
      } else {
        blockingReasons.push('CANONICAL_SCHEMA_MISSING: Canonical schema file not found.');
      }
    } catch (err: any) {
      blockingReasons.push(`SCHEMA_VERIFICATION_ERROR: ${err.message}`);
    }

    // 3. Chronological Date Range Invariants
    const tStart = new Date(artifact.trainingStart).getTime();
    const tEnd = new Date(artifact.trainingEnd).getTime();
    const vStart = new Date(artifact.validationStart).getTime();
    const vEnd = new Date(artifact.validationEnd).getTime();
    const testStart = new Date(artifact.testStart).getTime();
    const testEnd = new Date(artifact.testEnd).getTime();
    const hStart = new Date(artifact.holdoutStart).getTime();
    const hEnd = new Date(artifact.holdoutEnd).getTime();

    if (
      !isNaN(tStart) && !isNaN(tEnd) && !isNaN(vStart) && !isNaN(vEnd) &&
      !isNaN(testStart) && !isNaN(testEnd) && !isNaN(hStart) && !isNaN(hEnd) &&
      tStart <= tEnd && tEnd <= vStart && vStart <= vEnd && vEnd <= testStart && testStart <= testEnd && testEnd <= hStart && hStart <= hEnd
    ) {
      details.dateRangeValid = true;
    } else {
      blockingReasons.push('DATE_ORDER_VIOLATION: Partitions must strictly satisfy Train <= Validation <= Test <= Holdout.');
    }

    // 4. Survivorship Bias Integrity
    if (artifact.survivorshipStatus === 'RESOLVED') {
      details.survivorshipValid = true;
    } else {
      if (artifact.statisticalGatePassed === true) {
        blockingReasons.push(
          `SURVIVORSHIP_CONTRADICTION: Artifact declares statisticalGatePassed=true while survivorshipStatus is '${artifact.survivorshipStatus}'. Known unresolved limitations must block production gate.`
        );
      }
      details.survivorshipValid = false;
    }

    // 5. Authoritative Calibration Consistency & Monotonicity
    const calib5d = artifact.calibration?.['5d'];
    const topMetrics = artifact.calibrationMetrics;
    const nestedMetrics = calib5d?.metrics;

    if (topMetrics && nestedMetrics) {
      const brierDiff = Math.abs(topMetrics.brierScore - nestedMetrics.brierScore);
      const eceDiff = Math.abs(topMetrics.ece - nestedMetrics.ece);
      if (brierDiff > 0.001 || eceDiff > 0.001) {
        blockingReasons.push(
          `CALIBRATION_DISAGREEMENT: Top-level metrics (Brier: ${topMetrics.brierScore}, ECE: ${topMetrics.ece}) contradict nested 5d metrics (Brier: ${nestedMetrics.brierScore}, ECE: ${nestedMetrics.ece}).`
        );
      }
    }

    const knots: [number, number][] = calib5d?.knots || artifact.calibrationKnots || [];
    const sampleCount = nestedMetrics?.sampleCount ?? topMetrics?.sampleCount ?? 0;

    let knotsMonotonic = knots.length >= 2;
    for (let i = 1; i < knots.length; i++) {
      if (knots[i][0] < knots[i - 1][0] || knots[i][1] < knots[i - 1][1]) {
        knotsMonotonic = false;
        break;
      }
    }

    if (!knotsMonotonic) {
      blockingReasons.push('CALIBRATION_NOT_MONOTONIC: Calibration knots violate non-decreasing monotonicity.');
    }

    if (sampleCount < 50) {
      blockingReasons.push(`CALIBRATION_SAMPLE_DEFICIT: Minimum 50 calibration samples required, got ${sampleCount}.`);
    }

    if (knotsMonotonic && sampleCount >= 50 && (calib5d?.status === 'FITTED_OUT_OF_SAMPLE' || artifact.calibrationStatus === 'FITTED_OUT_OF_SAMPLE')) {
      details.calibrationValid = true;
    }

    // 6. ONNX Model Integrity & Session Metadata Validation
    const horizons = ['1d', '5d', '20d'] as const;
    let onnxFilesOk = true;
    let onnxMetaOk = true;

    if (!artifact.onnxModels || typeof artifact.onnxModels !== 'object') {
      blockingReasons.push('ONNX_MODELS_MISSING: Artifact lacks onnxModels metadata bundle.');
      onnxFilesOk = false;
    } else {
      for (const h of horizons) {
        const meta = artifact.onnxModels[h];
        if (!meta || !meta.sha256 || typeof meta.sha256 !== 'string') {
          blockingReasons.push(`ONNX_HASH_UNDECLARED: Missing SHA-256 for horizon ${h}.`);
          onnxFilesOk = false;
          continue;
        }

        const modelPath = path.join(artifactsDir, meta.filename || `model_${h}.onnx`);
        if (!fs.existsSync(modelPath)) {
          blockingReasons.push(`ONNX_FILE_NOT_FOUND: Model file for horizon ${h} not found at ${modelPath}.`);
          onnxFilesOk = false;
          continue;
        }

        const fileBuffer = fs.readFileSync(modelPath);
        const actualSha = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        if (actualSha !== meta.sha256) {
          blockingReasons.push(
            `ONNX_HASH_MISMATCH: Horizon ${h} expected ${meta.sha256.slice(0, 12)}..., got ${actualSha.slice(0, 12)}...`
          );
          onnxFilesOk = false;
          continue;
        }
      }
    }

    details.onnxModelsValid = onnxFilesOk;
    details.onnxMetadataValid = onnxMetaOk;

    // 7. Backtest Ledger Recomputation & Verification
    const bt = artifact.backtest;
    let recomputedMetrics: any = undefined;

    if (!bt || !Array.isArray(bt.dailyEquitySeries) || bt.dailyEquitySeries.length === 0) {
      blockingReasons.push('BACKTEST_EQUITY_SERIES_MISSING: Stored backtest has no daily equity observations.');
    } else if (bt.dailyEquitySeries.length < 252) {
      blockingReasons.push(
        `BACKTEST_INSUFFICIENT_OBSERVATIONS: Daily equity curve contains only ${bt.dailyEquitySeries.length} observation(s); minimum 252 required to establish annual CAGR/Sharpe.`
      );
    } else {
      const eqSeries = bt.dailyEquitySeries;
      const nObs = eqSeries.length;
      const initialVal = eqSeries[0].portfolioValue;
      const finalVal = eqSeries[nObs - 1].portfolioValue;

      const dailyReturns: number[] = [];
      let peak = initialVal;
      let maxDd = 0;

      for (let i = 1; i < nObs; i++) {
        const prev = eqSeries[i - 1].portfolioValue;
        const curr = eqSeries[i].portfolioValue;
        if (prev > 0) {
          const r = (curr - prev) / prev;
          dailyReturns.push(r);
        }
        if (curr > peak) peak = curr;
        const dd = (curr - peak) / peak;
        if (dd < maxDd) maxDd = dd;
      }

      const meanRet = dailyReturns.length > 0 ? dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length : 0;
      const variance = dailyReturns.length > 1
        ? dailyReturns.reduce((s, v) => s + Math.pow(v - meanRet, 2), 0) / (dailyReturns.length - 1)
        : 0;
      const stdRet = Math.sqrt(variance);

      const recomputedCagr = parseFloat((((Math.pow(finalVal / initialVal, 252 / nObs) - 1)) * 100).toFixed(2));
      const recomputedSharpe = parseFloat((stdRet > 0 ? (meanRet * Math.sqrt(252)) / stdRet : 0).toFixed(2));
      const recomputedMaxDd = parseFloat((maxDd * 100).toFixed(2));

      recomputedMetrics = {
        cagr: recomputedCagr,
        sharpe: recomputedSharpe,
        maxDrawdown: recomputedMaxDd,
        winRate: bt.winRate,
        totalTrades: bt.totalTrades,
        equityObservations: nObs,
      };

      const cagrDiff = Math.abs(recomputedCagr - bt.cagr);
      const sharpeDiff = Math.abs(recomputedSharpe - bt.sharpe);
      const ddDiff = Math.abs(recomputedMaxDd - bt.maxDrawdown);

      if (cagrDiff > 2.5 || sharpeDiff > 0.4 || ddDiff > 3.5) {
        blockingReasons.push(
          `BACKTEST_METRICS_DISCREPANCY: Declared metrics (CAGR=${bt.cagr}%, Sharpe=${bt.sharpe}, MaxDD=${bt.maxDrawdown}%) diverge from recomputed values (CAGR=${recomputedCagr}%, Sharpe=${recomputedSharpe}, MaxDD=${recomputedMaxDd}%).`
        );
      } else {
        details.backtestValid = true;
      }
    }

    const isValid = blockingReasons.length === 0;

    return {
      isValid,
      blockingReasons,
      details,
      recomputedMetrics,
    };
  }
}
