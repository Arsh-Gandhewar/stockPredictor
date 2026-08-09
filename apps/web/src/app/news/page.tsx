'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Newspaper, Rss, Clock, ExternalLink, TrendingUp, TrendingDown, Tag, Search } from 'lucide-react';
import { useState } from 'react';

interface NewsItem {
  id: string;
  title: string;
  source: string;
  timeAgo: string;
  category: 'Markets' | 'Corporate' | 'Results' | 'Macro';
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  affectedStock?: string;
  summary: string;
  whyItMatters: string;
}

const MARKET_NEWS_FEED: NewsItem[] = [
  {
    id: '1',
    title: 'RBI Monetary Policy Committee Maintains Repo Rate at 6.50% with Favorable Inflation Outlook',
    source: 'Economic Times',
    timeAgo: '42m ago',
    category: 'Macro',
    sentiment: 'POSITIVE',
    impact: 'HIGH',
    affectedStock: 'BANK NIFTY',
    summary: 'The Reserve Bank of India decided unanimously to keep benchmark lending rates steady, highlighting resilient domestic growth and softening headline CPI projections for FY27.',
    whyItMatters: 'Rate stability supports private capital expenditure and credit growth across leading banking institutions.',
  },
  {
    id: '2',
    title: 'Reliance Industries Green Energy Complex in Jamnagar Nears Phase-1 Commissioning',
    source: 'Reuters India',
    timeAgo: '1h ago',
    category: 'Corporate',
    sentiment: 'POSITIVE',
    impact: 'HIGH',
    affectedStock: 'RELIANCE.NS',
    summary: 'RIL reported substantial progress on its giga-scale solar PV and green hydrogen manufacturing facilities, with initial output expected ahead of scheduled guidance.',
    whyItMatters: 'Accelerates transformation into a renewable giant and creates high-margin new energy earnings streams.',
  },
  {
    id: '3',
    title: 'Tata Consultancy Services Expands AI and Quantum Computing Partnerships with European Enterprises',
    source: 'Mint',
    timeAgo: '2h ago',
    category: 'Corporate',
    sentiment: 'POSITIVE',
    impact: 'MEDIUM',
    affectedStock: 'TCS.NS',
    summary: 'TCS announced multi-year transformational agreements with tier-1 European financial institutions to deploy sovereign enterprise generative AI platforms.',
    whyItMatters: 'Reinforces tech demand resilience in European markets despite macroeconomic uncertainties.',
  },
  {
    id: '4',
    title: 'HDFC Bank Deposits Grow 16.5% YoY in Q3, Loan-to-Deposit Ratio Normalizing Faster Than Anticipated',
    source: 'Business Standard',
    timeAgo: '3h ago',
    category: 'Results',
    sentiment: 'POSITIVE',
    impact: 'HIGH',
    affectedStock: 'HDFCBANK.NS',
    summary: 'Strong retail deposit mobilization has improved liquidity buffers, positioning the private sector lender for profitable asset expansion over the next two quarters.',
    whyItMatters: 'Key overhang regarding post-merger balance sheet integration is resolving swiftly.',
  },
  {
    id: '5',
    title: 'Crude Oil Benchmarks Soften to $73/bbl on Surging Non-OPEC Production',
    source: 'Bloomberg',
    timeAgo: '4h ago',
    category: 'Markets',
    sentiment: 'POSITIVE',
    impact: 'MEDIUM',
    affectedStock: 'BPCL.NS',
    summary: 'Brent and WTI crude futures extended declines, reducing import bill pressures for oil marketing and refining corporations.',
    whyItMatters: 'Direct margin tailwind for Indian OMCs and auto manufacturers.',
  },
];

export default function NewsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const categories = ['ALL', 'Markets', 'Corporate', 'Results', 'Macro'];

  const filteredNews = MARKET_NEWS_FEED.filter(
    (item) => selectedCategory === 'ALL' || item.category.toLowerCase() === selectedCategory.toLowerCase()
  );

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Institutional Market News
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Curated, impact-rated news intelligence driving price action across Indian equity markets.
          </p>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
              selectedCategory === cat
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground border border-border/40'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* News Feed Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          {filteredNews.map((article) => {
            const isPositive = article.sentiment === 'POSITIVE';
            return (
              <Card key={article.id} className="border-border/50 bg-card/70 hover:border-primary/30 transition-all shadow-sm">
                <CardContent className="p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-primary">{article.source}</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {article.timeAgo}
                      </span>
                      {article.affectedStock && (
                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-bold text-[10px] border border-primary/20">
                          {article.affectedStock.replace('.NS', '')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isPositive
                            ? 'bg-green-500/10 text-green-400 border-green-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}
                      >
                        {article.sentiment}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-muted/60 text-[10px] font-bold text-muted-foreground">
                        Impact: {article.impact}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-foreground leading-snug hover:text-primary transition-colors cursor-pointer">
                    {article.title}
                  </h3>

                  <p className="text-xs text-muted-foreground leading-relaxed">{article.summary}</p>

                  <div className="p-3 rounded-lg bg-muted/30 border border-border/30 text-xs">
                    <span className="font-bold text-foreground block mb-0.5">Why It Matters:</span>
                    <span className="text-muted-foreground">{article.whyItMatters}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Live Market Audio/Briefing column */}
        <div className="space-y-4">
          <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
            <CardHeader className="pb-3 border-b border-primary/10">
              <CardTitle className="text-sm font-bold text-primary flex items-center gap-2">
                <Rss className="h-4 w-4" /> Live Market Radar
              </CardTitle>
              <CardDescription className="text-xs">Real-time macro catalysts</CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-background/60 border border-border/40 space-y-1">
                <div className="font-bold text-foreground">FII / DII Flow Momentum</div>
                <p className="text-muted-foreground text-[11px]">
                  Domestic Institutional Investors recorded net purchases of ₹2,140 Cr in the cash segment today.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-background/60 border border-border/40 space-y-1">
                <div className="font-bold text-foreground">Global Market Cues</div>
                <p className="text-muted-foreground text-[11px]">
                  GIFT Nifty trading with a 0.35% premium indicates a firm opening for domestic indices.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-background/60 border border-border/40 space-y-1">
                <div className="font-bold text-foreground">Earnings Season Radar</div>
                <p className="text-muted-foreground text-[11px]">
                  Key heavyweight quarterly earnings slated over the coming session include auto & IT leaders.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
