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
  createdAt: string;
}

@Injectable()
export class ModelArtifactService {
  private readonly logger = new Logger(ModelArtifactService.name);
  private readonly artifactDir = path.resolve(__dirname, '../models');
  private readonly artifactFile = path.join(this.artifactDir, 'model_v4_artifact.json');

  constructor() {
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists() {
    try {
      if (!fs.existsSync(this.artifactDir)) {
        fs.mkdirSync(this.artifactDir, { recursive: true });
      }
    } catch {
      // Graceful fallback
    }
  }

  saveArtifact(artifact: ModelArtifact): boolean {
    try {
      this.ensureDirectoryExists();
      fs.writeFileSync(this.artifactFile, JSON.stringify(artifact, null, 2), 'utf-8');
      this.logger.log(`Model artifact successfully persisted to ${this.artifactFile}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to persist model artifact to disk: ${err}`);
      return false;
    }
  }

  loadArtifact(): ModelArtifact | null {
    try {
      if (fs.existsSync(this.artifactFile)) {
        const raw = fs.readFileSync(this.artifactFile, 'utf-8');
        const artifact: ModelArtifact = JSON.parse(raw);
        const verification = this.verifyArtifact(artifact);
        if (verification.isValid) {
          this.logger.log(`Verified and loaded model artifact v${artifact.modelVersion} (Calibration: ${artifact.calibrationStatus})`);
          return artifact;
        } else {
          this.logger.warn(`Model artifact verification failed: ${verification.reason}. Falling back.`);
          return null;
        }
      }
    } catch (err) {
      this.logger.warn(`Could not read model artifact from disk: ${err}`);
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
