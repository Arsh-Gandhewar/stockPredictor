import { BuySellAnalysis } from '../deep-audit.types';

type Candle = { time: number | string; open: number; high: number; low: number; close: number; volume: number };

export class BuySellPatternEngine {
  analyze(candles: Candle[]): BuySellAnalysis {
    if (candles.length < 30) {
      throw new Error('Not enough candles for buy-sell analysis. Need at least 30.');
    }

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    
    const obv = this.calculateOBV(candles);
    const adl = this.calculateADL(candles);
    const vpt = this.calculateVPT(candles);

    const obvSma20 = this.calculateSMA(obv, Math.min(20, obv.length));
    const isObvTrendingUp = obv[obv.length - 1] > obvSma20[obvSma20.length - 1];
    const isObvTrendingDown = obv[obv.length - 1] < obvSma20[obvSma20.length - 1];

    const priceSma20 = this.calculateSMA(closes, Math.min(20, closes.length));
    const isPriceTrendingUp = closes[closes.length - 1] > priceSma20[priceSma20.length - 1];
    const isPriceTrendingDown = closes[closes.length - 1] < priceSma20[priceSma20.length - 1];

    const avgVol30 = this.calculateAverageVolume(volumes, Math.min(30, volumes.length));
    const avgVol90 = this.calculateAverageVolume(volumes, Math.min(90, volumes.length));

    let volumeTrend = 'NEUTRAL';
    if (isObvTrendingUp && isPriceTrendingUp && avgVol30 > avgVol90) {
      volumeTrend = 'ACCUMULATION';
    } else if (isObvTrendingDown && isPriceTrendingDown) {
      volumeTrend = 'DISTRIBUTION';
    }

    const volumeTrendStrength = avgVol90 === 0 ? 0 : Math.min(100, (Math.abs(avgVol30 - avgVol90) / avgVol90) * 100);
    const smartMoneyIndicator = this.calculateSmartMoney(candles);
    const priceVolumeCorrelation = this.calculatePriceVolumeCorrelation(candles, Math.min(60, candles.length));

    const adlSma20 = this.calculateSMA(adl, Math.min(20, adl.length));
    const isAdlTrendingUp = adl[adl.length - 1] > adlSma20[adlSma20.length - 1];
    const isAdlTrendingDown = adl[adl.length - 1] < adlSma20[adlSma20.length - 1];

    let institutionalSignal = 'NEUTRAL';
    if (isObvTrendingUp && isAdlTrendingUp && smartMoneyIndicator > 20) {
      institutionalSignal = 'BUYING';
    } else if (isObvTrendingDown && isAdlTrendingDown && smartMoneyIndicator < -20) {
      institutionalSignal = 'SELLING';
    }

    const avgVolumeChange30d = avgVol90 === 0 ? 0 : ((avgVol30 - avgVol90) / avgVol90) * 100;
    const recentLargeVolumeDays = this.findLargeVolumeDays(candles);

    return {
      obvValue: obv[obv.length - 1],
      adlValue: adl[adl.length - 1],
      vptValue: vpt[vpt.length - 1],
      volumeTrend: volumeTrend as any,
      volumeTrendStrength,
      avgVolumeChange30d,
      deliveryPercentTrend: null,
      smartMoneyIndicator,
      priceVolumeCorrelation,
      institutionalSignal: institutionalSignal as any,
      recentLargeVolumeDays
    };
  }

