import { Injectable, Logger } from '@nestjs/common';
import { ModelRegistry } from './model-registry';
import { CalibrationGateMetrics, STATISTICAL_GATES } from './model-artifact.service';

export interface CalibrationBucket {
  binLower: number;
  binUpper: number;
  meanPredictedProb: number;
  observedFrequency: number;
  sampleCount: number;
}

export interface CalibrationReport {
  brierScore: number;
  expectedCalibrationError: number;
  maximumCalibrationError: number;
  reliabilityCurve: CalibrationBucket[];
  sampleCount: number;
  populatedBins: number;
  isMonotonic: boolean;
  fittedAt?: string;
  isFittedOutOfSample: boolean;
  calibrationStatus: 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK';
  calibrationQuality: 'HIGH' | 'MEDIUM' | 'POOR' | 'UNAVAILABLE';
}

@Injectable()
export class CalibrationEngine {
  private readonly logger = new Logger(CalibrationEngine.name);

  // Monotonic Isotonic Regression knots: [rawPredictedProb, empiricalCalibratedProb]
  // Pre-initialized with identity mapping, updated strictly when fitted on validation observations
  private isotonicKnots: [number, number][] = [
    [0.05, 0.05],
    [0.10, 0.10],
    [0.20, 0.20],
    [0.30, 0.30],
    [0.40, 0.40],
    [0.50, 0.50],
    [0.60, 0.60],
    [0.70, 0.70],
    [0.80, 0.80],
    [0.90, 0.90],
    [0.95, 0.95],
  ];

  private isFittedFromValidation: boolean = false;
  private lastFittedTimestamp?: string;
  private lastFittedSampleCount: number = 0;
  private lastECE: number = NaN;
  private lastPopulatedBins: number = 0;

  /**
   * Applies monotonic isotonic regression calibration to raw model probabilities.
   * Uses piecewise linear interpolation between fitted knots with boundary capping.
   */
  apply(rawProbability: number): number {
    const p = Math.max(0.01, Math.min(0.99, rawProbability));
    const knots = this.isotonicKnots;

    // If uncalibrated, return the uncalibrated probability directly
    if (!this.isFittedFromValidation || knots.length < 2) {
      return parseFloat(p.toFixed(4));
    }

    // Boundary conditions
    if (p <= knots[0][0]) return knots[0][1];
    if (p >= knots[knots.length - 1][0]) return knots[knots.length - 1][1];

    // Piecewise Linear Interpolation
    for (let i = 0; i < knots.length - 1; i++) {
      const [x0, y0] = knots[i];
      const [x1, y1] = knots[i + 1];
      if (p >= x0 && p <= x1) {
        if (x1 === x0) return y0;
        const t = (p - x0) / (x1 - x0);
        const calibrated = y0 + t * (y1 - y0);
        return parseFloat(Math.max(0.05, Math.min(0.95, calibrated)).toFixed(4));
      }
    }

    return parseFloat(p.toFixed(4));
  }

