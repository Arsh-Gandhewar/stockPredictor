import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });
import { PrismaClient } from 'db';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial stocks for the dashboard...');

  const initialStocks = [
    { ticker: 'RELIANCE.NS', name: 'Reliance Industries', sector: 'Energy', exchange: 'NSE' },
    { ticker: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'Technology', exchange: 'NSE' },
    { ticker: 'HDFCBANK.NS', name: 'HDFC Bank', sector: 'Finance', exchange: 'NSE' },
    { ticker: 'INFY.NS', name: 'Infosys', sector: 'Technology', exchange: 'NSE' },
    { ticker: 'ITC.NS', name: 'ITC Limited', sector: 'Consumer Goods', exchange: 'NSE' }
  ];

  for (const stock of initialStocks) {
    const s = await prisma.stock.upsert({
      where: { ticker: stock.ticker },
      update: {},
      create: {
        ticker: stock.ticker,
        name: stock.name,
        sector: stock.sector,
        exchange: stock.exchange,
      }
    });

    // Create a mock AI insight so it shows up in "Top Picks"
    await prisma.aIInsight.create({
      data: {
        stockId: s.id,
        recommendation: 'BUY',
        confidenceScore: Math.floor(Math.random() * 30) + 70, // 70-99
        reasoning: `Strong technical setup and favorable macroeconomic conditions for ${s.name}.`,
        riskLevel: 'MEDIUM',
        expectedTrend: 'UPWARD',
        horizon: 'SHORT_TERM',
      }
    });

    // Create a mock price history for the last day so we have a latest price
    await prisma.priceHistory.create({
      data: {
        stockId: s.id,
        date: new Date(),
        open: Math.random() * 2000 + 1000,
        high: Math.random() * 2000 + 1100,
        low: Math.random() * 2000 + 900,
        close: Math.random() * 2000 + 1050,
        volume: BigInt(1000000)
      }
    });

    console.log(`Seeded ${s.ticker}`);
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
