import { Injectable } from '@nestjs/common';

@Injectable()
export class NewsFeatureEngine {
  extractFeatures(sentimentLabel: string, sentimentScore: number, topHeadline?: string): Record<string, any> {
    return {
      structuredSentiment: sentimentLabel,
      score: sentimentScore,
      hasHeadline: !!topHeadline,
      novelty: 'NEW',
      eventClassification: 'GENERAL'
    };
  }
}