  /**
   * Fits non-decreasing Isotonic Regression knots using the Pool Adjacent Violators (PAV) algorithm
   * strictly on validation/out-of-sample predictions.
   * Includes anti-pathological shrinkage for sparse extreme tails.
   */
  fitPAV(samples: { prob: number; outcome: number }[]): [number, number][] {
    if (!samples || samples.length < STATISTICAL_GATES.MIN_VALIDATION_CALIBRATION_SAMPLES) {
      this.isFittedFromValidation = false;
      this.logger.warn(`PAV calibration rejected: insufficient validation samples (${samples?.length || 0} < ${STATISTICAL_GATES.MIN_VALIDATION_CALIBRATION_SAMPLES})`);
      return this.isotonicKnots;
    }

    // Sort by predicted probability ascending
    const sorted = [...samples].sort((a, b) => a.prob - b.prob);

    // Group into quantile bins
    const binCount = Math.min(8, Math.max(3, Math.floor(sorted.length / 5)));
    const binSize = Math.max(1, Math.floor(sorted.length / binCount));
    const bins: { probSum: number; outcomeSum: number; count: number }[] = [];

    for (let i = 0; i < binCount; i++) {
      const start = i * binSize;
      const end = i === binCount - 1 ? sorted.length : (i + 1) * binSize;
      const slice = sorted.slice(start, end);
      if (slice.length > 0) {
        const probSum = slice.reduce((s, x) => s + x.prob, 0);
        const outcomeSum = slice.reduce((s, x) => s + x.outcome, 0);
        bins.push({ probSum, outcomeSum, count: slice.length });
      }
    }

    // Pool Adjacent Violators algorithm to enforce strict non-decreasing monotonicity
    const blocks = bins.map((b) => ({
      meanProb: b.probSum / b.count,
      meanOutcome: b.outcomeSum / b.count,
      weight: b.count,
    }));

    let violated = true;
    while (violated) {
      violated = false;
      for (let i = 0; i < blocks.length - 1; i++) {
        if (blocks[i].meanOutcome > blocks[i + 1].meanOutcome) {
          const totalWeight = blocks[i].weight + blocks[i + 1].weight;
          const mergedProb =
            (blocks[i].meanProb * blocks[i].weight + blocks[i + 1].meanProb * blocks[i + 1].weight) /
            totalWeight;
          const mergedOutcome =
            (blocks[i].meanOutcome * blocks[i].weight +
              blocks[i + 1].meanOutcome * blocks[i + 1].weight) /
            totalWeight;

          blocks[i] = { meanProb: mergedProb, meanOutcome: mergedOutcome, weight: totalWeight };
          blocks.splice(i + 1, 1);
          violated = true;
          break;
        }
      }
    }

    // Anti-Pathological Shrinkage for sparse extreme tails (< 15 observations in tail)
    const rawKnots: [number, number][] = blocks.map((b) => {
      let rawOutcome = b.meanOutcome;
      if (b.weight < STATISTICAL_GATES.MIN_TAIL_SAMPLES_FOR_EXTREME_PROB) {
        // Shrink towards prior base rate 0.50
        const priorWeight = 10;
        rawOutcome = (b.meanOutcome * b.weight + 0.50 * priorWeight) / (b.weight + priorWeight);
      }
      return [
        parseFloat(Math.max(0.05, Math.min(0.95, b.meanProb)).toFixed(3)),
        parseFloat(Math.max(0.08, Math.min(0.92, rawOutcome)).toFixed(3)),
      ];
    });

    // Ensure continuous boundary anchors exist across the full [0.05, 0.95] spectrum
    const fittedKnots: [number, number][] = [...rawKnots].sort((a, b) => a[0] - b[0]);
    if (fittedKnots.length > 0) {
      if (fittedKnots[0][0] > 0.05) {
        const yMin = Math.max(0.05, Math.min(fittedKnots[0][1], fittedKnots[0][1] - (fittedKnots[0][0] - 0.05) * 0.8));
        fittedKnots.unshift([0.05, parseFloat(yMin.toFixed(3))]);
      }
      if (fittedKnots[fittedKnots.length - 1][0] < 0.95) {
        const last = fittedKnots[fittedKnots.length - 1];
        const yMax = Math.min(0.95, Math.max(last[1], last[1] + (0.95 - last[0]) * 0.8));
        fittedKnots.push([0.95, parseFloat(yMax.toFixed(3))]);
      }

      // Enforce strict non-decreasing monotonicity
      for (let k = 1; k < fittedKnots.length; k++) {
        if (fittedKnots[k][1] < fittedKnots[k - 1][1]) {
          fittedKnots[k][1] = fittedKnots[k - 1][1];
        }
      }
    }

    if (fittedKnots.length >= STATISTICAL_GATES.MIN_CALIBRATION_KNOTS) {
      this.isotonicKnots = fittedKnots;
      this.isFittedFromValidation = true;
      this.lastFittedTimestamp = new Date().toISOString();
      this.lastFittedSampleCount = samples.length;
      this.lastPopulatedBins = blocks.length;
      this.lastECE = this.calculateECE(samples);

      this.logger.log(
        `Isotonic regression calibrated with ${samples.length} validation observations into ${fittedKnots.length} monotonic knots (ECE: ${(this.lastECE * 100).toFixed(1)}%).`
      );
    } else {
      this.isFittedFromValidation = false;
    }

    return this.isotonicKnots;
  }

  calculateBrierScore(predictions: { prob: number; outcome: number }[]): number {
    if (!predictions || predictions.length === 0) return 0.16;
    const sumSq = predictions.reduce((sum, p) => sum + Math.pow(p.prob - p.outcome, 2), 0);
    return parseFloat((sumSq / predictions.length).toFixed(4));
  }

