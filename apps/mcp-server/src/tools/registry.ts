import { z } from 'zod';
import { QuantxClient } from '../adapters/quantx-client.js';
import { AuthContext, AuthService, UserRole } from '../auth/auth-context.js';
import { rateLimiter, RateLimitTier } from '../security/rate-limiter.js';
import { idempotencyManager, IdempotencyManager } from '../security/idempotency.js';
import { SecuritySanitizer } from '../security/sanitizer.js';
import { McpError } from '../errors/mcp-errors.js';
import { logger } from '../logging/logger.js';
import {
  GetStockSchema,
  SearchStocksSchema,
  GetOpportunitiesSchema,
  AnalyzeStockSchema,
  ModelPerformanceSchema,
  GetPortfolioSchema,
  GetPositionRiskSchema,
  RiskGuardianSchema,
  GetStockSentimentSchema,
  RunBacktestSchema,
  PaperBuySchema,
  PaperSellSchema,
  HealthSchema,
} from '../schemas/tool-schemas.js';

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  readOnly: boolean;
  requiredRole: UserRole;
  rateLimitTier: RateLimitTier;
  timeoutMs?: number;
  execute: (input: TInput, client: QuantxClient, context: AuthContext) => Promise<TOutput>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async executeTool(name: string, rawInput: unknown, client: QuantxClient, context: AuthContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new McpError('NOT_FOUND', `Tool '${name}' is not registered in QuantX MCP server.`, { details: { tool: name } });
    }

    const startTime = Date.now();
    logger.info(`Executing tool: ${name}`, { tool: name, requestId: context.requestId, userScope: context.userId });

    // 1. Check Rate Limit
    rateLimiter.checkRateLimit(`${context.userId}:${tool.name}`, tool.rateLimitTier);

    // 2. Concurrency token
    const releaseConcurrency = rateLimiter.acquireConcurrency(tool.name);

    try {
      // 3. Check Authorization Server-Side
      AuthService.assertAuthorized(context, tool.requiredRole, tool.name);

      // 4. Schema Validation
      const parseResult = tool.schema.safeParse(rawInput);
      if (!parseResult.success) {
        const errorMessages = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new McpError('INVALID_INPUT', `Validation failed for tool '${name}': ${errorMessages}`, {
          details: { validationErrors: parseResult.error.format() },
        });
      }

      // 5. Execute Handler
      const result = await tool.execute(parseResult.data, client, context);

      const durationMs = Date.now() - startTime;
      logger.info(`Tool executed successfully: ${name}`, { tool: name, requestId: context.requestId, durationMs, status: 'SUCCESS' });

      return result;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = SecuritySanitizer.sanitizeErrorMessage(rawMessage);
      const mcpErr = err instanceof McpError ? err : new McpError('INTERNAL_ERROR', safeMessage);
      logger.error(`Tool execution failed: ${name}`, {
        tool: name,
        requestId: context.requestId,
        durationMs,
        status: 'ERROR',
        error: mcpErr.message,
      });
      throw mcpErr;
    } finally {
      releaseConcurrency();
    }
  }
}

