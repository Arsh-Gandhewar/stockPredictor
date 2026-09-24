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

    const modelName =
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-1.5-pro';
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
    return this.genAI.getGenerativeModel({
      model:
        this.configService.get<string>('GEMINI_FLASH_MODEL') ||
        'gemini-1.5-flash',
      generationConfig: { temperature: 0 },
    });
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
    const prompt = `
      Act as a financial news analyst.
      Research and provide the latest news about ${companyName} (ticker: ${ticker}) in the ${sector} sector.
      
      Return a JSON response with:
      - overallSentiment (VERY_BULLISH/BULLISH/NEUTRAL/BEARISH/VERY_BEARISH)
      - sentimentScore (-100 to +100)
      - stockNews (array of up to 5 recent headlines with sentiment, date estimate, and impact level)
      - sectorNews (array of up to 3 sector headlines with sentiment, date)
      - sectorOutlook (1-2 sentence outlook)
      - keyRisks (array of up to 4 risk factors)
      - keyCatalysts (array of up to 4 positive catalysts)
    `;

    const fallback = {
      overallSentiment: 'NEUTRAL',
      sentimentScore: 0,
      stockNews: [],
      sectorNews: [],
      sectorOutlook: 'Neutral outlook',
      keyRisks: [],
      keyCatalysts: [],
    };

    try {
      const result = await this.flashModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      return this.cleanAndParseJson<any>(text, fallback);
    } catch (error) {
      this.logger.error(`Failed to analyze stock news for ${ticker}`, error);
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
    const prompt = `
      Analyze the current outlook for the ${sector} sector, specifically the ${industry} industry in India.
      
      Return a JSON response with:
      - outlook (string)
      - trend (IMPROVING | STABLE | DECLINING)
      - keyDrivers (array of strings)
    `;

    const fallback = {
      outlook: 'Neutral outlook',
      trend: 'STABLE' as const,
      keyDrivers: [],
    };

    try {
      const result = await this.flashModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      return this.cleanAndParseJson<any>(text, fallback);
    } catch (error) {
      this.logger.error(`Failed to analyze sector outlook for ${sector}`, error);
      return fallback;
    }
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
    const prompt = `
      Based on all the technical, fundamental, pattern, volume, news, and quantitative data provided, determine if NOW is the right time to buy this stock.

      Data:
      ${JSON.stringify(inputs, null, 2)}

      Return a JSON response with:
      - recommendation (STRONG_BUY/BUY/ACCUMULATE/HOLD/REDUCE/SELL/STRONG_SELL/AVOID)
      - confidence (0-100)
      - reasoning (3-5 sentences explaining the verdict)
      - rightTimeToBuy (boolean)
      - entryZone (object with low and high or null)
      - targetPrice (number or null)
      - stopLoss (number or null)
      - timeHorizon (Short-term/Medium-term/Long-term)
      - bullishFactors (array of 3-5 factors)
      - bearishFactors (array of 3-5 factors)
      - riskLevel (LOW/MODERATE/HIGH/VERY_HIGH)
    `;

    const fallback = {
      recommendation: 'HOLD',
      confidence: 50,
      reasoning: 'Insufficient data to determine a definitive verdict.',
      rightTimeToBuy: false,
      entryZone: null,
      targetPrice: null,
      stopLoss: null,
      timeHorizon: 'Medium-term',
      bullishFactors: [],
      bearishFactors: [],
      riskLevel: 'MODERATE',
    };

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsed = this.cleanAndParseJson<any>(text, fallback);

      if (parsed && inputs.quantPrediction) {
        parsed.confidence =
          (inputs.quantPrediction.horizons?.['5d']?.calibratedProbability * 100) || parsed.confidence;
        parsed.targetPrice =
          inputs.quantPrediction.risk?.targetPrice || parsed.targetPrice;
        parsed.stopLoss =
          inputs.quantPrediction.risk?.stopLoss || parsed.stopLoss;
      }

      return parsed || fallback;
    } catch (error) {
      this.logger.error(`Failed to synthesize deep audit verdict for ${inputs.ticker}`, error);
      return fallback;
    }
  }
}
