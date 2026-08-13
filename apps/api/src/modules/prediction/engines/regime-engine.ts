import { Injectable } from '@nestjs/common';
import { MarketRegime } from '../prediction.types';
import { MarketIndexBenchmark } from '../../stock/providers/market-data.provider.interface';

@Injectable()
export class RegimeEngine {
  detectRegime(indices: MarketIndexBenchmark[]): MarketRegime {
    const nifty = indices.find(i => i.symbol === '^NSEI');
    const vix = indices.find(i => i.symbol === '^INDIAVIX');
    
    const isUp = nifty && nifty.changePercent > 0;
    const isVolatile = vix && vix.value > 20;

    if (isVolatile && !isUp) return 'PANIC';
    if (isVolatile && isUp) return 'HIGH_VOLATILITY';
    if (!isVolatile && isUp) return 'BULL';
    if (!isVolatile && !isUp) return 'SIDEWAYS';
    return 'SIDEWAYS';
  }
}
