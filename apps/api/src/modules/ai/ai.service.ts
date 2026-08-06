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
    
    const modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-1.5-pro-latest';
    this.model = this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0, // Strict, factual responses
      },
    });
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
      
      // Clean up markdown block if present
      if (text.startsWith('\`\`\`json')) {
        text = text.substring(7, text.length - 3).trim();
      } else if (text.startsWith('\`\`\`')) {
        text = text.substring(3, text.length - 3).trim();
      }

      return JSON.parse(text);
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
        model: this.configService.get<string>('GEMINI_FLASH_MODEL') || 'gemini-1.5-flash-latest',
        generationConfig: { temperature: 0 },
      });
      
      const result = await flashModel.generateContent(prompt);
      const response = await result.response;
      let text = response.text();
      
      if (text.startsWith('\`\`\`json')) {
        text = text.substring(7, text.length - 3).trim();
      } else if (text.startsWith('\`\`\`')) {
        text = text.substring(3, text.length - 3).trim();
      }

      return JSON.parse(text);
    } catch (error) {
      this.logger.error(`Failed to analyze news sentiment`, error);
      throw error;
    }
  }
}
