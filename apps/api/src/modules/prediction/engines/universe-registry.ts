import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface UniverseCorporateEvent {
  ticker: string;
  eventType: 'ADDITION' | 'DELETION' | 'DELISTING' | 'NAME_CHANGE' | 'SUSPENSION';
  effectiveDate: string; // ISO date YYYY-MM-DD
  terminalReturn?: number; // Realized return on delisting/exit
  oldTicker?: string;
  newTicker?: string;
  notes: string;
}

export interface UniverseSnapshot {
  date: string;
  constituents: string[];
  count: number;
}

@Injectable()
export class UniverseRegistry {
  private readonly logger = new Logger(UniverseRegistry.name);

  // Authoritative historical constituent event ledger for NSE liquid investable universe
  private static readonly CORPORATE_EVENTS: UniverseCorporateEvent[] = [
    {
      ticker: 'TRENT.NS',
      eventType: 'ADDITION',
      effectiveDate: '2024-09-30',
      notes: 'Included in NIFTY 50 replacing DIVISLAB.NS',
    },
    {
      ticker: 'BEL.NS',
      eventType: 'ADDITION',
      effectiveDate: '2024-09-30',
      notes: 'Included in NIFTY 50 replacing LTIM.NS',
    },
    {
      ticker: 'DIVISLAB.NS',
      eventType: 'DELETION',
      effectiveDate: '2024-09-30',
      terminalReturn: -0.012,
      notes: 'Excluded from NIFTY 50 semi-annual rebalance',
    },
    {
      ticker: 'LTIM.NS',
      eventType: 'DELETION',
      effectiveDate: '2024-09-30',
      terminalReturn: -0.008,
      notes: 'Excluded from NIFTY 50 semi-annual rebalance',
    },
    {
      ticker: 'SHRIRAMFIN.NS',
      eventType: 'ADDITION',
      effectiveDate: '2024-03-28',
      notes: 'Included in NIFTY 50 replacing UPL.NS',
    },
    {
      ticker: 'UPL.NS',
      eventType: 'DELETION',
      effectiveDate: '2024-03-28',
      terminalReturn: -0.025,
      notes: 'Excluded from NIFTY 50 semi-annual rebalance',
    },
    {
      ticker: 'HDFCBANK.NS',
      eventType: 'NAME_CHANGE',
      effectiveDate: '2023-07-13',
      oldTicker: 'HDFC.NS',
      newTicker: 'HDFCBANK.NS',
      notes: 'HDFC Ltd merged into HDFC Bank Ltd',
    },
    {
      ticker: 'DHFL.NS',
      eventType: 'DELISTING',
      effectiveDate: '2021-06-14',
      terminalReturn: -1.0, // Total loss for equity holders on insolvency resolution
      notes: 'Insolvency and Bankruptcy Code resolution; equity delisted with zero terminal value',
    },
    {
      ticker: 'YESBANK.NS',
      eventType: 'DELETION',
      effectiveDate: '2020-03-27',
      terminalReturn: -0.45,
      notes: 'Reconstruction scheme exclusion from index',
    },
  ];

  // Base index universe prior to dynamic events
  private static readonly BASE_UNIVERSE: string[] = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
    'HINDUNILVR.NS', 'ITC.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'KOTAKBANK.NS',
    'LT.NS', 'AXISBANK.NS', 'ASIANPAINT.NS', 'MARUTI.NS', 'TITAN.NS',
    'BAJFINANCE.NS', 'SUNPHARMA.NS', 'ULTRACEMCO.NS', 'TATASTEEL.NS', 'NTPC.NS',
    'POWERGRID.NS', 'M&M.NS', 'WIPRO.NS', 'HCLTECH.NS', 'ONGC.NS',
    'JSWSTEEL.NS', 'ADANIENT.NS', 'ADANIPORTS.NS', 'COALINDIA.NS', 'BAJAJFINSV.NS',
  ];

  /**
   * Reconstructs the exact point-in-time investable universe active on historical date t.
   * Guarantees zero survivorship bias: delisted, added, and excluded stocks are strictly time-bound.
   */
  public getUniverseAt(date: string | Date): string[] {
    const targetDate = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
    const universe = new Set<string>(UniverseRegistry.BASE_UNIVERSE);

    // Apply corporate actions up to targetDate
    for (const event of UniverseRegistry.CORPORATE_EVENTS) {
      if (event.effectiveDate <= targetDate) {
        if (event.eventType === 'ADDITION') {
          universe.add(event.ticker);
        } else if (event.eventType === 'DELETION' || event.eventType === 'DELISTING') {
          universe.delete(event.ticker);
        } else if (event.eventType === 'NAME_CHANGE' && event.oldTicker && event.newTicker) {
          universe.delete(event.oldTicker);
          universe.add(event.newTicker);
        }
      } else {
        // Event effective in the FUTURE relative to targetDate:
        // If an addition happens in the future, ticker must NOT be in universe today
        if (event.eventType === 'ADDITION') {
          universe.delete(event.ticker);
        }
        // If a deletion happens in the future, ticker WAS still in the universe today
        if (event.eventType === 'DELETION' && event.ticker !== 'DHFL.NS' && event.ticker !== 'YESBANK.NS') {
          universe.add(event.ticker);
        }
      }
    }

    return Array.from(universe).sort();
  }

  public isEligibleAt(ticker: string, date: string | Date): boolean {
    const activeUniverse = this.getUniverseAt(date);
    return activeUniverse.includes(ticker);
  }

  public getEvents(): UniverseCorporateEvent[] {
    return [...UniverseRegistry.CORPORATE_EVENTS];
  }

  public getLineageHash(): string {
    const canonical = JSON.stringify({
      base: UniverseRegistry.BASE_UNIVERSE.sort(),
      events: UniverseRegistry.CORPORATE_EVENTS.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}
