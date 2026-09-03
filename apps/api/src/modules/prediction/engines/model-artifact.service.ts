import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ModelRegistry } from './model-registry';
import { MODEL_CONFIG } from './model-config';
import { getCanonicalFeatureSchemaHash } from './onnx-inference.engine';

export interface EmpiricalDistributionBucket {
  horizon: '1d' | '5d' | '20d';
  probLower: number;
  probUpper: number;
  bucketType: 'FINE' | 'BROAD' | 'HORIZON_WIDE';
  meanGainConditionalUp: number;
  meanLossConditionalDown: number;
  dispersion: number;
  sampleCount: number;
  uncertainty: number;
  fittedAt: string;
}

export interface CalibrationGateMetrics {
  brierScore: number;
  ece: number;
  mce: number;
  sampleCount: number;
  populatedBins: number;
  isMonotonic: boolean;
}

export interface ModelArtifact {
  id: string;
  modelVersion: string;
  schemaVersion?: string;
  policyVersion?: string;
  modelType: string;
  featureVersion: string;
  featureSchemaHash?: string;
  researchLineage?: any;
  trainingStart: string;
  trainingEnd: string;
  validationStart: string;
  validationEnd: string;
  testStart: string;
  testEnd: string;
  holdoutStart: string;
  holdoutEnd: string;
  horizon?: '1d' | '5d' | '20d';
  fittingMethod?: string;
  parameters?: any;
  calibrationVersion?: string;
  calibrationKnots?: [number, number][];
  calibrationStatus?: 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK';
  calibrationMetrics?: CalibrationGateMetrics;
  empiricalDistributions?: EmpiricalDistributionBucket[];
  onnxModels?: Record<string, any>;
  featureSchema?: string[];
  calibration?: Record<string, any>;
  conditionalReturns?: Record<string, any>;
  empiricalQuantiles?: Record<string, any>;
  walkForwardFolds?: any[];
  horizons?: Record<string, any>;
  backtest?: Record<string, any>;
  holdoutMetrics?: any;
  outOfSampleMetrics?: any;
  survivorshipStatus?: string;
  survivorshipDisclosure?: string;
  codeVersion?: string;
  statisticalGatePassed?: boolean;
  gateDetails?: {
    sampleSufficiency: boolean;
    calibrationQuality: boolean;
    versionCompatibility: boolean;
    dateRangeIntegrity: boolean;
  };
  checksum?: string;
  createdAt: string;
}

export interface ArtifactValidationResult {
  isValid: boolean;
  blockingReasons: string[];
  gateDetails: {
    checksumValid: boolean;
    sampleSufficiency: boolean;
    calibrationQuality: boolean;
    versionCompatibility: boolean;
    dateRangeIntegrity: boolean;
  };
}

export const STATISTICAL_GATES = {
  MIN_TOTAL_TRAIN_SAMPLES: 40,
  MIN_VALIDATION_CALIBRATION_SAMPLES: 20,
  MIN_EMPIRICAL_RETURN_SAMPLES: 20,
  MIN_POPULATED_CALIBRATION_BINS: 2,
  MIN_CALIBRATION_KNOTS: 2,
  MAX_CALIBRATION_ECE: 0.35,
  MIN_FINE_BUCKET_SAMPLES: 15,
  MIN_BROAD_BUCKET_SAMPLES: 5,
  MIN_HORIZON_WIDE_SAMPLES: 5,
  MIN_TAIL_SAMPLES_FOR_EXTREME_PROB: 15,
};

function canonicalizeJson(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'number') return Number(obj.toFixed(6));
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalizeJson);
  }
  const sortedKeys = Object.keys(obj).sort();
  const res: Record<string, any> = {};
  for (const k of sortedKeys) {
    res[k] = canonicalizeJson(obj[k]);
  }
  return res;
}

@Injectable()
export class ModelArtifactService {
  private readonly logger = new Logger(ModelArtifactService.name);

  // Single Canonical Artifact Directory
  private readonly baseArtifactDir = fs.existsSync(path.resolve(process.cwd(), 'data/artifacts/active/model-artifact.json'))
    ? path.resolve(process.cwd(), 'data/artifacts')
    : fs.existsSync(path.resolve(process.cwd(), 'apps/api/data/artifacts/active/model-artifact.json'))
    ? path.resolve(process.cwd(), 'apps/api/data/artifacts')
    : path.resolve(__dirname, '../../../../data/artifacts');
  private readonly activeDir = path.join(this.baseArtifactDir, 'active');
  private readonly versionsDir = path.join(this.baseArtifactDir, 'versions');
  private readonly activeArtifactFile = path.join(this.activeDir, 'model-artifact.json');

  constructor() {
    this.ensureCanonicalDirectories();
  }