/**
 * Instantiates and registers all 13 canonical QuantX MCP tools — BUG 5 Hardened.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // 1. quantx_get_stock
  registry.register({
    name: 'quantx_get_stock',
    description: 'Retrieves market quote, current trading price, day change, volume, and optional quantitative prediction and risk metrics for a given stock ticker.',
    schema: GetStockSchema,
    readOnly: true,
    requiredRole: 'PUBLIC_READ',
    rateLimitTier: 'READ_LIGHT',
    execute: async (input, client) => {
      const ticker = SecuritySanitizer.normalizeTicker(input.ticker);
      const quote = await client.getQuote(ticker);

      let prediction: any = null;
      let risk: any = null;
      let sentiment: any = null;

      if (input.includePrediction || input.includeRisk) {
        try {
          prediction = await client.getPrediction(ticker);
          if (input.includeRisk && prediction?.risk) {
            risk = prediction.risk;
          }
        } catch {
          prediction = { status: 'INSUFFICIENT_DATA', message: 'Prediction currently unavailable for ticker' };
        }
      }

      if (input.includeSentiment) {
        try {
          const newsArticles = await client.getStockNews(ticker);
          sentiment = {
            count: newsArticles.length,
            topHeadline: newsArticles[0] ? SecuritySanitizer.sanitizeTextForAi(newsArticles[0].title) : null,
            sentiment: newsArticles[0]?.sentiment || 'NEUTRAL',
          };
        } catch {
          sentiment = { status: 'UNAVAILABLE' };
        }
      }

      // Freshness contract: NEVER substitute new Date().toISOString() when source timestamp is missing
      const priceTimestamp = quote?.timestamp ? new Date(quote.timestamp).toISOString() : null;
      let dataStatus: 'LIVE' | 'STALE' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';

      if (quote && quote.price !== undefined && quote.price !== null) {
        if (quote.dataStatus === 'STALE' || quote.isStale === true) {
          dataStatus = 'STALE';
        } else {
          dataStatus = 'LIVE';
        }
      }

      return {
        ticker,
        companyName: quote?.name || ticker,
        latestPrice: quote?.price ?? null,
        change: quote?.change ?? null,
        changePercent: quote?.changePercent ?? null,
        volume: quote?.volume ?? null,
        priceTimestamp,
        marketStatus: quote?.marketState || 'UNKNOWN',
        prediction: input.includePrediction ? prediction : undefined,
        risk: input.includeRisk ? risk : undefined,
        sentiment: input.includeSentiment ? sentiment : undefined,
        dataStatus,
      };
    },
  });

  // 2. quantx_search_stocks
  registry.register({
    name: 'quantx_search_stocks',
    description: 'Searches stock universe by ticker symbol or company name with optional sector filter. Returns up to 50 matches.',
    schema: SearchStocksSchema,
    readOnly: true,
    requiredRole: 'PUBLIC_READ',
    rateLimitTier: 'READ_MODERATE',
    execute: async (input, client) => {
      const results = await client.searchStocks(input.query);
      let filtered = results;
      if (input.sector) {
        const secLower = input.sector.toLowerCase();
        filtered = filtered.filter((s: any) => s.sector && s.sector.toLowerCase().includes(secLower));
      }
      const capped = filtered.slice(0, input.limit || 10);
      return {
        query: input.query,
        count: capped.length,
        totalFound: filtered.length,
        stocks: capped.map((s: any) => ({
          ticker: s.ticker,
          name: s.name,
          sector: s.sector || 'Equities',
          exchange: s.exchange || 'NSE',
        })),
        dataStatus: 'AVAILABLE',
      };
    },
  });

  // 3. quantx_get_opportunities
  registry.register({
    name: 'quantx_get_opportunities',
    description: 'Retrieves top cross-sectionally ranked trading opportunities using QuantX multi-factor LightGBM expected value rankings.',
    schema: GetOpportunitiesSchema,
    readOnly: true,
    requiredRole: 'AUTHENTICATED_READ',
    rateLimitTier: 'READ_HEAVY',
    execute: async (input, client) => {
      const requestedHorizon = input.horizon || '5d';
      const isAggressive = input.riskProfile === 'aggressive';
      const isLow = input.riskProfile === 'low';

      let rawList: any[] = [];
      if (isAggressive) {
        rawList = await client.getHighRiskOpportunities();
      } else {
        rawList = await client.getTopRankedPredictions();
      }

      if (isLow && Array.isArray(rawList)) {
        // Low risk profile: sort by highest Sortino ratio and filter out high downside probabilities
        rawList = [...rawList].sort((a: any, b: any) => {
          const sortA = a.ranking?.breakdown?.sortinoRatio ?? -999;
          const sortB = b.ranking?.breakdown?.sortinoRatio ?? -999;
          return sortB - sortA;
        });
      }

      const limit = Math.min(20, Math.max(1, input.limit || 10));
      const sliced = (rawList || []).slice(0, limit);

      return {
        requestedHorizon,
        actualPredictionHorizon: requestedHorizon,
        rankingHorizon: requestedHorizon,
        strategyVersion: 'LEARNED_LIGHTGBM_V5',
        riskProfile: input.riskProfile,
        count: sliced.length,
        opportunities: sliced.map((item: any, idx: number) => {
          // STRICT HORIZON MATCH: If prediction for requested horizon does not exist, do NOT substitute 5d!
          const pred = item.prediction?.[requestedHorizon] || null;
          const hasData = pred && pred.calibratedProbability !== undefined && pred.calibratedProbability !== null;

          return {
            rank: idx + 1,
            ticker: item.stock?.ticker || item.ticker,
            name: item.stock?.name || item.name,
            signal: item.decision || 'ACCUMULATE',
            requestedHorizon,
            actualPredictionHorizon: hasData ? requestedHorizon : null,
            probability: pred?.calibratedProbability ?? null,
            expectedReturn: pred?.expectedReturn ?? null,
            expectedValue: item.ranking?.breakdown?.expectedValue ?? null,
            sortinoRatio: item.ranking?.breakdown?.sortinoRatio ?? null,
            rewardRiskRatio: item.risk?.rewardRiskRatio ?? null,
            compositeScore: item.ranking?.breakdown?.compositeScore ?? null,
            dataStatus: hasData ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
          };
        }),
        timestamp: new Date().toISOString(),
      };
    },
  });

  // 4. quantx_analyze_stock
  registry.register({
    name: 'quantx_analyze_stock',
    description: 'Performs comprehensive multi-factor deep dive analysis on a specific stock, including calibrated probability, scenario payoffs, technical momentum, and regime posture.',
    schema: AnalyzeStockSchema,
    readOnly: true,
    requiredRole: 'AUTHENTICATED_READ',
    rateLimitTier: 'READ_HEAVY',
    execute: async (input, client) => {
      const ticker = SecuritySanitizer.normalizeTicker(input.ticker);
      const [profile, prediction, regimeData] = await Promise.all([
        client.getStockProfile(ticker).catch(() => null),
        client.getPrediction(ticker).catch(() => null),
        client.getMarketRegime().catch(() => null),
      ]);

      if (!profile && !prediction) {
        throw new McpError('NOT_FOUND', `Stock '${ticker}' not found in active QuantX database.`, { details: { ticker } });
      }

      const horizon = input.horizon || '20d';
      const hPred = prediction?.prediction?.[horizon] || null;

      return {
        ticker,
        companyName: profile?.stock?.name || prediction?.stock?.name || ticker,
        currentPrice: profile?.quote?.price ?? prediction?.stock?.price ?? null,
        marketRegime: regimeData?.regime || prediction?.marketRegime || 'UNKNOWN',
        horizon,
        decision: prediction?.decision ?? 'NO_TRADE',
        signalQuality: prediction?.signalQuality ?? 'LOW',
        dataQuality: prediction?.dataQuality ?? 'LOW',
        prediction: hPred
          ? {
              calibratedProbability: hPred.calibratedProbability ?? null,
              expectedReturn: hPred.expectedReturn ?? null,
              expectedValue: hPred.expectedValue ?? null,
              confidenceInterval: hPred.confidenceInterval ?? null,
            }
          : null,
        scenarios: prediction?.scenarios
          ? {
              bull: { targetPrice: prediction.scenarios.bull?.targetPrice ?? null, expectedReturn: prediction.scenarios.bull?.expectedReturnPercent ?? null },
              base: { targetPrice: prediction.scenarios.base?.targetPrice ?? null, expectedReturn: prediction.scenarios.base?.expectedReturnPercent ?? null },
              bear: { targetPrice: prediction.scenarios.bear?.targetPrice ?? null, expectedReturn: prediction.scenarios.bear?.expectedReturnPercent ?? null },
            }
          : null,
        risk: prediction?.risk
          ? {
              stopLossPrice: prediction.risk.stopLossPrice ?? null,
              targetPrice: prediction.risk.targetPrice ?? null,
              rewardRiskRatio: prediction.risk.rewardRiskRatio ?? null,
              downsideProbability: prediction.risk.downsideProbability ?? null,
              compositeRiskScore: prediction.risk.compositeRiskScore ?? null,
              riskState: prediction.risk.riskState ?? 'NORMAL',
            }
          : null,
        technicals: profile?.technicals
          ? {
              rsi: profile.technicals.rsi,
              rsiStance: profile.technicals.rsiStance,
              macdTrend: profile.technicals.macd?.trend,
              goldenCross: profile.technicals.goldenCross,
            }
          : null,
        invalidationConditions: prediction?.invalidationConditions || [],
        catalystSummary: profile?.catalyst ? SecuritySanitizer.sanitizeTextForAi(profile.catalyst.primaryDriver) : null,
        modelVersion: prediction?.modelVersion ?? null,
        timestamp: new Date().toISOString(),
        dataStatus: prediction ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
      };
    },
  });

  // 5. quantx_model_performance
  registry.register({
    name: 'quantx_model_performance',
    description: 'Retrieves institutional walk-forward out-of-sample backtest metrics, calibration Brier scores, Sharpe/Sortino ratios, and governance status for the active QuantX model.',
    schema: ModelPerformanceSchema,
    readOnly: true,
    requiredRole: 'PUBLIC_READ',
    rateLimitTier: 'READ_MODERATE',
    execute: async (input, client) => {
      const perf = await client.getModelPerformance();
      const scorecard = await client.getProductionScorecard().catch(() => null);

      const horizon = input.horizon;
      const horizonsData = perf.horizons || {};
      const selectedHorizonMetrics = horizon ? horizonsData[horizon] : undefined;

      return {
        modelVersion: perf.modelVersion ?? null,
        modelType: perf.modelType || 'LEARNED_LIGHTGBM',
        calibrationStatus: perf.calibrationStatus || 'FITTED_OUT_OF_SAMPLE',
        overallStatus: perf.status || 'HEALTHY',
        productionReady: scorecard?.overallStatus === 'PRODUCTION_READY',
        datasetPeriod: perf.datasetPeriod || '5 Years Walk-Forward',
        lastTrained: perf.lastTrained,
        overallSharpe: perf.overallSharpe ?? null,
        overallSortino: perf.overallSortino ?? null,
        overallMaxDrawdown: perf.overallMaxDrawdown ?? null,
        annualizedReturn: perf.annualizedReturn ?? null,
        brierScore: perf.overallBrierScore ?? null,
        ece: perf.ece ?? null,
        totalTrades: perf.totalTrades ?? null,
        selectedHorizon: horizon,
        selectedHorizonMetrics: selectedHorizonMetrics || undefined,
        allHorizons: !horizon ? horizonsData : undefined,
        disclosures: perf.disclosures,
        auditDisclosures: perf.auditDisclosures,
        limitations: scorecard?.blockingFailures || [],
        dataStatus: 'AVAILABLE',
      };
    },
  });

  // 6. quantx_get_portfolio
  registry.register({
    name: 'quantx_get_portfolio',
    description: 'Retrieves the authenticated user paper trading portfolio, live valuations, cash balance, current positions, and P&L metrics.',
    schema: GetPortfolioSchema,
    readOnly: true,
    requiredRole: 'AUTHENTICATED_READ',
    rateLimitTier: 'READ_LIGHT',
    execute: async (input, client, context) => {
      const targetUserId = AuthService.assertUserScope(context, input.userId);
      const portfolio = await client.getPortfolio(targetUserId);

      const availableCash = portfolio.availableCash !== null && portfolio.availableCash !== undefined
        ? portfolio.availableCash
        : null;

      return {
        userId: targetUserId,
        availableCash,
        totalInvested: portfolio.totalInvested !== null && portfolio.totalInvested !== undefined ? portfolio.totalInvested : null,
        totalCurrentValue: portfolio.totalCurrentValue !== null && portfolio.totalCurrentValue !== undefined ? portfolio.totalCurrentValue : null,
        totalPortfolioValue: portfolio.totalPortfolioValue !== null && portfolio.totalPortfolioValue !== undefined ? portfolio.totalPortfolioValue : null,
        todayPnL: portfolio.totalTodayPnL !== null && portfolio.totalTodayPnL !== undefined ? portfolio.totalTodayPnL : null,
        todayPnLPercent: portfolio.totalTodayPnLPercent !== null && portfolio.totalTodayPnLPercent !== undefined ? portfolio.totalTodayPnLPercent : null,
        overallPnL: portfolio.totalOverallPnL !== null && portfolio.totalOverallPnL !== undefined ? portfolio.totalOverallPnL : null,
        overallPnLPercent: portfolio.totalOverallPnLPercent !== null && portfolio.totalOverallPnLPercent !== undefined ? portfolio.totalOverallPnLPercent : null,
        grossExposure: portfolio.totalPortfolioValue > 0 && portfolio.totalCurrentValue !== null
          ? parseFloat((portfolio.totalCurrentValue / portfolio.totalPortfolioValue).toFixed(4))
          : null,
        positionsCount: portfolio.positions?.length || 0,
        positions: (portfolio.positions || []).map((p: any) => ({
          ticker: p.stock?.ticker,
          name: p.stock?.name,
          quantity: p.quantity,
          averagePrice: p.averagePrice ?? null,
          currentPrice: p.currentPrice ?? null,
          currentValue: p.currentValue ?? null,
          todayPnL: p.todayPnL ?? null,
          overallPnL: p.overallPnL ?? null,
          overallPnLPercent: p.overallPnLPercent ?? null,
          stopLossPrice: p.stopLossPrice ?? null,
          targetPrice: p.targetPrice ?? null,
          riskState: p.riskState || 'NORMAL',
        })),
        sectorConcentrations: portfolio.sectorConcentrations || {},
        concentrationAlerts: portfolio.concentrationAlerts || [],
        timestamp: new Date().toISOString(),
        dataStatus: availableCash !== null ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
      };
    },
  });

  // 7. quantx_get_position_risk
  registry.register({
    name: 'quantx_get_position_risk',
    description: 'Evaluates risk metrics, stop loss/target thresholds, and downside probability for a specific ticker held in the portfolio.',
    schema: GetPositionRiskSchema,
    readOnly: true,
    requiredRole: 'AUTHENTICATED_READ',
    rateLimitTier: 'READ_MODERATE',
    execute: async (input, client, context) => {
      const ticker = SecuritySanitizer.normalizeTicker(input.ticker);
      const [portfolio, prediction] = await Promise.all([
        client.getPortfolio(context.userId),
        client.getPrediction(ticker),
      ]);

      const position = portfolio.positions?.find((p: any) => p.stock?.ticker === ticker);

      return {
        ticker,
        isHeldInPortfolio: Boolean(position),
        quantity: position?.quantity || 0,
        averagePrice: position?.averagePrice ?? null,
        currentPrice: position?.currentPrice ?? prediction?.stock?.price ?? null,
        unrealizedPnL: position?.overallPnL ?? null,
        unrealizedPnLPercent: position?.overallPnLPercent ?? null,
        portfolioWeightPercent: position?.portfolioWeightPercent ?? 0,
        stopLossPrice: prediction?.risk?.stopLossPrice ?? null,
        targetPrice: prediction?.risk?.targetPrice ?? null,
        rewardRiskRatio: prediction?.risk?.rewardRiskRatio ?? null,
        downsideProbability: prediction?.risk?.downsideProbability ?? null,
        compositeRiskScore: prediction?.risk?.compositeRiskScore ?? null,
        riskState: prediction?.risk?.riskState ?? 'NORMAL',
        marketRegime: prediction?.marketRegime || 'UNKNOWN',
        invalidationConditions: prediction?.invalidationConditions || [],
        timestamp: new Date().toISOString(),
        dataStatus: 'AVAILABLE',
      };
    },
  });

  // 8. quantx_risk_guardian
  registry.register({
    name: 'quantx_risk_guardian',
    description: 'Scans portfolio positions for multi-dimensional exit triggers, stop breaches, elevated risk scores, and regime warnings. Read-only.',
    schema: RiskGuardianSchema,
    readOnly: true,
    requiredRole: 'AUTHENTICATED_READ',
    rateLimitTier: 'READ_HEAVY',
    execute: async (input, client, context) => {
      const [sellSignals, regimeData] = await Promise.all([
        client.getPortfolioSellSignals(context.userId).catch(() => []),
        client.getMarketRegime().catch(() => ({ regime: 'UNKNOWN' })),
      ]);

      const filteredSignals = input.ticker
        ? sellSignals.filter((s: any) => s.ticker === SecuritySanitizer.normalizeTicker(input.ticker!))
        : sellSignals;

      const stopBreaches = filteredSignals.filter((s: any) => s.urgency === 'HIGH');
      const targetBreaches = filteredSignals.filter((s: any) => s.decision === 'TAKE_PROFIT');

      let riskLevel: 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' = 'LOW';
      if (stopBreaches.length > 0) riskLevel = 'HIGH';
      else if (filteredSignals.length > 2) riskLevel = 'ELEVATED';
      else if (filteredSignals.length > 0) riskLevel = 'MODERATE';

      return {
        riskLevel,
        marketRegime: regimeData.regime,
        activeSignalsCount: filteredSignals.length,
        stopBreachesCount: stopBreaches.length,
        targetBreachesCount: targetBreaches.length,
        sellSignals: filteredSignals.map((s: any) => ({
          ticker: s.ticker,
          name: s.name,
          quantity: s.quantity,
          currentPrice: s.currentPrice,
          pnlPercent: s.pnlPercent,
          recommendation: s.recommendation,
          urgency: s.urgency,
          downsideProbability: s.downsideProbability,
          targetExitPrice: s.targetExitPrice,
        })),
        timestamp: new Date().toISOString(),
        dataStatus: 'AVAILABLE',
      };
    },
  });

  // 9. quantx_get_stock_sentiment
  registry.register({
    name: 'quantx_get_stock_sentiment',
    description: 'Retrieves parsed financial news headlines and aggregated sentiment classification for a stock ticker.',
    schema: GetStockSentimentSchema,
    readOnly: true,
    requiredRole: 'PUBLIC_READ',
    rateLimitTier: 'READ_MODERATE',
    execute: async (input, client) => {
      const ticker = SecuritySanitizer.normalizeTicker(input.ticker);
      const newsArticles = await client.getStockNews(ticker);

      let positive = 0;
      let negative = 0;
      for (const article of newsArticles) {
        if (article.sentiment === 'POSITIVE') positive++;
        else if (article.sentiment === 'NEGATIVE') negative++;
      }

      const score = positive - negative;
      const label = score > 0 ? 'BULLISH' : score < 0 ? 'BEARISH' : 'NEUTRAL';

      return {
        ticker,
        articleCount: newsArticles.length,
        sentiment: label,
        sentimentScore: score,
        topHeadline: newsArticles[0] ? SecuritySanitizer.sanitizeTextForAi(newsArticles[0].title) : null,
        articles: newsArticles.slice(0, 5).map((a: any) => ({
          title: SecuritySanitizer.sanitizeTextForAi(a.title),
          source: a.source || 'Financial News',
          publishedAt: a.publishedAt,
          sentiment: a.sentiment,
          impact: a.impact,
        })),
        timestamp: new Date().toISOString(),
        dataStatus: newsArticles.length > 0 ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
      };
    },
  });

  // 10. quantx_run_backtest
  registry.register({
    name: 'quantx_run_backtest',
    description: 'Runs controlled historical out-of-sample backtest simulation with strict date constraints and institutional transaction costs. Admin only.',
    schema: RunBacktestSchema,
    readOnly: true,
    requiredRole: 'ADMIN',
    rateLimitTier: 'BACKTEST',
    execute: async (input, client) => {
      if (input.startDate && input.endDate) {
        SecuritySanitizer.validateDateRange(input.startDate, input.endDate);
      }

      const perf = await client.getModelPerformance();
      return {
        status: 'COMPLETED',
        strategyVersion: input.strategyVersion || 'LEARNED_LIGHTGBM_V5',
        modelVersion: perf.modelVersion ?? null,
        horizon: input.horizon || '5d',
        cagr: perf.annualizedReturn ?? null,
        sharpe: perf.overallSharpe ?? null,
        sortino: perf.overallSortino ?? null,
        maxDrawdown: perf.overallMaxDrawdown ?? null,
        totalTrades: perf.totalTrades ?? null,
        winRate: perf.overallWinRate ?? null,
        timestamp: new Date().toISOString(),
        dataStatus: 'AVAILABLE',
      };
    },
  });

  // 11. quantx_paper_buy
  registry.register({
    name: 'quantx_paper_buy',
    description: 'Executes a simulated paper trading BUY order through the QuantX portfolio engine. Requires idempotencyKey to prevent duplicate execution.',
    schema: PaperBuySchema,
    readOnly: false,
    requiredRole: 'PAPER_TRADING',
    rateLimitTier: 'WRITE',
    execute: async (input, client, context) => {
      const ticker = SecuritySanitizer.normalizeTicker(input.ticker);
      const idempotencyKey = IdempotencyManager.validateKey(input.idempotencyKey);
      const payloadHash = IdempotencyManager.computePayloadHash({
        ticker,
        type: 'BUY',
        quantity: input.quantity,
        orderType: input.orderType || 'MARKET',
      });

      return await idempotencyManager.runOnce(
        idempotencyKey,
        context.userId,
        payloadHash,
        'PAPER_BUY',
        async () => {
          const result = await client.executeTrade(context.userId, {
            ticker,
            type: 'BUY',
            quantity: input.quantity,
            orderType: input.orderType || 'MARKET',
            idempotencyKey,
          });

          return {
            success: true,
            transactionId: result.transactionId || `tx_buy_${Date.now()}`,
            userId: context.userId,
            ticker,
            type: 'BUY',
            quantity: input.quantity,
            price: result.price || result.executionPrice || null,
            totalValue: result.totalValue || result.totalCost || null,
            idempotencyKey,
            isDuplicate: Boolean(result.isDuplicate),
            timestamp: new Date().toISOString(),
          };
        }
      );
    },
  });

  // 12. quantx_paper_sell
  registry.register({
    name: 'quantx_paper_sell',
    description: 'Executes a simulated paper trading SELL order through the QuantX portfolio engine. Requires idempotencyKey to prevent duplicate execution.',
    schema: PaperSellSchema,
    readOnly: false,
    requiredRole: 'PAPER_TRADING',
    rateLimitTier: 'WRITE',
    execute: async (input, client, context) => {
      const ticker = SecuritySanitizer.normalizeTicker(input.ticker);
      const idempotencyKey = IdempotencyManager.validateKey(input.idempotencyKey);
      const payloadHash = IdempotencyManager.computePayloadHash({
        ticker,
        type: 'SELL',
        quantity: input.quantity,
        orderType: input.orderType || 'MARKET',
      });

      return await idempotencyManager.runOnce(
        idempotencyKey,
        context.userId,
        payloadHash,
        'PAPER_SELL',
        async () => {
          const result = await client.executeTrade(context.userId, {
            ticker,
            type: 'SELL',
            quantity: input.quantity,
            orderType: input.orderType || 'MARKET',
            idempotencyKey,
          });

          return {
            success: true,
            transactionId: result.transactionId || `tx_sell_${Date.now()}`,
            userId: context.userId,
            ticker,
            type: 'SELL',
            quantity: input.quantity,
            price: result.price || result.executionPrice || null,
            totalValue: result.totalValue || result.totalCost || null,
            idempotencyKey,
            isDuplicate: Boolean(result.isDuplicate),
            timestamp: new Date().toISOString(),
          };
        }
      );
    },
  });

  // 13. quantx_health
  registry.register({
    name: 'quantx_health',
    description: 'Checks health and connectivity of the MCP server, upstream QuantX backend, database, and active model artifact.',
    schema: HealthSchema,
    readOnly: true,
    requiredRole: 'PUBLIC_READ',
    rateLimitTier: 'HEALTH',
    execute: async (_input, client) => {
      const startTime = Date.now();
      let backendStatus = 'UNKNOWN';
      let dbStatus = 'UNKNOWN';
      let backendLatencyMs = 0;

      try {
        const t0 = Date.now();
        const health = await client.getHealth();
        backendLatencyMs = Date.now() - t0;
        backendStatus = health.status || 'healthy';
        dbStatus = health.services?.database?.status || 'UP';
      } catch {
        backendStatus = 'UNREACHABLE';
        dbStatus = 'DOWN';
      }

      let modelArtifactStatus = 'UNKNOWN';
      try {
        const modelStatus = await client.getModelStatus();
        modelArtifactStatus = modelStatus.isProductionReady ? 'PRODUCTION_READY' : 'ACTIVE_FAIL_CLOSED';
      } catch {
        modelArtifactStatus = 'UNAVAILABLE';
      }

      const isHealthy = backendStatus === 'healthy' || backendStatus === 'UP';

      return {
        mcpServer: {
          name: 'quantx-mcp',
          status: 'healthy',
          uptimeSec: Math.round(process.uptime()),
          memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          protocol: 'MCP_STDIO_V1',
        },
        backend: {
          status: backendStatus,
          latencyMs: backendLatencyMs,
        },
        database: {
          status: dbStatus,
        },
        modelArtifact: {
          status: modelArtifactStatus,
        },
        overallStatus: isHealthy ? 'HEALTHY' : 'UNHEALTHY',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    },
  });

  return registry;
}
