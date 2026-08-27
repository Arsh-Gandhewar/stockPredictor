import { z } from 'zod';

export const GetStockSchema = z.object({
  ticker: z.string().min(1, 'Ticker cannot be empty').max(20, 'Ticker exceeds 20 characters'),
  includePrediction: z.boolean().optional().default(false),
  includeRisk: z.boolean().optional().default(false),
  includeSentiment: z.boolean().optional().default(false),
}).strict();

export const SearchStocksSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty').max(100, 'Search query exceeds 100 characters'),
  sector: z.string().optional(),
  marketCap: z.string().optional(),
  limit: z.number().int().min(1).max(50, 'Maximum limit is 50 stocks').optional().default(10),
}).strict();

export const GetOpportunitiesSchema = z.object({
  horizon: z.enum(['1d', '5d', '20d']).optional().default('5d'),
  riskProfile: z.enum(['low', 'balanced', 'aggressive']).optional().default('balanced'),
  limit: z.number().int().min(1).max(20, 'Maximum opportunity limit is 20').optional().default(10),
}).strict();

export const AnalyzeStockSchema = z.object({
  ticker: z.string().min(1, 'Ticker cannot be empty').max(20, 'Ticker exceeds 20 characters'),
  horizon: z.enum(['1d', '5d', '20d']).optional().default('20d'),
}).strict();

export const ModelPerformanceSchema = z.object({
  horizon: z.enum(['1d', '5d', '20d']).optional(),
  modelVersion: z.string().optional(),
}).strict();

export const GetPortfolioSchema = z.object({
  userId: z.string().optional(),
}).strict();

export const GetPositionRiskSchema = z.object({
  ticker: z.string().min(1, 'Ticker cannot be empty').max(20, 'Ticker exceeds 20 characters'),
}).strict();

export const RiskGuardianSchema = z.object({
  ticker: z.string().optional(),
  portfolioScope: z.boolean().optional().default(true),
}).strict();

export const GetStockSentimentSchema = z.object({
  ticker: z.string().min(1, 'Ticker cannot be empty').max(20, 'Ticker exceeds 20 characters'),
}).strict();

export const RunBacktestSchema = z.object({
  strategyVersion: z.string().optional(),
  horizon: z.enum(['1d', '5d', '20d']).optional().default('5d'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be in YYYY-MM-DD format').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be in YYYY-MM-DD format').optional(),
}).strict();

export const PaperBuySchema = z.object({
  ticker: z.string().min(1, 'Ticker cannot be empty').max(20, 'Ticker exceeds 20 characters'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1 share').max(100000, 'Quantity exceeds 100,000 shares'),
  orderType: z.enum(['MARKET', 'LIMIT']).optional().default('MARKET'),
  limitPrice: z.number().positive('Limit price must be positive').optional(),
  idempotencyKey: z.string().min(8, 'idempotencyKey must be at least 8 characters').max(128, 'idempotencyKey exceeds 128 characters'),
}).strict();

export const PaperSellSchema = z.object({
  ticker: z.string().min(1, 'Ticker cannot be empty').max(20, 'Ticker exceeds 20 characters'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1 share').max(100000, 'Quantity exceeds 100,000 shares'),
  orderType: z.enum(['MARKET', 'LIMIT']).optional().default('MARKET'),
  limitPrice: z.number().positive('Limit price must be positive').optional(),
  idempotencyKey: z.string().min(8, 'idempotencyKey must be at least 8 characters').max(128, 'idempotencyKey exceeds 128 characters'),
}).strict();

export const HealthSchema = z.object({}).strict();
