import { Injectable } from '@nestjs/common';
import { RiskAssessment } from '../prediction.types';
import { MarketQuote } from '../../stock/providers/market-data.provider.interface';

@Injectable()
export class RiskEngine {
  calculateRisk(
    quote: MarketQuote,
    features: Record<string, number | null>,
    downsideProbability: number
  ): RiskAssessment {
    const atr = features['atr_14'] || quote.price * 0.02; // 2% fallback
    
    // ATR-based stop loss (e.g. 2 ATRs)
    const stopLossPrice = parseFloat((quote.price - (2 * atr)).toFixed(2));
    // Volatility-scaled target (e.g. 3 ATRs)
    const targetPrice = parseFloat((quote.price + (3 * atr)).toFixed(2));
    
    const risk = quote.price - stopLossPrice;
    const reward = targetPrice - quote.price;
    const rewardRiskRatio = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : 0;
    
    const liquidityFlag = (quote.volume || 0) < 100000;
    
    return {
      stopLossPrice,
      targetPrice,
      rewardRiskRatio,
      positionSizeWeight: liquidityFlag ? 0.5 : 1.0,
      downsideProbability,
      volatility: atr / quote.price,
      liquidityFlag,
    };
  }
}
