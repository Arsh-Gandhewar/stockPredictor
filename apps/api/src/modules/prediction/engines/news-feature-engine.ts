import { Injectable } from '@nestjs/common';

export interface StructuredNewsFeatures {
  structuredSentiment: 'VERY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'VERY_BEARISH';
  score: number; // -50 to +50
  magnitude: number;
  hasHeadline: boolean;
  eventSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  sentimentLabel: string;
  topHeadline?: string;
  category: 'EARNINGS' | 'REGULATORY' | 'MACRO' | 'CORPORATE' | 'GENERAL';
}

@Injectable()
export class NewsFeatureEngine {
  /**
   * Transforms raw sentiment outputs and headlines into structured quantitative features.
   */
  extractFeatures(
    sentimentLabel: string,
    sentimentScore: number,
    topHeadline?: string
  ): StructuredNewsFeatures {
    const score = Math.max(-50, Math.min(50, sentimentScore || 0));
    const magnitude = Math.abs(score);

    let structuredSentiment: 'VERY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'VERY_BEARISH' = 'NEUTRAL';
    if (score >= 25) structuredSentiment = 'VERY_BULLISH';
    else if (score >= 8) structuredSentiment = 'BULLISH';
    else if (score <= -25) structuredSentiment = 'VERY_BEARISH';
    else if (score <= -8) structuredSentiment = 'BEARISH';

    let eventSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
    if (magnitude >= 35) eventSeverity = 'CRITICAL';
    else if (magnitude >= 20) eventSeverity = 'HIGH';
    else if (magnitude >= 10) eventSeverity = 'MEDIUM';
    else if (magnitude > 0) eventSeverity = 'LOW';

    let category: 'EARNINGS' | 'REGULATORY' | 'MACRO' | 'CORPORATE' | 'GENERAL' = 'GENERAL';
    const text = (topHeadline || '').toLowerCase();
    if (text.includes('q1') || text.includes('q2') || text.includes('q3') || text.includes('q4') || text.includes('profit') || text.includes('revenue') || text.includes('ebitda') || text.includes('earnings')) {
      category = 'EARNINGS';
    } else if (text.includes('sebi') || text.includes('rbi') || text.includes('court') || text.includes('tax') || text.includes('penalty') || text.includes('probe')) {
      category = 'REGULATORY';
    } else if (text.includes('inflation') || text.includes('gdp') || text.includes('crude') || text.includes('fed') || text.includes('rate hike')) {
      category = 'MACRO';
    } else if (text.includes('merger') || text.includes('acquisition') || text.includes('stake') || text.includes('order') || text.includes('deal')) {
      category = 'CORPORATE';
    }

    return {
      structuredSentiment,
      score,
      magnitude,
      hasHeadline: !!topHeadline,
      eventSeverity,
      sentimentLabel: sentimentLabel || 'NEUTRAL',
      topHeadline,
      category,
    };
  }
}
