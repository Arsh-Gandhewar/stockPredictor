import { Injectable } from '@nestjs/common';
import { Decision, MarketRegime, RiskAssessment, SignalQuality, DataQuality } from '../prediction.types';

@Injectable()
export class DecisionEngine {
  makeDecision(
    prob20d: number,
    risk: RiskAssessment,
    regime: MarketRegime,
    dataQuality: DataQuality,
    signalQuality: SignalQuality
  ): Decision {
    if (dataQuality === 'LOW' || risk.liquidityFlag || signalQuality === 'LOW') {
      return 'NO_TRADE';
    }

    if (risk.downsideProbability > 0.75 || prob20d < 0.25) return 'STRONG_SELL';
    if (risk.downsideProbability > 0.60 || prob20d < 0.40) return 'SELL';
    if (risk.downsideProbability > 0.50 || prob20d < 0.48) return 'REDUCE';

    if (prob20d > 0.8 && risk.rewardRiskRatio > 2.5) return 'STRONG_BUY';
    if (prob20d > 0.65 && risk.rewardRiskRatio > 2.0) return 'BUY';
    if (prob20d > 0.55) return 'ACCUMULATE';
    
    return 'HOLD';
  }
}
