import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });
import { prisma } from 'db';

// NIFTY 50 constituents (as of 2026)
const NIFTY_50_STOCKS = [
  { ticker: 'RELIANCE.NS', name: 'Reliance Industries', sector: 'Energy', exchange: 'NSE' },
  { ticker: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'Technology', exchange: 'NSE' },
  { ticker: 'HDFCBANK.NS', name: 'HDFC Bank', sector: 'Finance', exchange: 'NSE' },
  { ticker: 'INFY.NS', name: 'Infosys', sector: 'Technology', exchange: 'NSE' },
  { ticker: 'ITC.NS', name: 'ITC Limited', sector: 'Consumer Goods', exchange: 'NSE' },
  { ticker: 'ICICIBANK.NS', name: 'ICICI Bank', sector: 'Finance', exchange: 'NSE' },
  { ticker: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank', sector: 'Finance', exchange: 'NSE' },
  { ticker: 'SBIN.NS', name: 'State Bank of India', sector: 'Finance', exchange: 'NSE' },
  { ticker: 'BHARTIARTL.NS', name: 'Bharti Airtel', sector: 'Telecom', exchange: 'NSE' },
  { ticker: 'AXISBANK.NS', name: 'Axis Bank', sector: 'Finance', exchange: 'NSE' },
  { ticker: 'LT.NS', name: 'Larsen & Toubro', sector: 'Infrastructure', exchange: 'NSE' },
  { ticker: 'WIPRO.NS', name: 'Wipro', sector: 'Technology', exchange: 'NSE' },
  { ticker: 'HCLTECH.NS', name: 'HCL Technologies', sector: 'Technology', exchange: 'NSE' },
  { ticker: 'ASIANPAINT.NS', name: 'Asian Paints', sector: 'Consumer Goods', exchange: 'NSE' },
  { ticker: 'MARUTI.NS', name: 'Maruti Suzuki', sector: 'Automobile', exchange: 'NSE' },
  { ticker: 'SUNPHARMA.NS', name: 'Sun Pharma', sector: 'Pharma', exchange: 'NSE' },
  { ticker: 'TATAMOTORS.NS', name: 'Tata Motors', sector: 'Automobile', exchange: 'NSE' },
  { ticker: 'BAJFINANCE.NS', name: 'Bajaj Finance', sector: 'Finance', exchange: 'NSE' },
  { ticker: 'TITAN.NS', name: 'Titan Company', sector: 'Consumer Goods', exchange: 'NSE' },
  { ticker: 'NESTLEIND.NS', name: 'Nestle India', sector: 'FMCG', exchange: 'NSE' },
  { ticker: 'ULTRACEMCO.NS', name: 'UltraTech Cement', sector: 'Cement', exchange: 'NSE' },
  { ticker: 'TATASTEEL.NS', name: 'Tata Steel', sector: 'Metals', exchange: 'NSE' },
  { ticker: 'POWERGRID.NS', name: 'Power Grid Corp', sector: 'Power', exchange: 'NSE' },
  { ticker: 'NTPC.NS', name: 'NTPC', sector: 'Power', exchange: 'NSE' },
  { ticker: 'ONGC.NS', name: 'ONGC', sector: 'Energy', exchange: 'NSE' },
  { ticker: 'TECHM.NS', name: 'Tech Mahindra', sector: 'Technology', exchange: 'NSE' },
  { ticker: 'HINDALCO.NS', name: 'Hindalco', sector: 'Metals', exchange: 'NSE' },
  { ticker: 'JSWSTEEL.NS', name: 'JSW Steel', sector: 'Metals', exchange: 'NSE' },
  { ticker: 'ADANIENT.NS', name: 'Adani Enterprises', sector: 'Diversified', exchange: 'NSE' },
  { ticker: 'ADANIPORTS.NS', name: 'Adani Ports', sector: 'Infrastructure', exchange: 'NSE' },
  { ticker: 'COALINDIA.NS', name: 'Coal India', sector: 'Mining', exchange: 'NSE' },
  { ticker: 'BAJAJFINSV.NS', name: 'Bajaj Finserv', sector: 'Finance', exchange: 'NSE' },
  { ticker: 'GRASIM.NS', name: 'Grasim Industries', sector: 'Cement', exchange: 'NSE' },
  { ticker: 'DRREDDY.NS', name: "Dr. Reddy's Labs", sector: 'Pharma', exchange: 'NSE' },
  { ticker: 'CIPLA.NS', name: 'Cipla', sector: 'Pharma', exchange: 'NSE' },
  { ticker: 'DIVISLAB.NS', name: "Divi's Laboratories", sector: 'Pharma', exchange: 'NSE' },
  { ticker: 'APOLLOHOSP.NS', name: 'Apollo Hospitals', sector: 'Healthcare', exchange: 'NSE' },
  { ticker: 'EICHERMOT.NS', name: 'Eicher Motors', sector: 'Automobile', exchange: 'NSE' },
  { ticker: 'BRITANNIA.NS', name: 'Britannia Industries', sector: 'FMCG', exchange: 'NSE' },
  { ticker: 'HINDUNILVR.NS', name: 'Hindustan Unilever', sector: 'FMCG', exchange: 'NSE' },
  { ticker: 'SBILIFE.NS', name: 'SBI Life Insurance', sector: 'Insurance', exchange: 'NSE' },
  { ticker: 'HDFCLIFE.NS', name: 'HDFC Life Insurance', sector: 'Insurance', exchange: 'NSE' },
  { ticker: 'BPCL.NS', name: 'Bharat Petroleum', sector: 'Energy', exchange: 'NSE' },
  { ticker: 'TATACONSUM.NS', name: 'Tata Consumer', sector: 'FMCG', exchange: 'NSE' },
  { ticker: 'HEROMOTOCO.NS', name: 'Hero MotoCorp', sector: 'Automobile', exchange: 'NSE' },
  { ticker: 'INDUSINDBK.NS', name: 'IndusInd Bank', sector: 'Finance', exchange: 'NSE' },
  { ticker: 'M&M.NS', name: 'Mahindra & Mahindra', sector: 'Automobile', exchange: 'NSE' },
  { ticker: 'WIPRO.NS', name: 'Wipro', sector: 'Technology', exchange: 'NSE' },
  { ticker: 'BAJAJ-AUTO.NS', name: 'Bajaj Auto', sector: 'Automobile', exchange: 'NSE' },
  { ticker: 'LTIM.NS', name: 'LTIMindtree', sector: 'Technology', exchange: 'NSE' },
];

// Deduplicate by ticker
const uniqueStocks = NIFTY_50_STOCKS.filter(
  (stock, index, self) => index === self.findIndex(s => s.ticker === stock.ticker)
);

async function main() {
  console.log(`Seeding ${uniqueStocks.length} NIFTY 50 stocks...`);

  for (const stock of uniqueStocks) {
    await prisma.stock.upsert({
      where: { ticker: stock.ticker },
      update: {
        name: stock.name,
        sector: stock.sector,
        exchange: stock.exchange,
      },
      create: {
        ticker: stock.ticker,
        name: stock.name,
        sector: stock.sector,
        exchange: stock.exchange,
      },
    });
    console.log(`  ✓ ${stock.ticker} — ${stock.name}`);
  }

  console.log(`\nSeeding complete. ${uniqueStocks.length} stocks in database.`);
  console.log('NOTE: No fake prices or AI insights seeded. All data comes from live APIs.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
