'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, ArrowUpRight, ArrowDownRight, Loader2, Sparkles, Filter, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAllStocks, useMarketMovers } from '@/hooks/use-stock';

export default function DiscoverPage() {
  const router = useRouter();
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [selectedTier, setSelectedTier] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string>('ALL');
  const [page, setPage] = useState<number>(1);
  const pageSize = 30;

  const { data: stocks, isLoading } = useAllStocks();
  const { data: movers } = useMarketMovers();

  const sectors = [
    'ALL',
    'Technology',
    'Finance',
    'Energy',
    'Automobile',
    'Healthcare',
    'Industrials',
    'Consumer Goods',
    'Real Estate',
    'Utilities',
    'Metals & Mining',
  ];

  const presets = [
    { id: 'ALL', label: 'All Equities' },
    { id: 'MOMENTUM', label: '🚀 High Beta & Alpha' },
    { id: 'LARGE_CAP', label: '🏛️ Blue Chip Core' },
    { id: 'DEFENSE_PSU', label: '🛡️ Defense & Railways' },
    { id: 'TECH_LEADERS', label: '💻 IT & Software' },
  ];

  const filteredStocks = (stocks || []).filter((stock: any) => {
    // Sector filter
    const matchesSector =
      selectedSector === 'ALL' ||
      (stock.sector && stock.sector.toLowerCase() === selectedSector.toLowerCase());

    // Market cap tier filter
    const matchesTier =
      selectedTier === 'ALL' ||
      (stock.marketCapTier && stock.marketCapTier === selectedTier);

    // Preset filter
    let matchesPreset = true;
    if (selectedPreset === 'MOMENTUM') {
      matchesPreset = ['SUZLON.NS', 'RVNL.NS', 'MAZDOCK.NS', 'IREDA.NS', 'KAYNES.NS', 'DIXON.NS', 'TRENT.NS'].includes(stock.ticker);
    } else if (selectedPreset === 'LARGE_CAP') {
      matchesPreset = (stock.rank || 999) <= 50;
    } else if (selectedPreset === 'DEFENSE_PSU') {
      matchesPreset = ['HAL.NS', 'BEL.NS', 'MAZDOCK.NS', 'COCHINSHIP.NS', 'BDL.NS', 'RVNL.NS', 'IRFC.NS'].includes(stock.ticker);
    } else if (selectedPreset === 'TECH_LEADERS') {
      matchesPreset = stock.sector?.toLowerCase().includes('technology');
    }

    // Search query
    const sTerm = searchTerm.toLowerCase();
    const matchesSearch =
      (stock.ticker || '').toLowerCase().includes(sTerm) ||
      (stock.name || '').toLowerCase().includes(sTerm) ||
      (stock.industry || '').toLowerCase().includes(sTerm);

    return matchesSector && matchesTier && matchesPreset && matchesSearch;
  });

  const displayedStocks = filteredStocks.slice(0, page * pageSize);

  // Reset page when filters change
  const handleFilterChange = (setter: any, value: any) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Top-300 Stock Universe Screener
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Institutional multi-factor equity screener spanning NIFTY 50, NIFTY NEXT 50, and high-beta alpha leaders.
          </p>
        </div>
      </div>

      {/* Preset Pills */}
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => handleFilterChange(setSelectedPreset, p.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedPreset === p.id
                ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/50'
                : 'bg-card/70 text-muted-foreground hover:text-foreground border border-border/40'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Filters & Search Toolbar */}
      <div className="p-4 rounded-2xl bg-card/60 border border-border/50 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search ticker, company name, or industry (e.g. Defense, IT, Tata, HDFC)..."
              value={searchTerm}
              onChange={(e) => handleFilterChange(setSearchTerm, e.target.value)}
              className="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-muted/40 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedSector}
              onChange={(e) => handleFilterChange(setSelectedSector, e.target.value)}
              className="h-8 px-2.5 text-xs rounded-lg bg-muted/60 border border-border/40 font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {sectors.map((s) => (
                <option key={s} value={s}>
                  Sector: {s}
                </option>
              ))}
            </select>

            <select
              value={selectedTier}
              onChange={(e) => handleFilterChange(setSelectedTier, e.target.value)}
              className="h-8 px-2.5 text-xs rounded-lg bg-muted/60 border border-border/40 font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="ALL">All Market Caps</option>
              <option value="LARGE_CAP">Large Cap (NIFTY 100)</option>
              <option value="MID_CAP">Mid & Small Cap Alpha</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30">
          <span>Showing {filteredStocks.length} matching equities across Top-300 Indian Universe</span>
          {(selectedSector !== 'ALL' || selectedTier !== 'ALL' || selectedPreset !== 'ALL' || searchTerm) && (
            <button
              onClick={() => {
                handleFilterChange(setSelectedSector, 'ALL');
                handleFilterChange(setSelectedTier, 'ALL');
                handleFilterChange(setSelectedPreset, 'ALL');
                handleFilterChange(setSearchTerm, '');
              }}
              className="text-primary hover:underline font-semibold"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Screener Results Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
          <span className="text-xs text-muted-foreground">Scanning Top-300 Indian equities universe...</span>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {displayedStocks.map((stock: any) => (
            <Card
              key={stock.ticker}
              onClick={() => router.push(`/stock/${stock.ticker}`)}
              className="bg-card/70 border-border/50 hover:border-primary/40 hover:bg-card transition-all cursor-pointer shadow-sm group"
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors font-mono">
                      {stock.ticker.replace('.NS', '')}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-semibold">
                      {stock.exchange || 'NSE'}
                    </span>
                    {stock.marketCapTier && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/10 text-primary font-bold">
                        {stock.marketCapTier === 'LARGE_CAP' ? 'Large Cap' : 'Mid Cap'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{stock.name}</div>
                  <div className="flex items-center gap-2 pt-1">
                    {stock.sector && (
                      <span className="text-[10px] text-muted-foreground font-medium bg-muted/40 px-2 py-0.5 rounded border border-border/40">
                        {stock.sector}
                      </span>
                    )}
                    {stock.industry && (
                      <span className="text-[10px] text-muted-foreground/80 truncate max-w-[140px]">
                        {stock.industry}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs text-primary font-bold flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                    Analyze <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {!isLoading && filteredStocks.length > displayedStocks.length && (
        <div className="flex justify-center pt-6">
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-6 py-2.5 rounded-xl bg-card hover:bg-muted border border-border/50 text-foreground text-xs font-bold transition-all flex items-center gap-2 shadow-sm"
          >
            Show More Stocks
          </button>
        </div>
      )}
    </div>
  );
}
