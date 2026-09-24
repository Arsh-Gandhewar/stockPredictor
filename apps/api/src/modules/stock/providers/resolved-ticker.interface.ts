export interface ResolvedTicker {
  ticker: string;          // e.g. 'IRCTC.NS' or 'IRCTC.BO'
  name: string;            // e.g. 'Indian Railway Catering & Tourism Corporation Ltd'
  exchange: 'NSE' | 'BSE';
  sector: string;          // e.g. 'Consumer Services'
  industry: string;        // e.g. 'Travel & Tourism'
  marketCap: number | null;
  isInUniverse: boolean;   // true if ticker is in TOP_300_INDIAN_UNIVERSE
}
