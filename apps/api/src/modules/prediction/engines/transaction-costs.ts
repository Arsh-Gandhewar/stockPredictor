/**
 * Centralized Transaction Cost & Slippage Engine for QuantX (TypeScript / NestJS).
 * Unified fee calculator matching packages/quant-engine/costs.py exactly.
 */

import { Money } from '../../../common/utils/money.util';

export type CostRegime = 'LOW_COST' | 'BASE_COST' | 'HIGH_COST';

export interface TransactionCostConfig {
  brokerageRate: number;      // e.g. 0.0003 (3 bps)
  sttRateSell: number;        // e.g. 0.0010 (10 bps on sell side)
  exchangeRate: number;       // e.g. 0.0000345 (0.345 bps)
  gstRate: number;            // 18% on (brokerage + exchange)
  stampDutyRateBuy: number;   // 0.00015 (1.5 bps on buy side)
  sebiRate: number;           // 0.000001 (0.01 bps)
  slippageBps: number;        // Base execution slippage in basis points
}

export const COST_REGIMES: Record<CostRegime, TransactionCostConfig> = {
  LOW_COST: {
    brokerageRate: 0.0001,
    sttRateSell: 0.0010,
    exchangeRate: 0.00003,
    gstRate: 0.18,
    stampDutyRateBuy: 0.00015,
    sebiRate: 0.000001,
    slippageBps: 2.0,
  },
  BASE_COST: {
    brokerageRate: 0.0003,
    sttRateSell: 0.0010,
    exchangeRate: 0.0000345,
    gstRate: 0.18,
    stampDutyRateBuy: 0.00015,
    sebiRate: 0.000001,
    slippageBps: 5.0,
  },
  HIGH_COST: {
    brokerageRate: 0.0005,
    sttRateSell: 0.0010,
    exchangeRate: 0.0000345,
    gstRate: 0.18,
    stampDutyRateBuy: 0.00015,
    sebiRate: 0.000001,
    slippageBps: 10.0,
  },
};

export class TransactionCostEngine {
  private config: TransactionCostConfig;
  public readonly regime: CostRegime;

  constructor(regime: CostRegime = 'BASE_COST', customConfig?: TransactionCostConfig) {
    this.regime = regime;
    this.config = customConfig || COST_REGIMES[regime];
  }

  public calculateRoundTripCostRate(): number {
    const cfg = this.config;

    // Entry charges (buy side)
    const entryBrokerage = cfg.brokerageRate;
    const entryExchange = cfg.exchangeRate;
    const entryGst = (entryBrokerage + entryExchange) * cfg.gstRate;
    const entryStamp = cfg.stampDutyRateBuy;
    const entrySebi = cfg.sebiRate;
    const entrySlippage = cfg.slippageBps / 10000.0;

    const entryTotal = entryBrokerage + entryExchange + entryGst + entryStamp + entrySebi + entrySlippage;

    // Exit charges (sell side)
    const exitBrokerage = cfg.brokerageRate;
    const exitExchange = cfg.exchangeRate;
    const exitGst = (exitBrokerage + exitExchange) * cfg.gstRate;
    const exitStt = cfg.sttRateSell;
    const exitSebi = cfg.sebiRate;
    const exitSlippage = cfg.slippageBps / 10000.0;

    const exitTotal = exitBrokerage + exitExchange + exitGst + exitStt + exitSebi + exitSlippage;

    return entryTotal + exitTotal;
  }

  public calculateSellExecution(quantity: number, price: number) {
    const cfg = this.config;
    const notional = quantity * price;

    const brokerage = Math.min(notional * cfg.brokerageRate, 20.0); // capped at INR 20
    const exchange = notional * cfg.exchangeRate;
    const gst = (brokerage + exchange) * cfg.gstRate;
    const stt = notional * cfg.sttRateSell;
    const sebi = notional * cfg.sebiRate;
    const slippageRate = cfg.slippageBps / 10000.0;
    const slippage = Money.round(notional * slippageRate);

    // Statutory fees (taxes and regulatory charges)
    const statutoryFees = Money.round(brokerage + exchange + gst + stt + sebi);

    // Adverse execution price incorporating market slippage
    const executionPrice = Money.round(price * (1.0 - slippageRate));
    const effectiveGrossProceeds = Money.round(quantity * executionPrice);

    // Net proceeds: Gross proceeds after adverse price minus statutory fees
    // Invariant: netProceeds = (quantity * executionPrice) - statutoryFees = notional - (statutoryFees + slippage)
    const netProceeds = Math.max(0, Money.round(effectiveGrossProceeds - statutoryFees));
    const totalFriction = Money.round(statutoryFees + slippage);

    return {
      quantity,
      price,
      executionPrice,
      slippageRate,
      notional,
      brokerage,
      exchange,
      gst,
      stt,
      sebi,
      slippage,
      statutoryFees,
      totalCosts: totalFriction, // Total execution drag
      totalFriction,
      netProceeds,
    };
  }

  public computeNetReturn(grossReturn: number): number {
    return grossReturn - this.calculateRoundTripCostRate();
  }

  public getConfig(): TransactionCostConfig {
    return { ...this.config };
  }
}

