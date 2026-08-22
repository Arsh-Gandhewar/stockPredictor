import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as ort from 'onnxruntime-node';
import * as path from 'path';
import * as fs from 'fs';

export interface ScenarioReturnQuantiles {
  bull85th: number;
  base50th: number;
  bear15th: number;
}

@Injectable()
export class OnnxInferenceEngine implements OnModuleInit {
  private readonly logger = new Logger(OnnxInferenceEngine.name);
  private sessions: Map<'1d' | '5d' | '20d', ort.InferenceSession> = new Map();
  private featureSchema: string[] = [
    'rsi_14',
    'macd_hist',
    'sma_20_dist',
    'sma_50_dist',
    'ema_20_dist',
    'atr_percent',
    'bb_width',
    'stoch_k',
    'volume_z_score',
    'annualized_volatility',
    'downside_deviation',
    'beta_nifty',
    'relative_strength_nifty',
    'momentum_5',
    'momentum_20',
    'ret_1d',
    'ret_5d',
    'ret_20d',
    'gap_pct',
    'dist_52w_high',
    'dist_52w_low',
    'roc_12',
    'rel_volume',
    'vol_20d',
    'vol_60d',
  ];

  private isModelLoaded: boolean = false;
  private empiricalQuantiles: Record<string, { bull_85th: number; base_50th: number; bear_15th: number }> = {
    '1d': { bull_85th: 0.015, base_50th: 0.003, bear_15th: -0.012 },
    '5d': { bull_85th: 0.038, base_50th: 0.010, bear_15th: -0.024 },
    '20d': { bull_85th: 0.085, base_50th: 0.025, bear_15th: -0.055 },
  };

  private readonly artifactsDir = path.resolve(__dirname, '../../../../data/artifacts/active');

  async onModuleInit() {
    await this.loadActiveModels();
  }

  async loadActiveModels() {
    try {
      const manifestPath = path.join(this.artifactsDir, 'model-artifact.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (manifest.featureSchema && Array.isArray(manifest.featureSchema)) {
          this.featureSchema = manifest.featureSchema;
        }
        if (manifest.empiricalQuantiles) {
          this.empiricalQuantiles = manifest.empiricalQuantiles;
        }
      }

      for (const h of ['1d', '5d', '20d'] as const) {
        const modelPath = path.join(this.artifactsDir, `model_${h}.onnx`);
        if (fs.existsSync(modelPath)) {
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
   * Executes ONNX runtime inference over 25 point-in-time features.
   */
  async evaluate(features: Record<string, number | null>, horizon: '1d' | '5d' | '20d'): Promise<number> {
    const session = this.sessions.get(horizon);
    if (!session) {
      // Fallback baseline probability if ONNX model is uninitialized
      return this.evaluateBaselineHeuristic(features, horizon);
    }

    try {
      const inputVector = new Float32Array(this.featureSchema.length);
      for (let i = 0; i < this.featureSchema.length; i++) {
        const key = this.featureSchema[i];
        const val = features[key];
        inputVector[i] = val !== null && val !== undefined && !isNaN(val) ? Number(val) : 0.0;
      }

      const inputTensor = new ort.Tensor('float32', inputVector, [1, this.featureSchema.length]);
      const feeds: Record<string, ort.Tensor> = {};
      const inputName = session.inputNames[0] || 'float_input';
      feeds[inputName] = inputTensor;

      const results = await session.run(feeds);
      // For LightGBM classifier ONNX model, output 1 contains class probabilities
      const probOutput = results[session.outputNames[1]] || results[session.outputNames[0]];

      if (probOutput && probOutput.data) {
        const dataArr = probOutput.data as Float32Array;
        // Binary classification: probability of positive class (index 1)
        const prob = dataArr.length >= 2 ? dataArr[1] : dataArr[0];
        return parseFloat(Math.max(0.05, Math.min(0.95, Number(prob))).toFixed(4));
      }

      return 0.50;
    } catch (err) {
      this.logger.warn(`ONNX inference failed for ${horizon}, using baseline fallback: ${err}`);
      return this.evaluateBaselineHeuristic(features, horizon);
    }
  }

  public estimateScenarioReturns(horizon: '1d' | '5d' | '20d', assetVolatility: number = 0.02): ScenarioReturnQuantiles {
    const base = this.empiricalQuantiles[horizon] || { bull_85th: 0.038, base_50th: 0.010, bear_15th: -0.024 };
    const volScale = Math.max(0.35, Math.min(3.5, assetVolatility / 0.020));

    return {
      bull85th: parseFloat((base.bull_85th * volScale).toFixed(4)),
      base50th: parseFloat((base.base_50th * volScale).toFixed(4)),
      bear15th: parseFloat((base.bear_15th * volScale).toFixed(4)),
    };
  }

  private evaluateBaselineHeuristic(features: Record<string, number | null>, horizon: '1d' | '5d' | '20d'): number {
    const rsi = features['rsi_14'] ?? 50;
    const mom = features['momentum_5'] ?? 0;
    const smaDist = features['sma_50_dist'] ?? 0;

    let score = (50 - rsi) * 0.02 + mom * 2.0 + smaDist * 1.5;
    const horizonScaling = horizon === '1d' ? 0.60 : horizon === '5d' ? 1.0 : 1.35;
    const prob = 1 / (1 + Math.exp(-score * horizonScaling));
    return parseFloat(Math.max(0.05, Math.min(0.95, prob)).toFixed(4));
  }
}