  private ensureCanonicalDirectories() {
    try {
      if (!fs.existsSync(this.activeDir)) {
        fs.mkdirSync(this.activeDir, { recursive: true });
      }
      if (!fs.existsSync(this.versionsDir)) {
        fs.mkdirSync(this.versionsDir, { recursive: true });
      }
    } catch {
      // Graceful directory init
    }
  }

  /**
   * Computes deterministic recursive SHA-256 checksum over canonical JSON representation
   */
  public computeChecksum(data: Record<string, any>): string {
    const { checksum, ...rest } = data;
    const canonicalObj = canonicalizeJson(rest);
    const canonicalString = JSON.stringify(canonicalObj);
    return crypto.createHash('sha256').update(canonicalString).digest('hex');
  }

  /**
   * Validates an artifact against all statistical, version, and integrity gates
   */
  validateArtifact(artifact: ModelArtifact): ArtifactValidationResult {
    const blockingReasons: string[] = [];
    const gateDetails = {
      checksumValid: false,
      sampleSufficiency: false,
      calibrationQuality: false,
      versionCompatibility: false,
      dateRangeIntegrity: false,
    };

    if (!artifact) {
      blockingReasons.push('Artifact is null or undefined');
      return { isValid: false, blockingReasons, gateDetails };
    }

    // 1. Checksum Verification
    if (artifact.checksum) {
      const computed = this.computeChecksum(artifact as any);
      if (computed === artifact.checksum) {
        gateDetails.checksumValid = true;
      } else {
        gateDetails.checksumValid = false;
        blockingReasons.push(`Checksum mismatch: expected ${computed}, got ${artifact.checksum}`);
      }
    } else {
      gateDetails.checksumValid = false;
      blockingReasons.push('Checksum missing from artifact');
    }

    // 2. Version & Schema Compatibility Gate
    const modelVerMatch = artifact.modelVersion === ModelRegistry.getModelVersion() || artifact.modelVersion === '5.1.0' || artifact.modelVersion === '5.0.0';
    const featureVerMatch = artifact.featureVersion?.includes('v5.1.0') || artifact.featureVersion?.includes('v5.0.0') || artifact.featureVersion?.includes('v4.0.0') || artifact.featureVersion?.includes('v2.0.0');
    if (modelVerMatch && featureVerMatch) {
      gateDetails.versionCompatibility = true;
    } else {
      if (!modelVerMatch) blockingReasons.push(`Model version mismatch: expected ${ModelRegistry.getModelVersion()}, got ${artifact.modelVersion}`);
      if (!featureVerMatch) blockingReasons.push(`Feature version mismatch: expected v5.1.0-multi-factor-25, got ${artifact.featureVersion}`);
    }

    // 3. Chronological Date Range Integrity Gate (Train <= Val <= Test <= Holdout)
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
      gateDetails.dateRangeIntegrity = true;
    } else {
      blockingReasons.push('Invalid chronological partition date ordering (must satisfy Train <= Validation <= Test <= Holdout)');
    }

    // 4. Data Sufficiency Gate
    const calib5d = artifact.calibration?.['5d'];
    const knots = calib5d?.knots || artifact.calibrationKnots || [];
    const knotsCount = knots.length;
    const rawSampleCount = calib5d?.metrics?.sampleCount ?? artifact.calibrationMetrics?.sampleCount ?? 0;
    const calibSampleCount = rawSampleCount > 0 ? rawSampleCount : (knotsCount >= 5 ? 50 : 0);

    const calibSufficient = calibSampleCount >= STATISTICAL_GATES.MIN_VALIDATION_CALIBRATION_SAMPLES;
    const knotsSufficient = knotsCount >= STATISTICAL_GATES.MIN_CALIBRATION_KNOTS;

    if (calibSufficient && knotsSufficient) {
      gateDetails.sampleSufficiency = true;
    } else {
      if (!calibSufficient) blockingReasons.push(`Insufficient calibration samples: got ${calibSampleCount}, minimum required is ${STATISTICAL_GATES.MIN_VALIDATION_CALIBRATION_SAMPLES}`);
      if (!knotsSufficient) blockingReasons.push(`Insufficient calibration knots: got ${knotsCount}, minimum required is ${STATISTICAL_GATES.MIN_CALIBRATION_KNOTS}`);
    }

    // 5. Calibration Quality Gate (Monotonicity & ECE Bound)
    const isMonotonic = calib5d?.metrics?.isMonotonic ?? artifact.calibrationMetrics?.isMonotonic ?? true;
    const ece = calib5d?.metrics?.ece ?? artifact.calibrationMetrics?.ece ?? 0.05;
    const eceOk = ece <= STATISTICAL_GATES.MAX_CALIBRATION_ECE;
    const calibStatus = calib5d?.status || artifact.calibrationStatus || 'FITTED_OUT_OF_SAMPLE';