  private calculateOBV(candles: Candle[]): number[] {
    const obv = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].close > candles[i - 1].close) {
        obv[i] = obv[i - 1] + candles[i].volume;
      } else if (candles[i].close < candles[i - 1].close) {
        obv[i] = obv[i - 1] - candles[i].volume;
      } else {
        obv[i] = obv[i - 1];
      }
    }
    return obv;
  }

  private calculateADL(candles: Candle[]): number[] {
    const adl = new Array(candles.length).fill(0);
    for (let i = 0; i < candles.length; i++) {
      const { high, low, close, volume } = candles[i];
      let mfm = 0;
      if (high !== low) {
        mfm = ((close - low) - (high - close)) / (high - low);
      }
      const mfv = mfm * volume;
      adl[i] = (i === 0 ? 0 : adl[i - 1]) + mfv;
    }
    return adl;
  }

  private calculateVPT(candles: Candle[]): number[] {
    const vpt = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      if (candles[i - 1].close !== 0) {
        vpt[i] = vpt[i - 1] + candles[i].volume * ((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
      } else {
        vpt[i] = vpt[i - 1];
      }
    }
    return vpt;
  }

  private calculateSMA(data: number[], period: number): number[] {
    const result = new Array(data.length).fill(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
      if (i >= period) sum -= data[i - period];
      if (i >= period - 1) result[i] = sum / period;
    }
    return result;
  }

  private calculateAverageVolume(volumes: number[], period: number): number {
    if (volumes.length < period) return 0;
    const recent = volumes.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / period;
  }

  private calculateSmartMoney(candles: Candle[]): number {
    let absorptionBullish = 0;
    let absorptionBearish = 0;
    
    const volumes = candles.map(c => c.volume);
    
    for (let i = 20; i < candles.length; i++) {
      const avgVol = this.calculateAverageVolume(volumes.slice(0, i), 20);
      const vol = candles[i].volume;
      const priceChangePct = Math.abs((candles[i].close - candles[i - 1].close) / candles[i - 1].close) * 100;
      const isUpDay = candles[i].close >= candles[i - 1].close;

      if (vol > 1.5 * avgVol && priceChangePct < 0.5) {
        if (isUpDay) absorptionBullish++;
        else absorptionBearish++;
      }
    }

    const totalDays = candles.length - 20;
    if (totalDays <= 0) return 0;
    
    let score = ((absorptionBullish - absorptionBearish) / totalDays) * 100;
    return Math.max(-100, Math.min(100, score));
  }

  private calculatePriceVolumeCorrelation(candles: Candle[], period: number): number {
    const lookback = Math.min(period, candles.length - 1);
    if (lookback < 2) return 0;

    const recent = candles.slice(-lookback - 1);
    const returns: number[] = [];
    const volChanges: number[] = [];

    for (let i = 1; i < recent.length; i++) {
      returns.push((recent[i].close - recent[i - 1].close) / recent[i - 1].close);
      volChanges.push(recent[i - 1].volume === 0 ? 0 : (recent[i].volume - recent[i - 1].volume) / recent[i - 1].volume);
    }

    const meanX = returns.reduce((a, b) => a + b, 0) / returns.length;
    const meanY = volChanges.reduce((a, b) => a + b, 0) / volChanges.length;

    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < returns.length; i++) {
      const dx = returns[i] - meanX;
      const dy = volChanges[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  private findLargeVolumeDays(candles: Candle[]) {
    const lookback = Math.min(30, candles.length);
    const recent = candles.slice(-lookback);
    const volumes = candles.map(c => c.volume);
    
    const events: any[] = [];
    for (let i = candles.length - lookback; i < candles.length; i++) {
      if (i < 20) continue;
      const avgVol = this.calculateAverageVolume(volumes.slice(0, i), 20);
      if (candles[i].volume > 2 * avgVol) {
        const prevClose = candles[i - 1].close;
        const priceChange = ((candles[i].close - prevClose) / prevClose) * 100;
        
        let signal = 'ABSORPTION';
        if (Math.abs(priceChange) >= 0.5) {
          signal = priceChange > 0 ? 'BUYING_PRESSURE' : 'SELLING_PRESSURE';
        }
        
        events.push({
          date: new Date(candles[i].time).toISOString(),
          volume: candles[i].volume,
          priceChange,
          signal
        });
      }
    }
    return events;
  }
}
