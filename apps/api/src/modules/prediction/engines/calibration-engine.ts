import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CalibrationEngine {
  private readonly logger = new Logger(CalibrationEngine.name);
  private calibrationData: any = null;

  constructor() {
    this.loadCalibration();
  }

  private loadCalibration() {
    try {
      const calibPath = path.join(__dirname, '..', '..', 'models', 'calibration_v1.json');
      if (fs.existsSync(calibPath)) {
        this.calibrationData = JSON.parse(fs.readFileSync(calibPath, 'utf-8'));
      }
    } catch (err) {
      this.logger.warn('Could not load calibration_v1.json. Operating in fallback mode.');
    }
  }

  apply(rawProbability: number): number {
    if (!this.calibrationData) {
      return rawProbability;
    }
    return rawProbability;
  }
  
  getVersion(): string {
    return this.calibrationData ? this.calibrationData.version || 'v1.0' : 'fallback';
  }
}
