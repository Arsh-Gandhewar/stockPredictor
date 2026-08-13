// BASELINE_ONLY
export const CONFIDENCE = {
  BASE: 76,
  MOMENTUM_WEIGHT: 3.5,
  HIGH_VOLUME_THRESHOLD: 1_000_000,
  HIGH_VOLUME_BONUS: 5,
  MIN: 50,
  MAX: 98,
};

export function calculateLegacyConfidence(changePercent: number, volume: number, sentimentScore: number) {
  const baseConfidence = Math.min(
    94,
    Math.max(68, Math.round(CONFIDENCE.BASE + changePercent * CONFIDENCE.MOMENTUM_WEIGHT + ((volume || 0) > CONFIDENCE.HIGH_VOLUME_THRESHOLD ? CONFIDENCE.HIGH_VOLUME_BONUS : 0)))
  );
  return Math.min(CONFIDENCE.MAX, Math.max(CONFIDENCE.MIN, baseConfidence + sentimentScore));
}
