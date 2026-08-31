import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as ort from 'onnxruntime-node';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface ScenarioReturnQuantiles {
  bull85th: number | null;
  base50th: number | null;
  bear15th: number | null;
  method?: string;
}

@Injectable()
export class OnnxInferenceEngine implements OnModuleInit {
  private readonly logger = new Logger(OnnxInferenceEngine.name);
  private sessions: Map<'1d' | '5d' | '20d', ort.InferenceSession> = new Map();
  private featureSchema: string[] = (() => {
    const canonicalPath = path.resolve(__dirname, '../../../../../../packages/quant-engine/research/canonical_features.json');
    if (!fs.existsSync(canonicalPath)) {
      throw new Error(
        `CANONICAL_SCHEMA_MISSING: Canonical feature schema file not found at ${canonicalPath}. Silent fallback prohibited.`
      );
    }
    try {
      const content = fs.readFileSync(canonicalPath, 'utf-8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const EXPECTED_HASH = '592a15cf6ca35659ae322b1e3694ebffd6c5f610a1a489137a01640731d90ee7';
      if (hash !== EXPECTED_HASH) {
        throw new Error(
          `CANONICAL_SCHEMA_HASH_MISMATCH: Canonical features hash ${hash} does not match runtime lineage hash ${EXPECTED_HASH}`
        );
      }
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
    try {
      const manifestPath = path.join(this.artifactsDir, 'model-artifact.json');
      let manifest: any = {};
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (manifest.featureSchema && Array.isArray(manifest.featureSchema)) {
          this.featureSchema = manifest.featureSchema;
        }
        if (manifest.conditionalReturns) {
          this.conditionalReturnsTable = manifest.conditionalReturns;
        }
      }

      for (const h of ['1d', '5d', '20d'] as const) {
        const modelPath = path.join(this.artifactsDir, `model_${h}.onnx`);
        if (fs.existsSync(modelPath)) {
          const fileBuffer = fs.readFileSync(modelPath);
          const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
          
          if (manifest.onnxModels && manifest.onnxModels[h] && manifest.onnxModels[h].sha256) {
            if (hash !== manifest.onnxModels[h].sha256) {
              this.logger.error(`Hash mismatch for model_${h}.onnx. Expected ${manifest.onnxModels[h].sha256}, got ${hash}`);
              continue;
            }
          }
          
          const session = await ort.InferenceSession.create(modelPath);
          this.sessions.set(h, session);
          this.logger.log(`Loaded ONNX model for horizon ${h} from ${modelPath}`);
        } else {
          this.logger.warn(`ONNX model file not found: ${modelPath}`);
        }
      }

      this.isModelLoaded = this.sessions.size > 0;
    } catch (err) {
      this.logger.error(`Failed to load ONNX inference sessions: ${err}`);
      this.isModelLoaded = false;
    }
  }

  public isLoaded(): boolean {
    return this.isModelLoaded;
  }

  /**
   * Executes native ONNX runtime inference over 25 point-in-time features.
   * Strictly fails closed (never silently executes heuristic baseline).
   */
  async evaluate(features: Record<string, number | null> | number[], horizon: '1d' | '5d' | '20d'): Promise<number> {
    const session = this.sessions.get(horizon);
    if (!session) {
      throw new Error(`MODEL_UNAVAILABLE: ONNX inference session for horizon ${horizon} is not loaded`);
    }

    try {
      const inputVector = new Float32Array(this.featureSchema.length);

      if (Array.isArray(features)) {
        if (features.length !== this.featureSchema.length) {
          throw new Error(
            `FEATURE_SCHEMA_MISMATCH: Input array length (${features.length}) does not match expected feature schema count (${this.featureSchema.length})`
          );
        }
        for (let i = 0; i < features.length; i++) {
          const val = features[i];
          inputVector[i] = val !== null && val !== undefined && !isNaN(val) ? Number(val) : 0.0;
        }
      } else {
        // Enforce strict feature schema validation: all expected features must be present
        for (let i = 0; i < this.featureSchema.length; i++) {
          const key = this.featureSchema[i];
          if (!(key in features)) {
            throw new Error(`FEATURE_SCHEMA_MISMATCH: Missing required feature '${key}' in input vector`);
          }
          const val = features[key];
          inputVector[i] = val !== null && val !== undefined && !isNaN(val) ? Number(val) : 0.0;
        }
      }

      const inputTensor = new ort.Tensor('float32', inputVector, [1, this.featureSchema.length]);
      const feeds: Record<string, ort.Tensor> = {};
      const inputName = session.inputNames[0] || 'float_input';
      feeds[inputName] = inputTensor;

      const results = await session.run(feeds);
      const probOutput = results[session.outputNames[1]] || results[session.outputNames[0]];

      if (probOutput && probOutput.data) {
        const dataArr = probOutput.data as Float32Array;
        const prob = dataArr.length >= 2 ? dataArr[1] : dataArr[0];
        return parseFloat(Math.max(0.05, Math.min(0.95, Number(prob))).toFixed(4));
      }

      throw new Error('ONNX model produced malformed output');
    } catch (err: any) {
      if (err.message?.startsWith('FEATURE_SCHEMA_MISMATCH')) {
        throw err;
      }
      this.logger.error(`ONNX inference execution failed for ${horizon}: ${err}`);
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
}

