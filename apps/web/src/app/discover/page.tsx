'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Compass, Search, TrendingUp, TrendingDown, Activity, ArrowUpRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAllStocks, useMarketMovers } from '@/hooks/use-stock';

export default function DiscoverPage() {
  const router = useRouter();
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const { data: stocks, isLoading } = useAllStocks();
  const { data: movers } = useMarketMovers();

  const sectors = ['ALL', 'Energy', 'Technology', 'Finance', 'Automobile', 'Pharma', 'Consumer Goods', 'Metals'];

  const filteredStocks = (stocks || []).filter((stock) => {
    const matchesSector = selectedSector === 'ALL' || stock.sector?.toLowerCase() === selectedSector.toLowerCase();
    const matchesSearch =
      stock.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
      stock.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSector && matchesSearch;
  });

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Stock Universe Discovery
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Explore 49 active NIFTY 50 blue-chip companies by sector, momentum, and technical setup.
          </p>
        </div>
      </div>

      {/* Sector filter pills & Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {sectors.map((sec) => (
            <button
              key={sec}
              onClick={() => setSelectedSector(sec)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                selectedSector === sec
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground border border-border/40'
              }`}
            >
              {sec}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter list..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-muted/40 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Grid of stocks */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
          <span className="text-xs text-muted-foreground">Loading verified NIFTY universe...</span>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStocks.map((stock) => (
            <Card
              key={stock.ticker}
              onClick={() => router.push(`/stock/${stock.ticker}`)}
              className="bg-card/70 border-border/50 hover:border-primary/40 hover:bg-card transition-all cursor-pointer shadow-sm group"
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                      {stock.ticker.replace('.NS', '')}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-semibold">
                      {stock.exchange}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{stock.name}</div>
                  {stock.sector && (
                    <span className="inline-block mt-2 text-[10px] text-primary/80 font-medium bg-primary/5 px-2 py-0.5 rounded border border-primary/10">
                      {stock.sector}
                    </span>
                  )}
                </div>

                <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
