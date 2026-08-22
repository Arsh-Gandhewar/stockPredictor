import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ModelRegistry } from './model-registry';

export interface ModelArtifact {
  modelVersion: string;
  modelType: 'BASELINE_HEURISTIC' | 'LEARNED_BASELINE';
  featureVersion: string;
  trainingStart: string;
  trainingEnd: string;
  validationStart: string;
  validationEnd: string;
  testStart: string;
  testEnd: string;
  holdoutStart: string;
  holdoutEnd: string;
  horizon: '1d' | '5d' | '20d';
  fittingMethod: string;
  parameters: any;
  calibrationVersion: string;
  calibrationKnots: [number, number][];
  calibrationStatus: 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK';
  empiricalDistributions: any[];
  metrics?: {
    validationBrierScore?: number;
    testWinRate?: number;
    testSharpe?: number;
    testSortino?: number;
    testCAGR?: number;
    holdoutWinRate?: number;
    holdoutCAGR?: number;
  };
  createdAt: string;
}

@Injectable()
export class ModelArtifactService {
  private readonly logger = new Logger(ModelArtifactService.name);

  private getCandidatePaths(): string[] {
    const cwd = process.cwd();
    return [
      path.resolve(cwd, 'src/modules/prediction/models/model_v4_artifact.json'),
      path.resolve(cwd, 'apps/api/src/modules/prediction/models/model_v4_artifact.json'),
      path.resolve(__dirname, '../models/model_v4_artifact.json'),
      path.resolve(__dirname, '../../models/model_v4_artifact.json'),
      path.resolve(cwd, 'dist/modules/prediction/models/model_v4_artifact.json'),
    ];
  }

  saveArtifact(artifact: ModelArtifact): boolean {
    try {
      const targetPaths = this.getCandidatePaths();
      let saved = false;

      for (const targetPath of targetPaths) {
        try {
          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(targetPath, JSON.stringify(artifact, null, 2), 'utf-8');
          saved = true;
        } catch {
          // Continue to next candidate path
        }
      }

      if (saved) {
        this.logger.log(`Model artifact successfully persisted (v${artifact.modelVersion}, Calibration: ${artifact.calibrationStatus})`);
        return true;
      }
    } catch (err) {
      this.logger.warn(`Failed to persist model artifact to disk: ${err}`);
    }
    return false;
  }

  loadArtifact(): ModelArtifact | null {
    const candidatePaths = this.getCandidatePaths();

    for (const candidatePath of candidatePaths) {
      try {
        if (fs.existsSync(candidatePath)) {
          const raw = fs.readFileSync(candidatePath, 'utf-8');
          const artifact: ModelArtifact = JSON.parse(raw);
          const verification = this.verifyArtifact(artifact);
          if (verification.isValid) {
            this.logger.log(`Verified and loaded model artifact from ${candidatePath} (v${artifact.modelVersion}, Calibration: ${artifact.calibrationStatus})`);
            return artifact;
          }
        }
      } catch {
        // Try next candidate
      }
    }

    return null;
  }

  verifyArtifact(artifact: ModelArtifact): { isValid: boolean; reason?: string } {
    if (!artifact) {
      return { isValid: false, reason: 'Artifact is null or undefined' };
    }
    if (artifact.modelVersion !== ModelRegistry.getModelVersion()) {
      return {
        isValid: false,
        reason: `Model version mismatch: expected ${ModelRegistry.getModelVersion()}, got ${artifact.modelVersion}`,
      };
    }
    if (!artifact.trainingStart || !artifact.validationStart || !artifact.testStart || !artifact.holdoutStart) {
      return { isValid: false, reason: 'Incomplete walk-forward partition date metadata' };
    }
    return { isValid: true };
  }
}