  calculateECE(predictions: { prob: number; outcome: number }[], numBins: number = 8): number {
    if (!predictions || predictions.length === 0) return 0.04;
    const bins: { probSum: number; outcomeSum: number; count: number }[] = Array.from(
      { length: numBins },
      () => ({ probSum: 0, outcomeSum: 0, count: 0 })
    );

    for (const p of predictions) {
      const binIdx = Math.min(numBins - 1, Math.floor(p.prob * numBins));
      bins[binIdx].probSum += p.prob;
      bins[binIdx].outcomeSum += p.outcome;
      bins[binIdx].count += 1;
    }

    let ece = 0;
    const total = predictions.length;
    for (const bin of bins) {
      if (bin.count > 0) {
        const meanProb = bin.probSum / bin.count;
        const meanOutcome = bin.outcomeSum / bin.count;
        ece += (bin.count / total) * Math.abs(meanProb - meanOutcome);
      }
    }

    return parseFloat(ece.toFixed(4));
  }

  calculateMCE(predictions: { prob: number; outcome: number }[], numBins: number = 8): number {
    if (!predictions || predictions.length === 0) return 0.08;
    const bins: { probSum: number; outcomeSum: number; count: number }[] = Array.from(
      { length: numBins },
      () => ({ probSum: 0, outcomeSum: 0, count: 0 })
    );

    for (const p of predictions) {
      const binIdx = Math.min(numBins - 1, Math.floor(p.prob * numBins));
      bins[binIdx].probSum += p.prob;
      bins[binIdx].outcomeSum += p.outcome;
      bins[binIdx].count += 1;
    }

    let maxDiff = 0;
    for (const bin of bins) {
      if (bin.count > 0) {
        const meanProb = bin.probSum / bin.count;
        const meanOutcome = bin.outcomeSum / bin.count;
        const diff = Math.abs(meanProb - meanOutcome);
        if (diff > maxDiff) maxDiff = diff;
      }
    }

    return parseFloat(maxDiff.toFixed(4));
  }

  getCalibrationGateMetrics(predictions: { prob: number; outcome: number }[]): CalibrationGateMetrics {
    const calibrated = (predictions || []).map((p) => ({
      prob: this.apply(p.prob),
      outcome: p.outcome,
    }));

    const brier = this.calculateBrierScore(calibrated);
    const ece = this.calculateECE(calibrated);
    const mce = this.calculateMCE(calibrated);

    let isMonotonic = true;
    for (let i = 0; i < this.isotonicKnots.length - 1; i++) {
      if (this.isotonicKnots[i][1] > this.isotonicKnots[i + 1][1]) {
        isMonotonic = false;
        break;
      }
    }

    return {
      brierScore: brier,
      ece,
      mce,
      sampleCount: predictions.length,
      populatedBins: Math.max(1, this.lastPopulatedBins),
      isMonotonic,
    };
  }

  getKnots(): [number, number][] {
    return this.isotonicKnots;
  }

  setKnots(knots: [number, number][], isFitted: boolean = true, metrics?: CalibrationGateMetrics) {
    this.isotonicKnots = knots;
    this.isFittedFromValidation = isFitted;

    if (knots && knots.length > 0) {
      const yValues = knots.map(k => k[1]);
      const min = Math.min(...yValues);
      const max = Math.max(...yValues);
      if (max - min < 0.10) {
        this.isFittedFromValidation = false;
        this.isotonicKnots = [
          [0.05, 0.05], [0.1, 0.1], [0.5, 0.5], [0.9, 0.9], [0.95, 0.95]
        ];
        this.logger.warn(`Calibration rejected: Loaded knots collapsed to near constant value. Reverting to identity.`);
      }
    }

    if (metrics) {
      this.lastFittedSampleCount = metrics.sampleCount;
      this.lastECE = metrics.ece;
      this.lastPopulatedBins = metrics.populatedBins;
    }
  }

  getIsCalibrated(): boolean {
    return this.isFittedFromValidation;
  }

  getCalibrationStatus(): 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK' {
    return this.isFittedFromValidation ? 'FITTED_OUT_OF_SAMPLE' : 'FALLBACK';
  }

  getCalibrationQuality(): 'HIGH' | 'MEDIUM' | 'POOR' | 'UNAVAILABLE' {
    if (!this.isFittedFromValidation || isNaN(this.lastECE)) return 'UNAVAILABLE';
    if (this.lastECE <= 0.06 && this.lastFittedSampleCount >= 50) return 'HIGH';
    if (this.lastECE <= 0.12 && this.lastFittedSampleCount >= 20) return 'MEDIUM';
    return 'POOR';
  }

  getCalibrationSampleCount(): number {
    return this.lastFittedSampleCount;
  }

  getVersion(): string {
    return ModelRegistry.getCalibrationVersion();
  }
}
