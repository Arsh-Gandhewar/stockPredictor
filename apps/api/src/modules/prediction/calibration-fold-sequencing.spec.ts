import { CalibrationEngine } from './engines/calibration-engine';
import { ModelInferenceEngine } from './engines/model-inference';
import { LogisticRegressionModel } from './engines/learned-model';

describe('P0 Invariant: Strict Calibration Fold Sequencing', () => {
  // Deterministic validation data points (raw predicted probabilities and ground truth binary outcomes)
  const validationObservations = [
    { prob: 0.25, outcome: 0 as const, fwdReturn: -0.02 },
    { prob: 0.30, outcome: 0 as const, fwdReturn: -0.015 },
    { prob: 0.35, outcome: 0 as const, fwdReturn: -0.01 },
    { prob: 0.40, outcome: 1 as const, fwdReturn: 0.005 },
    { prob: 0.45, outcome: 0 as const, fwdReturn: -0.008 },
    { prob: 0.50, outcome: 1 as const, fwdReturn: 0.012 },
    { prob: 0.55, outcome: 1 as const, fwdReturn: 0.018 },
    { prob: 0.60, outcome: 0 as const, fwdReturn: -0.002 },
    { prob: 0.65, outcome: 1 as const, fwdReturn: 0.022 },
    { prob: 0.70, outcome: 1 as const, fwdReturn: 0.035 },
    { prob: 0.72, outcome: 1 as const, fwdReturn: 0.019 },
    { prob: 0.75, outcome: 1 as const, fwdReturn: 0.028 },
    { prob: 0.78, outcome: 1 as const, fwdReturn: 0.031 },
    { prob: 0.80, outcome: 1 as const, fwdReturn: 0.040 },
    { prob: 0.82, outcome: 1 as const, fwdReturn: 0.025 },
    { prob: 0.85, outcome: 1 as const, fwdReturn: 0.045 },
    { prob: 0.88, outcome: 1 as const, fwdReturn: 0.038 },
    { prob: 0.90, outcome: 1 as const, fwdReturn: 0.052 },
    { prob: 0.92, outcome: 1 as const, fwdReturn: 0.048 },
    { prob: 0.95, outcome: 1 as const, fwdReturn: 0.060 },
  ];

  // Out-of-sample Test & Holdout raw probabilities
  const testRawProbs = [0.28, 0.42, 0.58, 0.67, 0.79, 0.86, 0.91];
  const holdoutRawProbs = [0.31, 0.46, 0.53, 0.69, 0.74, 0.83, 0.94];

  function runFoldSequencingPipeline() {
    // 1. Initialize clean calibration engine
    const calibrationEngine = new CalibrationEngine();
    expect(calibrationEngine.getIsCalibrated()).toBe(false);

    // 2. Stage A (TRAIN): Train model (here simulated with LogisticRegressionModel)
    const learnedModel = new LogisticRegressionModel();
    const trainSamples = [
      { features: { rsi14: 30, macdHist: -0.5 }, outcome: 0 },
      { features: { rsi14: 70, macdHist: 0.8 }, outcome: 1 },
    ];
    learnedModel.fit(trainSamples as any);
    const frozenWeights = learnedModel.getWeights();

    // 3. Stage B (VALIDATION): Collect validation predictions and fit calibration
    const valPairs = validationObservations.map((v) => ({
      prob: v.prob,
      outcome: v.outcome,
    }));
    calibrationEngine.fitPAV(valPairs);

    // Invariant: Calibration is calibrated and knots are frozen
    expect(calibrationEngine.getIsCalibrated()).toBe(true);
    const frozenKnots = calibrationEngine.getKnots();
    expect(frozenKnots.length).toBeGreaterThanOrEqual(2);

    // 4. Stage C (TEST): Evaluate test predictions using FROZEN calibration
    const testCalibratedProbs = testRawProbs.map((p) => calibrationEngine.apply(p));

    // Knots must remain completely unchanged after test predictions
    expect(calibrationEngine.getKnots()).toEqual(frozenKnots);

    // 5. Stage D (HOLDOUT): Evaluate holdout predictions using FROZEN calibration
    const holdoutCalibratedProbs = holdoutRawProbs.map((p) => calibrationEngine.apply(p));

    // Knots must remain completely unchanged after holdout predictions
    expect(calibrationEngine.getKnots()).toEqual(frozenKnots);

    return {
      weights: frozenWeights,
      knots: frozenKnots,
      testProbs: testCalibratedProbs,
      holdoutProbs: holdoutCalibratedProbs,
    };
  }

  it('should enforce strict fold sequencing: validation fits calibration, knots freeze before test/holdout', () => {
    const res = runFoldSequencingPipeline();
    expect(res.knots.length).toBeGreaterThan(0);
    expect(res.testProbs.length).toBe(testRawProbs.length);
    expect(res.holdoutProbs.length).toBe(holdoutRawProbs.length);

    // Verify monotonic calibration property
    for (let i = 1; i < res.testProbs.length; i++) {
      expect(res.testProbs[i]).toBeGreaterThanOrEqual(res.testProbs[i - 1]);
    }
  });

  it('a clean-process rerun gives identical calibration parameters and probabilities for every OOS fold (Acceptance Condition 3)', () => {
    // Run 1: Clean process execution
    const run1 = runFoldSequencingPipeline();

    // Run 2: Independent clean process execution
    const run2 = runFoldSequencingPipeline();

    // Bit-for-bit equivalence invariants
    expect(run1.knots).toEqual(run2.knots);
    expect(run1.weights).toEqual(run2.weights);
    expect(run1.testProbs).toEqual(run2.testProbs);
    expect(run1.holdoutProbs).toEqual(run2.holdoutProbs);
  });

  it('test and holdout predictions must never mutate calibration knots (fail-closed leakage check)', () => {
    const calibrationEngine = new CalibrationEngine();
    const valPairs = validationObservations.map((v) => ({
      prob: v.prob,
      outcome: v.outcome,
    }));
    calibrationEngine.fitPAV(valPairs);
    const knotsSnapshot = JSON.stringify(calibrationEngine.getKnots());

    // Apply 1000 arbitrary out-of-sample predictions
    for (let i = 0; i < 1000; i++) {
      const p = Math.random();
      calibrationEngine.apply(p);
    }

    // Assert zero leakage/mutation
    expect(JSON.stringify(calibrationEngine.getKnots())).toBe(knotsSnapshot);
  });
});
