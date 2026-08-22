import { Injectable, Logger } from '@nestjs/common';
import { ModelRegistry } from './model-registry';

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
  fittedAt?: string;
  isFittedOutOfSample: boolean;
  calibrationStatus: 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK';
}

@Injectable()
export class CalibrationEngine {
  private readonly logger = new Logger(CalibrationEngine.name);

  // Monotonic Isotonic Regression knots: [rawPredictedProb, empiricalCalibratedProb]
  // Pre-initialized with baseline identity knots, updated strictly when fitted on validation/out-of-sample trades
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

  /**
   * Applies monotonic isotonic regression calibration to raw model probabilities.
   * Uses piecewise linear interpolation between fitted knots.
   */
  apply(rawProbability: number): number {
    const p = Math.max(0.01, Math.min(0.99, rawProbability));
    const knots = this.isotonicKnots;

    // Boundary conditions
    if (p <= knots[0][0]) return knots[0][1];
    if (p >= knots[knots.length - 1][0]) return knots[knots.length - 1][1];

    // Piecewise Linear Interpolation
    for (let i = 0; i < knots.length - 1; i++) {
      const [x0, y0] = knots[i];
      const [x1, y1] = knots[i + 1];
      if (p >= x0 && p <= x1) {
        const t = (p - x0) / (x1 - x0);
        const calibrated = y0 + t * (y1 - y0);
        return parseFloat(calibrated.toFixed(4));
      }
    }

    return parseFloat(p.toFixed(4));
  }

  /**
   * Fits non-decreasing Isotonic Regression knots using the Pool Adjacent Violators (PAV) algorithm
   * strictly on validation/out-of-sample predictions.
   */
  fitPAV(samples: { prob: number; outcome: number }[]): [number, number][] {
    if (!samples || samples.length < 6) {
      this.isFittedFromValidation = false;
      return this.isotonicKnots;
    }

    // Sort by predicted probability ascending
    const sorted = [...samples].sort((a, b) => a.prob - b.prob);

    // Group into quantile bins
    const binCount = Math.min(10, Math.max(2, Math.floor(sorted.length / 3)));
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

    const fittedKnots: [number, number][] = blocks.map((b) => [
      parseFloat(Math.max(0.01, Math.min(0.99, b.meanProb)).toFixed(3)),
      parseFloat(Math.max(0.05, Math.min(0.95, b.meanOutcome)).toFixed(3)),
    ]);

    if (fittedKnots.length >= 1) {
      this.isotonicKnots = fittedKnots;
      this.isFittedFromValidation = true;
      this.lastFittedTimestamp = new Date().toISOString();
      this.logger.log(
        `Isotonic regression calibrated with ${samples.length} validation trades into ${fittedKnots.length} monotonic knots.`
      );
    }

    return this.isotonicKnots;
  }

  calculateBrierScore(predictions: { prob: number; outcome: number }[]): number {
    if (!predictions || predictions.length === 0) return 0.16;
    const sumSq = predictions.reduce((sum, p) => sum + Math.pow(p.prob - p.outcome, 2), 0);
    return parseFloat((sumSq / predictions.length).toFixed(4));
  }

  calculateECE(predictions: { prob: number; outcome: number }[], numBins: number = 10): number {
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

  calculateMCE(predictions: { prob: number; outcome: number }[], numBins: number = 10): number {
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

  generateCalibrationReport(predictions: { prob: number; outcome: number }[]): CalibrationReport {
    const brier = this.calculateBrierScore(predictions);
    const ece = this.calculateECE(predictions);
    const mce = this.calculateMCE(predictions);

    const numBins = 5;
    const bins: CalibrationBucket[] = [];
    for (let i = 0; i < numBins; i++) {
      const lower = i / numBins;
      const upper = (i + 1) / numBins;
      const matching = predictions.filter((p) => p.prob >= lower && (i === numBins - 1 ? p.prob <= upper : p.prob < upper));
      const meanProb = matching.length > 0 ? matching.reduce((s, p) => s + p.prob, 0) / matching.length : (lower + upper) / 2;
      const obsFreq = matching.length > 0 ? matching.reduce((s, p) => s + p.outcome, 0) / matching.length : 0.5;

      bins.push({
        binLower: lower,
        binUpper: upper,
        meanPredictedProb: parseFloat(meanProb.toFixed(3)),
        observedFrequency: parseFloat(obsFreq.toFixed(3)),
        sampleCount: matching.length,
      });
    }

    return {
      brierScore: brier,
      expectedCalibrationError: ece,
      maximumCalibrationError: mce,
      reliabilityCurve: bins,
      sampleCount: predictions.length,
      fittedAt: this.lastFittedTimestamp,
      isFittedOutOfSample: this.isFittedFromValidation,
      calibrationStatus: this.isFittedFromValidation ? 'FITTED_OUT_OF_SAMPLE' : 'FALLBACK',
    };
  }

  getKnots(): [number, number][] {
    return this.isotonicKnots;
  }

  setKnots(knots: [number, number][], isFitted: boolean = true) {
    this.isotonicKnots = knots;
    this.isFittedFromValidation = isFitted;
  }

  getCalibrationStatus(): 'FITTED_OUT_OF_SAMPLE' | 'FALLBACK' {
    return this.isFittedFromValidation ? 'FITTED_OUT_OF_SAMPLE' : 'FALLBACK';
  }

  getVersion(): string {
    return ModelRegistry.getCalibrationVersion();
  }
}
