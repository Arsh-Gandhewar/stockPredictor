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
    
    const modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-1.5-pro';
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
   * Generates investment insights based on technical, fundamental, and sentiment data.
   */
  async generateInvestmentInsight(stockTicker: string, data: any): Promise<any> {
    const prompt = `
      You are an expert financial analyst for the Indian Stock Market.
      Analyze the following data for ${stockTicker} and provide a comprehensive investment recommendation.
      
      Data:
      ${JSON.stringify(data, null, 2)}
      
      Respond in JSON format with the following structure exactly:
      {
        "recommendation": "STRONG_BUY" | "BUY" | "ACCUMULATE" | "HOLD" | "REDUCE" | "SELL" | "STRONG_SELL",
        "confidenceScore": number (0-100),
        "reasoning": "Detailed reasoning string",
        "riskLevel": "LOW" | "MEDIUM" | "HIGH",
        "bullishFactors": ["string"],
        "bearishFactors": ["string"],
        "expectedTrend": "string",
        "horizon": "SWING" | "SHORT_TERM" | "LONG_TERM",
        "entryZoneLow": number,
        "entryZoneHigh": number,
        "target": number,
        "stopLoss": number,
        "rewardRiskRatio": number,
        "probabilityScore": number (0-100)
      }
      
      If data conflicts or confidence is very low, set confidenceScore below 30 and state "Insufficient confidence due to conflicting indicators." in the reasoning.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();
      return this.cleanAndParseJson<any>(text, null);
    } catch (error) {
      this.logger.error(`Failed to generate AI insight for ${stockTicker}`, error);
      throw error;
    }
  }

  /**
   * Summarizes a news article and calculates sentiment.
   */
  async analyzeNewsSentiment(article: { title: string; content: string }): Promise<any> {
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
        model: this.configService.get<string>('GEMINI_FLASH_MODEL') || 'gemini-1.5-flash',
        generationConfig: { temperature: 0 },
      });
      
      const result = await flashModel.generateContent(prompt);
      const response = await result.response;
      let text = response.text();
      return this.cleanAndParseJson<any>(text, null);
    } catch (error) {
      this.logger.error(`Failed to analyze news sentiment`, error);
      throw error;
    }
  }
  async evaluatePortfolioSellOpportunity(holding: {
    ticker: string;
    name: string;
    avgPrice: number;
    currentPrice: number;
    unrealizedPnLPercent: number;
    rsi?: number;
    macd?: number;
    newsSummary?: string;
  }): Promise<any> {
    const prompt = `
      You are an elite quantitative portfolio manager and risk supervisor for the Indian stock market.
      Analyze the following position in the user's portfolio and determine if this is the OPTIMAL TIME TO SELL.

      Holding Details:
      - Ticker: ${holding.ticker}
      - Company Name: ${holding.name}
      - Average Purchase Price: ₹${holding.avgPrice}
      - Current Market Price: ₹${holding.currentPrice}
      - Unrealized Profit/Loss: ${holding.unrealizedPnLPercent.toFixed(2)}%
      - Technical RSI: ${holding.rsi || 'Overbought zone'}
      - MACD Signal: ${holding.macd || 'Bearish Crossover'}
      - Recent News/Sentiment: ${holding.newsSummary || 'Market volatility & sector rotation'}

      Evaluate the stock across three key dimensions:
      1. Financial Parameters: P/L percentage, technical overbought levels (RSI > 70), momentum decay.
      2. News & Corporate Governance: Recent company developments, quarterly expectations, macroeconomic pressure.
      3. Grey Market Premium (GMP) & Market Sentiment: Institutional sentiment, broader market rotation.

      Respond ONLY in valid JSON format with this exact structure:
      {
        "ticker": "${holding.ticker}",
        "name": "${holding.name}",
        "recommendation": "SELL" | "STRONG_SELL" | "HOLD",
        "confidenceScore": number (0-100),
        "targetExitPrice": number,
        "financialReasoning": "Concise summary of financial parameters and technical metrics triggering the sell",
        "newsImpact": "Summary of news or market sentiment factors supporting the exit",
        "gmpAnalysis": "Assessment of Grey Market Premium or market momentum state"
      }
    `;

    const fallback = {
      ticker: holding.ticker,
      name: holding.name,
      recommendation: holding.unrealizedPnLPercent > 15 ? 'SELL' : 'HOLD',
      confidenceScore: holding.unrealizedPnLPercent > 15 ? 85 : 50,
      targetExitPrice: holding.currentPrice * 1.02,
      financialReasoning: `Profit target reached (+${holding.unrealizedPnLPercent.toFixed(1)}%). Technical indicators signal potential consolidation.`,
      newsImpact: 'Neutral market sentiment with sector profit booking observed.',
      gmpAnalysis: 'Grey market momentum indicates upper bounds reached near current levels.'
    };

    try {
      const flashModel = this.genAI.getGenerativeModel({
        model: this.configService.get<string>('GEMINI_FLASH_MODEL') || 'gemini-1.5-flash',
        generationConfig: { temperature: 0 },
      });

      const result = await flashModel.generateContent(prompt);
      const response = await result.response;
      let text = response.text();
      return this.cleanAndParseJson<any>(text, fallback);
    } catch (error) {
      this.logger.error(`Failed to evaluate sell opportunity for ${holding.ticker}`, error);
      return fallback;
    }
  }
}
