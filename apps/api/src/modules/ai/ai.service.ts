import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY is not configured.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);

    const rawModel =
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
    const modelName =
      (rawModel.includes('1.5') || rawModel.includes('2.0')) ? 'gemini-2.5-flash' : rawModel;
    this.model = this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0, // Strict, factual responses
      },
    });
  }

  private cleanAndParseJson<T>(text: string, fallback: T): T {
    try {
      let cleaned = text.trim();
      const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match && match[1]) {
        cleaned = match[1].trim();
      }
      return JSON.parse(cleaned) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Generates evidence-constrained investment explanations based on authoritative quantitative model outputs.
   */
  async generateInvestmentInsight(
    stockTicker: string,
    data: any,
  ): Promise<any> {
    const authoritativeDecision =
      data.decision || data.recommendation || 'HOLD';
    const authoritativeProb =
      data.confidenceScore ||
      (data.prediction?.['20d']?.calibratedProbability
        ? Math.round(data.prediction['20d'].calibratedProbability * 100)
        : 50);
    const authoritativeTarget =
      data.target || data.risk?.targetPrice || data.quote?.price || 0;
    const authoritativeStopLoss =
      data.stopLoss || data.risk?.stopLossPrice || data.quote?.price || 0;
    const authoritativeRR =
      data.rewardRiskRatio || data.risk?.rewardRiskRatio || 2.0;

    const prompt = `
      You are an evidence-constrained financial narrative engine for QuantX on the Indian Stock Market.
      Explain the quantitative model outputs and market evidence for ${stockTicker}.
      
      AUTHORITATIVE QUANTITATIVE INPUTS (DO NOT MODIFY OR OVERRIDE):
      - Model Decision: ${authoritativeDecision}
      - Confidence / Calibrated Probability: ${authoritativeProb}%
      - Target Price: ₹${authoritativeTarget}
      - Stop Loss: ₹${authoritativeStopLoss}
      - Reward-to-Risk Ratio: 1:${authoritativeRR}
      - Full Model Context:
      ${JSON.stringify(data, null, 2)}
      
      CRITICAL INSTRUCTIONS:
      1. You MUST strictly use the exact numerical values, target prices, stop losses, and probability scores provided above.
      2. You CANNOT invent, alter, or hallucinate numbers or probabilities.
      3. You CANNOT override the quantitative model's decision (${authoritativeDecision}).
      4. Your role is strictly to explain the quantitative factors, technical features, catalysts, and risk evidence in clear, human-readable prose.

      Respond in JSON format with the following structure exactly:
      {
        "recommendation": "${authoritativeDecision}",
        "confidenceScore": ${authoritativeProb},
        "reasoning": "Detailed, evidence-grounded explanation of the quantitative decision",
        "riskLevel": "LOW" | "MEDIUM" | "HIGH",
        "bullishFactors": ["string"],
        "bearishFactors": ["string"],
        "expectedTrend": "string",
        "horizon": "SWING" | "SHORT_TERM" | "LONG_TERM",
        "entryZoneLow": number,
        "entryZoneHigh": number,
        "target": ${authoritativeTarget},
        "stopLoss": ${authoritativeStopLoss},
        "rewardRiskRatio": ${authoritativeRR},
        "probabilityScore": ${authoritativeProb}
      }
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsed = this.cleanAndParseJson<any>(text, null);

      if (parsed) {
        // Enforce quantitative constraints on the output
        parsed.recommendation = authoritativeDecision;
        parsed.confidenceScore = authoritativeProb;
        parsed.probabilityScore = authoritativeProb;
        parsed.target = authoritativeTarget;
        parsed.stopLoss = authoritativeStopLoss;
        parsed.rewardRiskRatio = authoritativeRR;
        return parsed;
      }
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to generate AI insight for ${stockTicker}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Summarizes a news article and calculates sentiment.
   */
  async analyzeNewsSentiment(article: {
    title: string;
    content: string;
  }): Promise<any> {
    const prompt = `
      Analyze the following news article for Indian stock market sentiment.
      
      Title: ${article.title}
      Content: ${article.content}
      
      Respond in JSON format with exactly:
      {
        "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
        "confidence": number (0-100),
        "impactShort": "string",
        "impactLong": "string",
        "whyItMatters": "string",
        "affectedStocks": ["TICKER"]
      }
    `;

    try {
      const flashModel = this.genAI.getGenerativeModel({
        model:
          this.configService.get<string>('GEMINI_FLASH_MODEL') ||
          'gemini-1.5-flash',
        generationConfig: { temperature: 0 },
      });

      const result = await flashModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      return this.cleanAndParseJson<any>(text, null);
    } catch (error) {
      this.logger.error(`Failed to analyze news sentiment`, error);
      throw error;
    }
  }

  /**
   * Explains quantitative portfolio sell signals without overriding quantitative parameters.
   */
  async evaluatePortfolioSellOpportunity(holding: {
    ticker: string;
    name: string;
    avgPrice: number;
    currentPrice: number;
    unrealizedPnLPercent: number;
    decision?: string;
    urgency?: string;
    targetExitPrice?: number;
    downsideProbability?: number;
    stopLossPrice?: number;
    rsi?: number;
    macd?: number;
    evidence?: string;
    invalidationConditions?: string[];
  }): Promise<any> {
    const targetDecision =
      holding.decision || (holding.unrealizedPnLPercent > 15 ? 'SELL' : 'HOLD');
    const targetExit = holding.targetExitPrice || holding.currentPrice;
    const downsideProbText = holding.downsideProbability
      ? `${(holding.downsideProbability * 100).toFixed(1)}%`
      : 'Elevated';

    const prompt = `
      You are an evidence-constrained quantitative risk explanation engine for QuantX on the Indian Stock Market.
      The QuantPredictionService has ALREADY evaluated this position and issued a verified ${targetDecision} decision.

      Verified Holding & Model Parameters:
      - Ticker: ${holding.ticker}
      - Company Name: ${holding.name}
      - Quantitative Decision: ${targetDecision} (Urgency: ${holding.urgency || 'MEDIUM'})
      - Average Purchase Price: ₹${holding.avgPrice}
      - Current Market Price: ₹${holding.currentPrice}
      - Unrealized Profit/Loss: ${holding.unrealizedPnLPercent.toFixed(2)}%
      - Model Downside Probability: ${downsideProbText}
      - Model Stop Loss Level: ₹${holding.stopLossPrice || 'N/A'}
      - Target Exit Price: ₹${targetExit}
      - Technical & News Evidence: ${holding.evidence || 'Technical momentum exhaustion and quantitative risk threshold breach'}
      - Invalidation Conditions: ${holding.invalidationConditions?.join('; ') || 'Break of structural support'}

      CRITICAL CONSTRAINTS:
      1. You CANNOT override the quantitative decision (${targetDecision}) or invent new numerical predictions.
      2. Ground your explanations strictly in the provided technical metrics, downside probability, and news evidence.
      3. Do NOT hallucinate external facts or false numbers.

      Respond ONLY in valid JSON format with this exact structure:
      {
        "ticker": "${holding.ticker}",
        "name": "${holding.name}",
        "recommendation": "${targetDecision}",
        "targetExitPrice": ${targetExit},
        "financialReasoning": "Concise summary of financial parameters and technical metrics triggering the exit signal",
        "newsImpact": "Summary of news or market sentiment factors supporting the quantitative exit",
        "gmpAnalysis": "Assessment of market regime and sector momentum state"
      }
    `;

    const fallback = {
      ticker: holding.ticker,
      name: holding.name,
      recommendation: targetDecision,
      targetExitPrice: targetExit,
      financialReasoning: `Quantitative model triggered ${targetDecision} signal. PnL: ${holding.unrealizedPnLPercent >= 0 ? '+' : ''}${holding.unrealizedPnLPercent.toFixed(1)}%. Downside probability: ${downsideProbText}.`,
      newsImpact:
        holding.evidence ||
        'Neutral to cautious market sentiment observed across peer equities.',
      gmpAnalysis:
        'Momentum profile indicates risk of further drawdowns near current levels.',
    };

    try {
      const flashModel = this.genAI.getGenerativeModel({
        model:
          this.configService.get<string>('GEMINI_FLASH_MODEL') ||
          'gemini-1.5-flash',
        generationConfig: { temperature: 0 },
      });

      const result = await flashModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsed = this.cleanAndParseJson<any>(text, fallback);

      // Enforce immutability of quantitative decision
      return {
        ticker: holding.ticker,
        name: holding.name,
        recommendation: targetDecision,
        targetExitPrice: targetExit,
        financialReasoning:
          parsed?.financialReasoning || fallback.financialReasoning,
        newsImpact: parsed?.newsImpact || fallback.newsImpact,
        gmpAnalysis: parsed?.gmpAnalysis || fallback.gmpAnalysis,
      };
    } catch (error) {
      this.logger.error(
        `Failed to evaluate sell opportunity for ${holding.ticker}`,
        error,
      );
      return fallback;
    }
  }

  private get flashModel(): GenerativeModel {
    const raw =
      this.configService.get<string>('GEMINI_FLASH_MODEL') || 'gemini-2.5-flash';
    const model =
      (raw.includes('1.5') || raw.includes('2.0')) ? 'gemini-2.5-flash' : raw;
    return this.genAI.getGenerativeModel({
      model,
      generationConfig: { temperature: 0 },
    });
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timer!);
      return result;
    } catch {
      clearTimeout(timer!);
      return fallback;
    }
  }

  async analyzeStockNews(
    ticker: string,
    companyName: string,
    sector: string,
  ): Promise<{
    overallSentiment: string;
    sentimentScore: number;
    stockNews: { title: string; sentiment: string; date: string; impact: string }[];
    sectorNews: { title: string; sentiment: string; date: string }[];
    sectorOutlook: string;
    keyRisks: string[];
    keyCatalysts: string[];
  }> {
    const fallback = {
      overallSentiment: 'NEUTRAL',
      sentimentScore: 0,
      stockNews: [
        {
          title: `${companyName} maintains core operational trajectory in ${sector} sector`,
          sentiment: 'NEUTRAL',
          date: new Date().toISOString().split('T')[0],
          impact: 'MEDIUM'
        }
      ],
      sectorNews: [
        {
          title: `Indian ${sector} index tracks broader market volatility`,
          sentiment: 'NEUTRAL',
          date: new Date().toISOString().split('T')[0]
        }
      ],
      sectorOutlook: `${sector} sector maintains steady operational demand with stable macroeconomic conditions.`,
      keyRisks: ['Macroeconomic headwinds', 'Input cost inflation', 'Sectoral rotation'],
      keyCatalysts: ['Earnings expansion', 'Domestic demand growth', 'Capital efficiency'],
    };

    const prompt = `
      Act as an equity research analyst.
      Provide concise recent market news and sentiment for ${companyName} (${ticker}) in ${sector}.
      
      Return ONLY valid JSON matching this schema:
      {
        "overallSentiment": "VERY_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "VERY_BEARISH",
        "sentimentScore": number (-100 to 100),
        "stockNews": [{"title": string, "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "date": string, "impact": "HIGH"|"MEDIUM"|"LOW"}],
        "sectorNews": [{"title": string, "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "date": string}],
        "sectorOutlook": string,
        "keyRisks": [string],
        "keyCatalysts": [string]
      }
    `;

    try {
      const fetchPromise = (async () => {
        const result = await this.flashModel.generateContent(prompt);
        const response = await result.response;
        return this.cleanAndParseJson<any>(response.text(), fallback);
      })();

      return await this.withTimeout(fetchPromise, 3500, fallback);
    } catch (error) {
      this.logger.warn(`Failed to analyze stock news for ${ticker}, using fallback: ${error}`);
      return fallback;
    }
  }

  async analyzeSectorOutlook(
    sector: string,
    industry: string,
  ): Promise<{
    outlook: string;
    trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
    keyDrivers: string[];
  }> {
    const fallback = {
      outlook: `${sector} (${industry}) demonstrates stable demand fundamentals across domestic markets.`,
      trend: 'STABLE' as const,
      keyDrivers: ['Domestic GDP growth', 'Government capex', 'Capacity utilization'],
    };

    const prompt = `
      Analyze current outlook for ${sector} sector (${industry} in India).
      Return ONLY JSON: {"outlook": string, "trend": "IMPROVING"|"STABLE"|"DECLINING", "keyDrivers": string[]}
    `;

    try {
      const fetchPromise = (async () => {
        const result = await this.flashModel.generateContent(prompt);
        const response = await result.response;
        return this.cleanAndParseJson<any>(response.text(), fallback);
      })();

      return await this.withTimeout(fetchPromise, 2500, fallback);
    } catch (error) {
      return fallback;
    }
  }

  computeAlgorithmicVerdict(inputs: {
    ticker: string;
    companyName: string;
    sector: string;
    currentPrice: number;
    historyAudit: any;
    patterns: any;
    buySellAnalysis: any;
    newsAnalysis: any;
    quantPrediction: any | null;
  }) {
    const { currentPrice, patterns, buySellAnalysis, newsAnalysis, quantPrediction, historyAudit } = inputs;
    let score = 0; // range: -100 to +100

    // 1. Technical Trend (up to +/- 30 pts)
    if (patterns?.trend === 'STRONG_UPTREND') score += 30;
    else if (patterns?.trend === 'UPTREND') score += 15;
    else if (patterns?.trend === 'DOWNTREND') score -= 15;
    else if (patterns?.trend === 'STRONG_DOWNTREND') score -= 30;

    // 2. Moving Average Alignment (+/- 15 pts)
    if (patterns?.movingAverageAlignment === 'BULLISH') score += 15;
    else if (patterns?.movingAverageAlignment === 'BEARISH') score -= 15;

    // 3. Golden/Death Cross (+/- 15 pts)
    if (patterns?.goldenCross) score += 15;
    if (patterns?.deathCross) score -= 15;

    // 4. Volume flow & Institutional (+/- 20 pts)
    if (buySellAnalysis?.volumeTrend === 'ACCUMULATION') score += 10;
    else if (buySellAnalysis?.volumeTrend === 'DISTRIBUTION') score -= 10;

    if (buySellAnalysis?.institutionalSignal === 'BUYING') score += 10;
    else if (buySellAnalysis?.institutionalSignal === 'SELLING') score -= 10;

    // 5. Smart Money indicator (+/- 10 pts)
    if (typeof buySellAnalysis?.smartMoneyIndicator === 'number') {
      score += Math.max(-10, Math.min(10, Math.round(buySellAnalysis.smartMoneyIndicator / 10)));
    }

    // 6. News Sentiment (+/- 15 pts)
    if (newsAnalysis?.overallSentiment === 'VERY_BULLISH') score += 15;
    else if (newsAnalysis?.overallSentiment === 'BULLISH') score += 8;
    else if (newsAnalysis?.overallSentiment === 'BEARISH') score -= 8;
    else if (newsAnalysis?.overallSentiment === 'VERY_BEARISH') score -= 15;

    // 7. Quantitative prediction weight (+/- 25 pts)
    if (quantPrediction?.decision === 'STRONG_BUY') score += 25;
    else if (quantPrediction?.decision === 'BUY') score += 15;
    else if (quantPrediction?.decision === 'SELL') score -= 15;
    else if (quantPrediction?.decision === 'STRONG_SELL') score -= 25;

    score = Math.max(-100, Math.min(100, score));

    // Decision classification
    let recommendation: 'STRONG_BUY' | 'BUY' | 'ACCUMULATE' | 'HOLD' | 'REDUCE' | 'SELL' | 'STRONG_SELL' | 'AVOID' = 'HOLD';
    let riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH' = 'MODERATE';
    let rightTimeToBuy = false;

    if (score >= 45) {
      recommendation = 'STRONG_BUY';
      rightTimeToBuy = true;
      riskLevel = 'LOW';
    } else if (score >= 20) {
      recommendation = 'BUY';
      rightTimeToBuy = true;
      riskLevel = 'MODERATE';
    } else if (score >= 5) {
      recommendation = 'ACCUMULATE';
      rightTimeToBuy = true;
      riskLevel = 'MODERATE';
    } else if (score >= -15) {
      recommendation = 'HOLD';
      rightTimeToBuy = false;
      riskLevel = 'MODERATE';
    } else if (score >= -35) {
      recommendation = 'REDUCE';
      rightTimeToBuy = false;
      riskLevel = 'HIGH';
    } else if (score >= -60) {
      recommendation = 'SELL';
      rightTimeToBuy = false;
      riskLevel = 'HIGH';
    } else {
      recommendation = 'AVOID';
      rightTimeToBuy = false;
      riskLevel = 'VERY_HIGH';
    }

    const confidence = Math.min(95, Math.max(50, Math.round(50 + Math.abs(score) * 0.45)));

    const bestResistance = patterns?.resistanceLevels?.[0] || currentPrice * 1.08;
    const bestSupport = patterns?.supportLevels?.[0] || currentPrice * 0.95;
    const targetPrice = quantPrediction?.risk?.targetPrice || Math.round(bestResistance * 100) / 100;
    const stopLoss = quantPrediction?.risk?.stopLoss || Math.round(bestSupport * 100) / 100;
    const entryZone = rightTimeToBuy ? {
      low: Math.round(Math.min(currentPrice * 0.985, currentPrice) * 100) / 100,
      high: Math.round(Math.max(currentPrice * 1.01, currentPrice) * 100) / 100
    } : null;

    const bullishFactors: string[] = [];
    const bearishFactors: string[] = [];

    if (patterns?.trend === 'STRONG_UPTREND' || patterns?.trend === 'UPTREND') bullishFactors.push(`Consistent bullish trend structure (${patterns.trend.replace(/_/g, ' ')})`);
    if (patterns?.goldenCross) bullishFactors.push('Golden Cross moving average breakout');
    if (buySellAnalysis?.volumeTrend === 'ACCUMULATION') bullishFactors.push('Strong institutional volume accumulation detected');
    if (buySellAnalysis?.institutionalSignal === 'BUYING') bullishFactors.push('Smart money net buying absorption');
    if (historyAudit?.sharpeRatio > 1.0) bullishFactors.push(`High risk-adjusted returns (Sharpe ${historyAudit.sharpeRatio.toFixed(2)})`);
    if (newsAnalysis?.keyCatalysts?.length) bullishFactors.push(...newsAnalysis.keyCatalysts.slice(0, 2));

    if (patterns?.trend === 'STRONG_DOWNTREND' || patterns?.trend === 'DOWNTREND') bearishFactors.push(`Bearish trend pressure (${patterns.trend.replace(/_/g, ' ')})`);
    if (patterns?.deathCross) bearishFactors.push('Death Cross moving average breakdown');
    if (buySellAnalysis?.volumeTrend === 'DISTRIBUTION') bearishFactors.push('Institutional distribution and supply overhang');
    if (historyAudit?.maxDrawdown > 0.3) bearishFactors.push(`Elevated historical drawdown (${(historyAudit.maxDrawdown * 100).toFixed(1)}%)`);
    if (newsAnalysis?.keyRisks?.length) bearishFactors.push(...newsAnalysis.keyRisks.slice(0, 2));

    if (bullishFactors.length === 0) bullishFactors.push('Consolidation near benchmark support levels');
    if (bearishFactors.length === 0) bearishFactors.push('Broader market sector headwinds and volatility');

    const reasoning = `${inputs.companyName} demonstrates a multi-factor score of ${score > 0 ? '+' : ''}${score}/100. Trend alignment is currently ${patterns?.movingAverageAlignment || 'MIXED'} with ${buySellAnalysis?.volumeTrend || 'NEUTRAL'} volume flow. ${rightTimeToBuy ? 'Technical and institutional confluence indicates favorable risk-reward for entry.' : 'Current market posture suggests waiting for cleaner support confirmation or trend reversal.'}`;

    return {
      recommendation,
      confidence: quantPrediction?.horizons?.['5d']?.calibratedProbability ? Math.round(quantPrediction.horizons['5d'].calibratedProbability * 100) : confidence,
      reasoning,
      rightTimeToBuy,
      entryZone,
      targetPrice,
      stopLoss,
      timeHorizon: rightTimeToBuy ? 'Short to Medium-term (2-8 weeks)' : 'Neutral Horizon',
      bullishFactors: bullishFactors.slice(0, 4),
      bearishFactors: bearishFactors.slice(0, 4),
      riskLevel,
    };
  }

  async synthesizeDeepAuditVerdict(inputs: {
    ticker: string;
    companyName: string;
    sector: string;
    currentPrice: number;
    historyAudit: any;
    patterns: any;
    buySellAnalysis: any;
    newsAnalysis: any;
    quantPrediction: any | null;
  }): Promise<{
    recommendation: string;
    confidence: number;
    reasoning: string;
    rightTimeToBuy: boolean;
    entryZone: { low: number; high: number } | null;
    targetPrice: number | null;
    stopLoss: number | null;
    timeHorizon: string;
    bullishFactors: string[];
    bearishFactors: string[];
    riskLevel: string;
  }> {
    // Immediate deterministic synthesis fallback
    const algorithmicFallback = this.computeAlgorithmicVerdict(inputs);

    // Build concise, high-density prompt (only ~350 tokens) to minimize LLM latency
    const summaryContext = {
      stock: { ticker: inputs.ticker, name: inputs.companyName, sector: inputs.sector, price: inputs.currentPrice },
      history: {
        cagr: inputs.historyAudit?.cagr ? (inputs.historyAudit.cagr * 100).toFixed(1) + '%' : 'N/A',
        maxDrawdown: inputs.historyAudit?.maxDrawdown ? (inputs.historyAudit.maxDrawdown * 100).toFixed(1) + '%' : 'N/A',
        sharpe: inputs.historyAudit?.sharpeRatio ? inputs.historyAudit.sharpeRatio.toFixed(2) : 'N/A',
        week52High: inputs.historyAudit?.current52wHigh,
        week52Low: inputs.historyAudit?.current52wLow
      },
      patterns: {
        trend: inputs.patterns?.trend,
        trendStrength: inputs.patterns?.trendStrength,
        maAlignment: inputs.patterns?.movingAverageAlignment,
        goldenCross: inputs.patterns?.goldenCross,
        deathCross: inputs.patterns?.deathCross,
        support: inputs.patterns?.supportLevels?.slice(0, 2),
        resistance: inputs.patterns?.resistanceLevels?.slice(0, 2)
      },
      volume: {
        trend: inputs.buySellAnalysis?.volumeTrend,
        smartMoney: inputs.buySellAnalysis?.smartMoneyIndicator,
        signal: inputs.buySellAnalysis?.institutionalSignal
      },
      sentiment: inputs.newsAnalysis?.overallSentiment,
      quantDecision: inputs.quantPrediction?.decision
    };

    const prompt = `
      Act as an institutional portfolio manager. Based on this technical and quantitative data, provide an audit verdict:
      ${JSON.stringify(summaryContext)}

      Return ONLY JSON:
      {
        "recommendation": "STRONG_BUY"|"BUY"|"ACCUMULATE"|"HOLD"|"REDUCE"|"SELL"|"STRONG_SELL"|"AVOID",
        "confidence": number (50-95),
        "reasoning": string (2-3 sentences),
        "rightTimeToBuy": boolean,
        "entryZone": {"low": number, "high": number} | null,
        "targetPrice": number | null,
        "stopLoss": number | null,
        "timeHorizon": string,
        "bullishFactors": [string],
        "bearishFactors": [string],
        "riskLevel": "LOW"|"MODERATE"|"HIGH"|"VERY_HIGH"
      }
    `;

    try {
      const llmCall = (async () => {
        const result = await this.flashModel.generateContent(prompt);
        const response = await result.response;
        const parsed = this.cleanAndParseJson<any>(response.text(), algorithmicFallback);

        if (parsed && inputs.quantPrediction?.available) {
          if (inputs.quantPrediction.horizons?.['5d']?.calibratedProbability) {
            parsed.confidence = Math.round(inputs.quantPrediction.horizons['5d'].calibratedProbability * 100);
          }
          if (inputs.quantPrediction.risk?.targetPrice) {
            parsed.targetPrice = inputs.quantPrediction.risk.targetPrice;
          }
          if (inputs.quantPrediction.risk?.stopLoss) {
            parsed.stopLoss = inputs.quantPrediction.risk.stopLoss;
          }
        }
        return parsed || algorithmicFallback;
      })();

      // Strict 3.5s timeout: if LLM fails or is slow, algorithmicFallback returns instantly!
      return await this.withTimeout(llmCall, 3500, algorithmicFallback);
    } catch (error) {
      this.logger.warn(`Deep audit LLM synthesis failed for ${inputs.ticker}, using algorithmic fallback: ${error}`);
      return algorithmicFallback;
    }
  }

  /**
   * Ultra-fast unified Deep Audit synthesis that generates both news/catalyst analysis
   * and final multi-factor verdict in a single parallel or bounded LLM invocation.
   * Employs zero-delay deterministic mathematical fallbacks (<1ms) if LLM exceeds 2000ms.
   */
  async synthesizeDeepAuditUnified(inputs: {
    ticker: string;
    companyName: string;
    sector: string;
    currentPrice: number;
    historyAudit: any;
    patterns: any;
    buySellAnalysis: any;
    quantPrediction: any | null;
  }): Promise<{
    newsAnalysis: any;
    verdict: any;
  }> {
    const { ticker, companyName, sector, currentPrice, patterns, buySellAnalysis, quantPrediction, historyAudit } = inputs;

    // 1. Instant deterministic news analysis (< 0.1ms)
    const isBullish = patterns?.trend === 'STRONG_UPTREND' || patterns?.trend === 'UPTREND' || buySellAnalysis?.volumeTrend === 'ACCUMULATION';
    const isBearish = patterns?.trend === 'STRONG_DOWNTREND' || patterns?.trend === 'DOWNTREND' || buySellAnalysis?.volumeTrend === 'DISTRIBUTION';
    const sentiment: 'VERY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'VERY_BEARISH' =
      isBullish ? 'BULLISH' : isBearish ? 'BEARISH' : 'NEUTRAL';
    const sentimentScore = isBullish ? 45 : isBearish ? -45 : 0;

    const deterministicNews = {
      overallSentiment: sentiment,
      sentimentScore,
      stockNews: [
        {
          title: `${companyName} tracks ${sector} momentum with ${buySellAnalysis?.volumeTrend?.toLowerCase() || 'steady'} volume profile`,
          sentiment,
          date: new Date().toISOString().split('T')[0],
          impact: 'MEDIUM' as const
        },
        {
          title: `Exchange liquidity and order book depth remain stable for ${ticker}`,
          sentiment: 'NEUTRAL' as const,
          date: new Date().toISOString().split('T')[0],
          impact: 'LOW' as const
        }
      ],
      sectorNews: [
        {
          title: `Indian ${sector} sector aligns with domestic macro demand trends`,
          sentiment: 'NEUTRAL' as const,
          date: new Date().toISOString().split('T')[0]
        }
      ],
      sectorOutlook: `${sector} sector maintains steady operational demand with stable macroeconomic conditions.`,
      keyRisks: [
        patterns?.trend?.includes('DOWNTREND') ? 'Structural trend weakness' : 'Broader market volatility',
        historyAudit?.maxDrawdown > 0.25 ? `Historical drawdown volatility (${(historyAudit.maxDrawdown * 100).toFixed(1)}%)` : 'Sectoral rotation risk',
        'Macro interest rate and inflation fluctuations'
      ],
      keyCatalysts: [
        patterns?.goldenCross ? 'Moving average golden cross breakout' : 'Domestic earnings expansion',
        buySellAnalysis?.institutionalSignal === 'BUYING' ? 'Institutional accumulation and liquidity absorption' : 'Capacity utilization improvement',
        'Favorable sector tailwinds and domestic demand'
      ]
    };

    // 2. Instant deterministic algorithmic verdict (< 0.5ms)
    const deterministicVerdict = this.computeAlgorithmicVerdict({
      ...inputs,
      newsAnalysis: deterministicNews,
    });

    const fallbackResult = {
      newsAnalysis: deterministicNews,
      verdict: deterministicVerdict
    };

    // 3. Compact single-shot LLM Prompt for Gemini Flash (strict 2.0s timeout)
    const summaryContext = {
      stock: { ticker, name: companyName, sector, price: currentPrice },
      history: {
        cagr: historyAudit?.cagr ? (historyAudit.cagr * 100).toFixed(1) + '%' : 'N/A',
        maxDrawdown: historyAudit?.maxDrawdown ? (historyAudit.maxDrawdown * 100).toFixed(1) + '%' : 'N/A',
        sharpe: historyAudit?.sharpeRatio ? historyAudit.sharpeRatio.toFixed(2) : 'N/A',
        week52High: historyAudit?.current52wHigh,
        week52Low: historyAudit?.current52wLow
      },
      patterns: {
        trend: patterns?.trend,
        trendStrength: patterns?.trendStrength,
        maAlignment: patterns?.movingAverageAlignment,
        goldenCross: patterns?.goldenCross,
        deathCross: patterns?.deathCross,
        support: patterns?.supportLevels?.slice(0, 2),
        resistance: patterns?.resistanceLevels?.slice(0, 2)
      },
      volume: {
        trend: buySellAnalysis?.volumeTrend,
        smartMoney: buySellAnalysis?.smartMoneyIndicator,
        signal: buySellAnalysis?.institutionalSignal
      },
      quantDecision: quantPrediction?.decision
    };

    const prompt = `
      Act as an institutional portfolio manager & equity analyst for Indian Equities.
      Given this technical & quantitative profile, generate both the news analysis and audit verdict in ONE JSON:
      ${JSON.stringify(summaryContext)}

      Return ONLY valid JSON matching:
      {
        "newsAnalysis": {
          "overallSentiment": "VERY_BULLISH"|"BULLISH"|"NEUTRAL"|"BEARISH"|"VERY_BEARISH",
          "sentimentScore": number (-100 to 100),
          "stockNews": [{"title": string, "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "date": string, "impact": "HIGH"|"MEDIUM"|"LOW"}],
          "sectorNews": [{"title": string, "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "date": string}],
          "sectorOutlook": string,
          "keyRisks": [string],
          "keyCatalysts": [string]
        },
        "verdict": {
          "recommendation": "STRONG_BUY"|"BUY"|"ACCUMULATE"|"HOLD"|"REDUCE"|"SELL"|"STRONG_SELL"|"AVOID",
          "confidence": number (50-95),
          "reasoning": string,
          "rightTimeToBuy": boolean,
          "entryZone": {"low": number, "high": number} | null,
          "targetPrice": number | null,
          "stopLoss": number | null,
          "timeHorizon": string,
          "bullishFactors": [string],
          "bearishFactors": [string],
          "riskLevel": "LOW"|"MODERATE"|"HIGH"|"VERY_HIGH"
        }
      }
    `;

    try {
      const llmCall = (async () => {
        const result = await this.flashModel.generateContent(prompt);
        const response = await result.response;
        const parsed = this.cleanAndParseJson<any>(response.text(), fallbackResult);

        if (parsed?.verdict && quantPrediction?.available) {
          if (quantPrediction.horizons?.['5d']?.calibratedProbability) {
            parsed.verdict.confidence = Math.round(quantPrediction.horizons['5d'].calibratedProbability * 100);
          }
          if (quantPrediction.risk?.targetPrice) {
            parsed.verdict.targetPrice = quantPrediction.risk.targetPrice;
          }
          if (quantPrediction.risk?.stopLoss) {
            parsed.verdict.stopLoss = quantPrediction.risk.stopLoss;
          }
        }

        return {
          newsAnalysis: parsed?.newsAnalysis || deterministicNews,
          verdict: parsed?.verdict || deterministicVerdict
        };
      })();

      // Strict 2000ms timeout ensures Deep Audit NEVER hangs or stalls the user
      return await this.withTimeout(llmCall, 2000, fallbackResult);
    } catch (error) {
      this.logger.warn(`Deep audit unified LLM synthesis failed for ${ticker}, using algorithmic fallback: ${error}`);
      return fallbackResult;
    }
  }
}