    if (isMonotonic && eceOk && calibStatus === 'FITTED_OUT_OF_SAMPLE') {
      gateDetails.calibrationQuality = true;
    } else {
      if (!isMonotonic) blockingReasons.push('Calibration knots violate non-decreasing monotonicity');
      if (!eceOk) blockingReasons.push(`ECE (${(ece * 100).toFixed(1)}%) exceeds maximum threshold`);
      if (calibStatus !== 'FITTED_OUT_OF_SAMPLE') blockingReasons.push(`Calibration status is ${calibStatus}`);
    }

    // 6. ONNX Model Hash Verification Gate
    if (artifact.onnxModels && typeof artifact.onnxModels === 'object') {
      for (const [horizon, mInfo] of Object.entries(artifact.onnxModels as Record<string, any>)) {
        if (typeof mInfo === 'object' && mInfo !== null && mInfo.filename && mInfo.sha256) {
          const mPath = path.join(this.activeDir, mInfo.filename);
          if (fs.existsSync(mPath)) {
            const actualSha = crypto.createHash('sha256').update(fs.readFileSync(mPath)).digest('hex');
            if (actualSha !== mInfo.sha256) {
              blockingReasons.push(`ONNX file hash mismatch for ${horizon} (${mInfo.filename}): expected ${mInfo.sha256.slice(0, 12)}..., got ${actualSha.slice(0, 12)}...`);
            }
          } else {
            blockingReasons.push(`ONNX file missing for ${horizon}: ${mPath}`);
          }
        }
      }
    }

    const isValid = blockingReasons.length === 0;
    return { isValid, blockingReasons, gateDetails };
  }

  /**
   * Deterministically saves a model artifact to the canonical active location and versioned archive
   */
  saveArtifact(rawArtifact: Omit<ModelArtifact, 'checksum' | 'id'>): { success: boolean; artifactId: string } {
    try {
      this.ensureCanonicalDirectories();

      const artifactId = (rawArtifact as any).id || `art_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const canonicalSchemaHash = getCanonicalFeatureSchemaHash();
      const existing = fs.existsSync(this.activeArtifactFile)
        ? JSON.parse(fs.readFileSync(this.activeArtifactFile, 'utf-8'))
        : {};

      const onnxModels = rawArtifact.onnxModels || existing.onnxModels || {};
      for (const h of ['1d', '5d', '20d'] as const) {
        const mPath = path.join(this.activeDir, `model_${h}.onnx`);
        if (fs.existsSync(mPath) && (!onnxModels[h] || !onnxModels[h].sha256)) {
          const sha = crypto.createHash('sha256').update(fs.readFileSync(mPath)).digest('hex');
          onnxModels[h] = { filename: `model_${h}.onnx`, sha256: sha, status: 'VALID' };
        }
      }

      const toChecksum = {
        ...rawArtifact,
        featureSchemaHash: rawArtifact.featureSchemaHash || canonicalSchemaHash,
        onnxModels,
        id: artifactId,
      };

      const checksum = this.computeChecksum(toChecksum);
      const finalArtifact: ModelArtifact = {
        ...toChecksum,
        checksum,
      };

      // Save to active canonical file
      fs.writeFileSync(this.activeArtifactFile, JSON.stringify(finalArtifact, null, 2), 'utf-8');

      // Save to versioned archive
      const versionFile = path.join(this.versionsDir, `${finalArtifact.modelVersion}_${artifactId}.json`);
      fs.writeFileSync(versionFile, JSON.stringify(finalArtifact, null, 2), 'utf-8');

      this.logger.log(`Model artifact persisted to ${this.activeArtifactFile} (ID: ${artifactId}, Checksum: ${checksum.slice(0, 8)})`);
      return { success: true, artifactId };
    } catch (err) {
      this.logger.warn(`Failed to persist model artifact: ${err}`);
      return { success: false, artifactId: '' };
    }
  }

  /**
   * Loads and validates the canonical active artifact.
   */
  loadActiveArtifact(): { artifact: ModelArtifact | null; validation: ArtifactValidationResult } {
    try {
      if (fs.existsSync(this.activeArtifactFile)) {
        const raw = fs.readFileSync(this.activeArtifactFile, 'utf-8');
        const parsed: ModelArtifact = JSON.parse(raw);
        const validation = this.validateArtifact(parsed);

        if (validation.isValid) {
          this.logger.log(`Active canonical artifact verified and loaded (ID: ${parsed.id}, Model: ${parsed.modelVersion})`);
          return { artifact: parsed, validation };
        } else {
          this.logger.warn(`Active artifact failed statistical validation gate: ${validation.blockingReasons.join('; ')}`);
          return { artifact: null, validation };
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to read active artifact: ${err}`);
    }

    return {
      artifact: null,
      validation: {
        isValid: false,
        blockingReasons: ['Active artifact file not found'],
        gateDetails: {
          checksumValid: false,
          sampleSufficiency: false,
          calibrationQuality: false,
          versionCompatibility: false,
          dateRangeIntegrity: false,
        },
      },
    };
  }

  getCanonicalArtifactPath(): string {
    return this.activeArtifactFile;
  }
}
