export interface MarketNewsArticle {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  timeAgo: string;
  category: 'Markets' | 'Corporate' | 'Results' | 'Macro';
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  affectedStock?: string;
  affectedStockName?: string;
  summary: string;
  whyItMatters: string;
  fullBody?: string;
}
