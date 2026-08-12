/**
 * QuantX High-Precision Financial Arithmetic Utilities
 * Enforces exact 2-decimal precision (paise) for Indian Rupee calculations,
 * preventing IEEE-754 floating-point drift in balances, P&L, and orders.
 */

export class Money {
  /**
   * Rounds a monetary amount to 2 decimal places using standard financial rounding.
   */
  static round(amount: number): number {
    if (!Number.isFinite(amount)) return 0;
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  /**
   * Adds two monetary amounts safely.
   */
  static add(a: number, b: number): number {
    const minorA = Math.round((a || 0) * 100);
    const minorB = Math.round((b || 0) * 100);
    return (minorA + minorB) / 100;
  }

  /**
   * Subtracts monetary amount b from a safely.
   */
  static subtract(a: number, b: number): number {
    const minorA = Math.round((a || 0) * 100);
    const minorB = Math.round((b || 0) * 100);
    return (minorA - minorB) / 100;
  }

  /**
   * Multiplies quantity by unit price safely.
   */
  static multiply(quantity: number, price: number): number {
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return 0;
    const totalMinor = Math.round(quantity * (price * 100));
    return totalMinor / 100;
  }

  /**
   * Calculates profit/loss return percentage safely.
   */
  static calculateReturnPercent(currentValue: number, investedValue: number): number {
    if (!investedValue || investedValue <= 0) return 0;
    const pnl = currentValue - investedValue;
    const pct = (pnl / investedValue) * 100;
    return Math.round((pct + Number.EPSILON) * 100) / 100;
  }

  /**
   * Calculates weighted average buy price when acquiring new shares.
   */
  static calculateNewAveragePrice(
    existingQty: number,
    existingAvgPrice: number,
    addedQty: number,
    executionPrice: number
  ): number {
    const totalQty = existingQty + addedQty;
    if (totalQty <= 0) return 0;
    const totalInvested = Money.add(
      Money.multiply(existingQty, existingAvgPrice),
      Money.multiply(addedQty, executionPrice)
    );
    return Math.round((totalInvested / totalQty + Number.EPSILON) * 100) / 100;
  }

  /**
   * Formats numeric value as Indian Rupee string (e.g. ₹1,24,500.00).
   */
  static formatINR(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount || 0);
  }
}
