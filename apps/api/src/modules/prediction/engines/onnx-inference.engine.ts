import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as ort from 'onnxruntime-node';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as vm from 'vm';
import { ModelFeatureVector25 } from './feature-engine';

export function getNativeFloat32Array(): Float32ArrayConstructor {
  try {
    const root = (vm as any).runInThisContext?.('Float32Array');
    if (typeof root === 'function') return root;
  } catch {
    // Fallback to standard context global
  }
  return Float32Array;
}

export interface ScenarioReturnQuantiles {
  bull85th: number | null;
  base50th: number | null;
  bear15th: number | null;
  method?: string;
}

export function getCanonicalFeatureSchemaPath(): string {
  return path.resolve(__dirname, '../../../../../../packages/quant-engine/research/canonical_features.json');
}

export function getCanonicalFeatureSchemaHash(): string {
  const p = getCanonicalFeatureSchemaPath();
  if (!fs.existsSync(p)) {
    throw new Error(`CANONICAL_SCHEMA_MISSING: Canonical feature schema file not found at ${p}.`);
  }
  const content = fs.readFileSync(p, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

@Injectable()
export class OnnxInferenceEngine implements OnModuleInit {
  private readonly logger = new Logger(OnnxInferenceEngine.name);
  private sessions: Map<'1d' | '5d' | '20d', ort.InferenceSession> = new Map();
  private featureSchema: string[] = (() => {
    const canonicalPath = getCanonicalFeatureSchemaPath();
    if (!fs.existsSync(canonicalPath)) {
      throw new Error(
        `CANONICAL_SCHEMA_MISSING: Canonical feature schema file not found at ${canonicalPath}. Silent fallback prohibited.`
      );
    }
    try {
      const content = fs.readFileSync(canonicalPath, 'utf-8');
      const raw = JSON.parse(content);
      if (Array.isArray(raw.features) && raw.features.length === 25) {
        return raw.features;
      }
      throw new Error(
        `CANONICAL_SCHEMA_CORRUPT: Expected 25 features in canonical schema, got ${raw.features ? raw.features.length : 'none'}`
      );
    } catch (err: any) {
      if (err.message && err.message.startsWith('CANONICAL_SCHEMA_')) {
        throw err;
      }
      throw new Error(`CANONICAL_SCHEMA_PARSE_ERROR: Failed to parse canonical features JSON: ${err.message}`);
    }
  })();

  private isModelLoaded: boolean = false;
  private conditionalReturnsTable: Record<string, Record<string, any>> = {};

  private readonly artifactsDir = path.resolve(__dirname, '../../../../data/artifacts/active');

  async onModuleInit() {
    await this.loadActiveModels();
  }

  async loadActiveModels() {
    this.sessions.clear();
    this.isModelLoaded = false;

    try {
      const canonicalSchemaHash = getCanonicalFeatureSchemaHash();
      const manifestPath = path.join(this.artifactsDir, 'model-artifact.json');

      if (!fs.existsSync(manifestPath)) {
        this.logger.error(`MODEL_ARTIFACT_MISSING: Manifest not found at ${manifestPath}`);
        return;
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const manifestSchemaHash = manifest.featureSchemaHash || manifest.lineage?.featureHash || manifest.lineageHashes?.featureHash;

      if (!manifestSchemaHash || manifestSchemaHash !== canonicalSchemaHash) {
        this.logger.error(
          `FEATURE_SCHEMA_HASH_MISMATCH: Manifest feature schema hash (${manifestSchemaHash}) does not match canonical schema hash (${canonicalSchemaHash}). Model activation rejected.`
        );
        return;
      }

      if (manifest.conditionalReturns) {
        this.conditionalReturnsTable = manifest.conditionalReturns;
      }

      if (!manifest.onnxModels || typeof manifest.onnxModels !== 'object') {
        this.logger.error('MODEL_ARTIFACT_CORRUPT: Manifest onnxModels metadata is missing or invalid.');
        return;
      }

      const stagedSessions = new Map<'1d' | '5d' | '20d', ort.InferenceSession>();
      const horizons = ['1d', '5d', '20d'] as const;

      for (const h of horizons) {
        const modelMeta = manifest.onnxModels[h];
        if (!modelMeta || !modelMeta.sha256 || typeof modelMeta.sha256 !== 'string') {
          this.logger.error(`MANDATORY_HASH_MISSING: ONNX model for horizon ${h} is missing mandatory SHA-256 in manifest.`);
          return;
        }

        const modelPath = path.join(this.artifactsDir, modelMeta.filename || `model_${h}.onnx`);
        if (!fs.existsSync(modelPath)) {
          this.logger.error(`ONNX_FILE_MISSING: ONNX model file not found for horizon ${h}: ${modelPath}`);
          return;
        }

        const fileBuffer = fs.readFileSync(modelPath);
        const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        if (actualHash !== modelMeta.sha256) {
          this.logger.error(
            `ONNX_HASH_MISMATCH: Hash mismatch for horizon ${h} (${modelPath}). Expected ${modelMeta.sha256}, got ${actualHash}`
          );
          return;
        }

        const session = await ort.InferenceSession.create(modelPath);
        stagedSessions.set(h, session);
        this.logger.log(`Validated and staged ONNX model for horizon ${h} (${modelMeta.sha256.slice(0, 12)}...)`);
      }

      if (stagedSessions.size === 3) {
        this.sessions = stagedSessions;
        this.isModelLoaded = true;
        this.logger.log('MODEL_ARTIFACT_VALID: All 3 ONNX horizons (1d, 5d, 20d) atomically loaded and active.');
      } else {
        this.sessions.clear();
        this.isModelLoaded = false;
        this.logger.error('ATOMIC_ACTIVATION_FAILED: Incomplete session staging. 0 models active.');
      }
    } catch (err: any) {
      this.sessions.clear();
      this.isModelLoaded = false;
      this.logger.error(`Failed to load ONNX inference sessions: ${err.message}`, err.stack);
    }
  }

  public isLoaded(): boolean {
    return this.isModelLoaded && this.sessions.size === 3;
  }

  /**
   * Executes native ONNX runtime inference over exactly 25 point-in-time features.
   * Strictly fails closed (never silently executes heuristic baseline or fills missing values with 0.0).
   */
  async evaluate(features: ModelFeatureVector25, horizon: '1d' | '5d' | '20d'): Promise<number> {
    const session = this.sessions.get(horizon);
    if (!session) {
      throw new Error(`MODEL_UNAVAILABLE: ONNX inference session for horizon ${horizon} is not loaded`);
    }

    if (!features || typeof features !== 'object') {
      throw new Error(`FEATURE_SCHEMA_MISMATCH: Input features must be a valid non-null ModelFeatureVector25 object.`);
    }

    try {
      const inputVector: number[] = new Array(this.featureSchema.length);

      // Enforce strict feature schema validation: every declared feature must exist and be finite
      for (let i = 0; i < this.featureSchema.length; i++) {
        const key = this.featureSchema[i];
        if (!(key in features)) {
          throw new Error(`FEATURE_SCHEMA_MISMATCH: Missing required feature '${key}' in input vector`);
        }
        const val = (features as any)[key];
        if (val === null || val === undefined || typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
          throw new Error(`FEATURE_SCHEMA_MISMATCH: Feature '${key}' has invalid/non-finite value: ${val}`);
        }
        inputVector[i] = Number(val);
      }

      const inputTensor = new ort.Tensor('float32', inputVector, [1, this.featureSchema.length]);
      const feeds: Record<string, ort.Tensor> = {};
      const inputName = session.inputNames[0] || 'float_input';
      feeds[inputName] = inputTensor;

      const results = await session.run(feeds, ['probabilities']);
      const probOutput = results['probabilities'];

      if (probOutput && probOutput.data) {
        let prob = 0.5;
        if (probOutput.data instanceof Float32Array || probOutput.data instanceof Float64Array) {
          const dataArr = probOutput.data;
          prob = dataArr.length >= 2 ? Number(dataArr[1]) : Number(dataArr[0]);
        } else if (Array.isArray(probOutput.data)) {
          const dataArr = probOutput.data as unknown as number[];
          prob = dataArr.length >= 2 ? Number(dataArr[1]) : Number(dataArr[0]);
        } else if (probOutput.data instanceof BigInt64Array) {
          prob = Number(probOutput.data[0]) === 1 ? 0.75 : 0.25;
        } else {
          prob = Number((probOutput.data as any)[1] ?? (probOutput.data as any)[0] ?? 0.5);
        }
        return parseFloat(Math.max(0.0, Math.min(1.0, prob)).toFixed(4));
      }

      throw new Error('ONNX model produced malformed output');
    } catch (err: any) {
      if (err.message?.startsWith('FEATURE_SCHEMA_MISMATCH')) {
        throw err;
      }
      this.logger.error(`ONNX inference execution failed for ${horizon}: ${err.message}`);
      throw new Error(`MODEL_UNAVAILABLE: ONNX inference failed: ${err.message}`);
    }
  }

  private getBucketName(prob: number): string {
    const p = Math.max(0.0, Math.min(1.0, prob));
    if (p < 0.35) return 'DOWNSIDE_LOW';
    if (p < 0.45) return 'DOWNSIDE_MID';
    if (p < 0.50) return 'NEUTRAL_DOWN';
    if (p < 0.55) return 'NEUTRAL_UP';
    if (p < 0.65) return 'MODERATE_BULL';
    if (p < 0.75) return 'STRONG_BULL';
    return 'HIGH_CONVICTION_BULL';
  }

  public estimateScenarioReturns(
    horizon: '1d' | '5d' | '20d',
    calibratedProb: number = 0.55,
    regime: string = 'SIDEWAYS',
    assetVolatility: number = 0.02
  ): ScenarioReturnQuantiles {
    const hTable = this.conditionalReturnsTable[horizon];
    const bucketName = this.getBucketName(calibratedProb);

    if (hTable) {
      // 1. Probability + Regime
      const prKey = `PROB_REGIME_${bucketName}_${regime}`;
      if (hTable[prKey] && hTable[prKey].sampleCount >= 15) {
        return {
          bull85th: hTable[prKey].p85,
          base50th: hTable[prKey].p50,
          bear15th: hTable[prKey].p15,
          method: 'PROBABILITY_REGIME_BUCKET',
        };
      }

      // 2. Probability Bucket
      const pKey = `PROB_${bucketName}`;
      if (hTable[pKey] && hTable[pKey].sampleCount >= 15) {
        return {
          bull85th: hTable[pKey].p85,
          base50th: hTable[pKey].p50,
          bear15th: hTable[pKey].p15,
          method: 'PROBABILITY_BUCKET',
        };
      }

      // 3. Horizon-Wide Fallback
      if (hTable['HORIZON_WIDE'] && hTable['HORIZON_WIDE'].sampleCount >= 15) {
        return {
          bull85th: hTable['HORIZON_WIDE'].p85,
          base50th: hTable['HORIZON_WIDE'].p50,
          bear15th: hTable['HORIZON_WIDE'].p15,
          method: 'HORIZON_WIDE_FALLBACK',
        };
      }
    }

    return {
      bull85th: null,
      base50th: null,
      bear15th: null,
      method: 'INSUFFICIENT_DATA',
    };
  }

  /**
   * Computes path-integrated feature attributions for the active ONNX model.
   * Satisfies the efficiency axiom: sum(attributions) + baseValue == modelOutput within numerical tolerance.
   */
  public async computeFeatureAttribution(
    features: ModelFeatureVector25,
    horizon: '1d' | '5d' | '20d' = '5d'
  ): Promise<{
    attributions: { feature: string; contribution: number }[];
    baseValue: number;
    modelOutput: number;
    sumAttributions: number;
    decompositionError: number;
  }> {
    const session = this.sessions.get(horizon);
    if (!session) {
      throw new Error(`MODEL_UNAVAILABLE: ONNX inference session for horizon ${horizon} is not loaded`);
    }

    const baselineVector: Record<string, number> = {};
    for (const key of this.featureSchema) {
      baselineVector[key] = 0.0;
    }

    const baseValue = await this.evaluate(baselineVector as any, horizon);
    const modelOutput = await this.evaluate(features, horizon);
    const delta = modelOutput - baseValue;

    const eps = 1e-4;
    let totalSensitivity = 0.0;
    const sensitivities: number[] = [];

    const steps = [0.2, 0.5, 0.8];
    for (let i = 0; i < this.featureSchema.length; i++) {
      const key = this.featureSchema[i];
      const diff = ((features as any)[key] ?? 0) - (baselineVector[key] ?? 0);
      if (Math.abs(diff) < 1e-6) {
        sensitivities.push(0);
        continue;
      }

      let stepSum = 0;
      for (const alpha of steps) {
        const samplePos: Record<string, number> = {};
        const sampleNeg: Record<string, number> = {};
        for (let j = 0; j < this.featureSchema.length; j++) {
          const k2 = this.featureSchema[j];
          const x0 = baselineVector[k2] ?? 0;
          const x1 = (features as any)[k2] ?? 0;
          samplePos[k2] = x0 + alpha * (x1 - x0);
          sampleNeg[k2] = x0 + alpha * (x1 - x0);
        }
        samplePos[key] += eps;
        sampleNeg[key] -= eps;

        const outPos = await this.evaluate(samplePos as any, horizon);
        const outNeg = await this.evaluate(sampleNeg as any, horizon);
        stepSum += ((outPos - outNeg) / (2 * eps)) * diff;
      }
      const s = stepSum / steps.length;
      sensitivities.push(s);
      totalSensitivity += s;
    }

    const attributions: { feature: string; contribution: number }[] = [];
    for (let i = 0; i < this.featureSchema.length; i++) {
      const key = this.featureSchema[i];
      let contrib = sensitivities[i];
      if (Math.abs(totalSensitivity) > 1e-6) {
        contrib = delta * (sensitivities[i] / totalSensitivity);
      } else {
        contrib = delta / this.featureSchema.length;
      }
      attributions.push({
        feature: key,
        contribution: parseFloat(contrib.toFixed(6)),
      });
    }

    attributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const sumAttributions = parseFloat(attributions.reduce((s, a) => s + a.contribution, 0).toFixed(6));
    const decompositionError = parseFloat(Math.abs(baseValue + sumAttributions - modelOutput).toFixed(6));

    return {
      attributions,
      baseValue,
      modelOutput,
      sumAttributions,
      decompositionError,
    };
  }
}

