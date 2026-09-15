'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  ArrowUpRight,
  Loader2,
  SlidersHorizontal,
  Layers,
  Zap,
  Shield,
  ShieldCheck,
  Cpu,
  LayoutGrid,
  Table as TableIcon,
  X,
  Sparkles,
  ChevronDown,
  TrendingUp,
  BarChart3,
  Flame,
  CheckCircle2,
  Compass,
} from 'lucide-react';
import { useAllStocks, useMarketMovers } from '@/hooks/use-stock';

interface StockItem {
  ticker: string;
  name: string;
  sector: string | null;
  exchange: string;
  marketCapTier?: string;
  rank?: number;
  industry?: string;
}

export default function DiscoverPage() {
  const router = useRouter();
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [selectedTier, setSelectedTier] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'RANK' | 'TICKER_ASC' | 'TICKER_DESC' | 'NAME_ASC'>('RANK');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
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
    {
      id: 'ALL',
      label: 'All Equities',
      icon: Layers,
      description: 'Full Top-300 Indian Universe',
    },
    {
      id: 'MOMENTUM',
      label: 'High Beta & Alpha',
      icon: Flame,
      badge: 'Alpha',
      description: 'High volatility breakout candidates',
    },
    {
      id: 'LARGE_CAP',
      label: 'Blue Chip Core',
      icon: Shield,
      badge: 'NIFTY 50',
      description: 'NIFTY 50 institutional titans',
    },
    {
      id: 'DEFENSE_PSU',
      label: 'Defense & Railways',
      icon: ShieldCheck,
      badge: 'PSU',
      description: 'Strategic capex & orderbook plays',
    },
    {
      id: 'TECH_LEADERS',
      label: 'IT & Software',
      icon: Cpu,
      badge: 'Tech',
      description: 'Digital transformation & IT giants',
    },
  ];

  // Calculate sector distribution & preset counts
  const universeCounts = useMemo(() => {
    if (!stocks || !Array.isArray(stocks)) return { total: 0, largeCap: 0, midCap: 0, sectorsCount: 0 };
    const largeCap = stocks.filter((s) => s.marketCapTier === 'LARGE_CAP' || (s.rank && s.rank <= 100)).length;
    const midCap = stocks.length - largeCap;
    const uniqueSectors = new Set(stocks.map((s) => s.sector).filter(Boolean));
    return {
      total: stocks.length,
      largeCap,
      midCap,
      sectorsCount: uniqueSectors.size,
    };
  }, [stocks]);

  // Filtering logic
  const filteredStocks = useMemo(() => {
    if (!stocks) return [];

    return stocks
      .filter((stock: StockItem) => {
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
          matchesPreset = [
            'SUZLON.NS',
            'RVNL.NS',
            'MAZDOCK.NS',
            'IREDA.NS',
            'KAYNES.NS',
            'DIXON.NS',
            'TRENT.NS',
          ].includes(stock.ticker);
        } else if (selectedPreset === 'LARGE_CAP') {
          matchesPreset = (stock.rank || 999) <= 50;
        } else if (selectedPreset === 'DEFENSE_PSU') {
          matchesPreset = [
            'HAL.NS',
            'BEL.NS',
            'MAZDOCK.NS',
            'COCHINSHIP.NS',
            'BDL.NS',
            'RVNL.NS',
            'IRFC.NS',
          ].includes(stock.ticker);
        } else if (selectedPreset === 'TECH_LEADERS') {
          matchesPreset = Boolean(stock.sector?.toLowerCase().includes('technology'));
        }

        // Search query
        const sTerm = searchTerm.toLowerCase().trim();
        const matchesSearch =
          !sTerm ||
          (stock.ticker || '').toLowerCase().includes(sTerm) ||
          (stock.name || '').toLowerCase().includes(sTerm) ||
          (stock.industry || '').toLowerCase().includes(sTerm) ||
          (stock.sector || '').toLowerCase().includes(sTerm);

        return matchesSector && matchesTier && matchesPreset && matchesSearch;
      })
      .sort((a, b) => {
        if (sortBy === 'RANK') {
          return (a.rank || 9999) - (b.rank || 9999);
        }
        if (sortBy === 'TICKER_ASC') {
          return a.ticker.localeCompare(b.ticker);
        }
        if (sortBy === 'TICKER_DESC') {
          return b.ticker.localeCompare(a.ticker);
        }
        if (sortBy === 'NAME_ASC') {
          return a.name.localeCompare(b.name);
        }
        return 0;
      });
  }, [stocks, selectedSector, selectedTier, selectedPreset, searchTerm, sortBy]);

  const displayedStocks = filteredStocks.slice(0, page * pageSize);

  // Filter change helper
  const handleFilterChange = (setter: (val: any) => void, value: any) => {
    setter(value);
    setPage(1);
  };

  const handleResetFilters = () => {
    setSelectedSector('ALL');
    setSelectedTier('ALL');
    setSelectedPreset('ALL');
    setSearchTerm('');
    setSortBy('RANK');
    setPage(1);
  };

  const hasActiveFilters =
    selectedSector !== 'ALL' ||
    selectedTier !== 'ALL' ||
    selectedPreset !== 'ALL' ||
    searchTerm.trim() !== '' ||
    sortBy !== 'RANK';

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* ── Page Header & Institutional Telemetry ── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70">
              Top-300 Stock Screener
            </h1>
            <Badge variant="purple" size="sm" pulse dot>
              QUANT SCREENER
            </Badge>
            <Badge variant="glass" size="sm">
              NSE:BSE UNIVERSE
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            Institutional multi-factor equity screener spanning NIFTY 50, NIFTY NEXT 50, and high-beta alpha leaders with quantitative factor indexing.
          </p>
        </div>

        {/* Telemetry Stats Bar */}
        <div className="flex items-center gap-3 self-start lg:self-auto overflow-x-auto py-1">
          <div className="px-3 py-2 rounded-xl bg-card/40 backdrop-blur-md border border-border/40 flex items-center gap-2.5 shadow-xs">
            <Compass className="h-4 w-4 text-primary shrink-0" />
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">Monitored</div>
              <div className="text-xs font-bold font-mono text-foreground">
                {stocks?.length || 300} Equities
              </div>
            </div>
          </div>

          <div className="px-3 py-2 rounded-xl bg-card/40 backdrop-blur-md border border-border/40 flex items-center gap-2.5 shadow-xs">
            <Shield className="h-4 w-4 text-sky-400 shrink-0" />
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">Large Cap</div>
              <div className="text-xs font-bold font-mono text-sky-400">
                {universeCounts.largeCap || 100}
              </div>
            </div>
          </div>

          <div className="px-3 py-2 rounded-xl bg-card/40 backdrop-blur-md border border-border/40 flex items-center gap-2.5 shadow-xs">
            <Flame className="h-4 w-4 text-amber-400 shrink-0" />
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">Alpha & Mid</div>
              <div className="text-xs font-bold font-mono text-amber-400">
                {universeCounts.midCap || 200}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Institutional Preset Category Pills ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" /> Universe Presets
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {filteredStocks.length} matches
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {presets.map((p) => {
            const Icon = p.icon;
            const isSelected = selectedPreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => handleFilterChange(setSelectedPreset, p.id)}
                className={`relative group px-3.5 py-3 rounded-xl text-left transition-all duration-200 flex flex-col justify-between border ${
                  isSelected
                    ? 'bg-primary/15 border-primary/60 shadow-[0_0_20px_rgba(99,102,241,0.25)] ring-1 ring-primary/40'
                    : 'bg-card/40 backdrop-blur-md hover:bg-card/70 border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <div className={`p-1.5 rounded-lg transition-colors ${
                    isSelected ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground group-hover:text-foreground'
                  }`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  {p.badge && (
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                      isSelected ? 'bg-primary/30 text-primary-foreground' : 'bg-secondary/80 text-muted-foreground'
                    }`}>
                      {p.badge}
                    </span>
                  )}
                </div>
                <div>
                  <div className={`text-xs font-bold font-sans tracking-tight ${isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>
                    {p.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 line-clamp-1 mt-0.5">
                    {p.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Multi-Parameter Search & Filter Toolbar ── */}
      <div className="p-4 rounded-2xl bg-card/40 backdrop-blur-xl border border-border/50 space-y-3.5 shadow-lg shadow-black/5">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search ticker, company name, or industry (e.g. HAL, IT, Tata, HDFC, Solar)..."
              value={searchTerm}
              onChange={(e) => handleFilterChange(setSearchTerm, e.target.value)}
              className="w-full h-9 pl-9 pr-8 text-xs rounded-xl bg-secondary/40 border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/50 text-foreground placeholder:text-muted-foreground/70 transition-all font-sans"
            />
            {searchTerm && (
              <button
                onClick={() => handleFilterChange(setSearchTerm, '')}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground p-0.5"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Sector, Tier, Sort & View Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Sector Dropdown */}
            <div className="relative">
              <select
                value={selectedSector}
                onChange={(e) => handleFilterChange(setSelectedSector, e.target.value)}
                className="h-9 px-3 text-xs rounded-xl bg-secondary/50 border border-border/50 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none pr-8 cursor-pointer hover:bg-secondary/70 transition-colors"
              >
                {sectors.map((s) => (
                  <option key={s} value={s} className="bg-background text-foreground">
                    {s === 'ALL' ? 'All Sectors' : s}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-3 h-3 w-3 text-muted-foreground pointer-events-none" />
            </div>

            {/* Market Cap Tier */}
            <div className="relative">
              <select
                value={selectedTier}
                onChange={(e) => handleFilterChange(setSelectedTier, e.target.value)}
                className="h-9 px-3 text-xs rounded-xl bg-secondary/50 border border-border/50 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none pr-8 cursor-pointer hover:bg-secondary/70 transition-colors"
              >
                <option value="ALL" className="bg-background text-foreground">All Market Caps</option>
                <option value="LARGE_CAP" className="bg-background text-foreground">Large Cap (NIFTY 100)</option>
                <option value="MID_CAP" className="bg-background text-foreground">Mid & Small Cap Alpha</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-3 h-3 w-3 text-muted-foreground pointer-events-none" />
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => handleFilterChange(setSortBy, e.target.value as any)}
                className="h-9 px-3 text-xs rounded-xl bg-secondary/50 border border-border/50 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none pr-8 cursor-pointer hover:bg-secondary/70 transition-colors"
              >
                <option value="RANK" className="bg-background text-foreground">Sort: Market Rank</option>
                <option value="TICKER_ASC" className="bg-background text-foreground">Sort: Ticker (A-Z)</option>
                <option value="TICKER_DESC" className="bg-background text-foreground">Sort: Ticker (Z-A)</option>
                <option value="NAME_ASC" className="bg-background text-foreground">Sort: Name (A-Z)</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-3 h-3 w-3 text-muted-foreground pointer-events-none" />
            </div>

            {/* View Mode Toggle: Grid / Table */}
            <div className="flex items-center rounded-xl bg-secondary/50 border border-border/50 p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'grid' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Grid Card View"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'table' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Institutional Table View"
              >
                <TableIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter Summary & Active Badges Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/30 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground text-[11px]">
            <span>
              Showing <strong className="text-foreground font-mono">{filteredStocks.length}</strong> of{' '}
              <strong className="text-foreground font-mono">{stocks?.length || 300}</strong> equities
            </span>
            {selectedSector !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/80 text-[10px] text-foreground border border-border/50">
                Sector: {selectedSector}
              </span>
            )}
            {selectedTier !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/80 text-[10px] text-foreground border border-border/50">
                Tier: {selectedTier === 'LARGE_CAP' ? 'Large Cap' : 'Mid Cap'}
              </span>
            )}
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="text-primary hover:text-primary/80 font-mono text-[11px] font-semibold hover:underline flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Reset All Filters
            </button>
          )}
        </div>
      </div>

      {/* ── Screener Results Content ── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-28 rounded-2xl bg-card/20 border border-border/30">
          <Loader2 className="h-9 w-9 animate-spin text-primary mb-3" />
          <span className="text-xs font-mono font-medium text-muted-foreground">
            Indexing Top-300 Indian equities universe...
          </span>
        </div>
      ) : filteredStocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center rounded-2xl bg-card/30 border border-border/40 backdrop-blur-md">
          <Compass className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="text-base font-bold text-foreground">No Equities Found</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            No stocks match your current filter and search criteria. Try clearing search filters or switching preset categories.
          </p>
          <button
            onClick={handleResetFilters}
            className="mt-4 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all shadow-sm"
          >
            Reset All Filters
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* ── Glassmorphic Stock Cards Grid ── */
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {displayedStocks.map((stock: StockItem) => {
            const cleanTicker = stock.ticker.replace('.NS', '');
            const isLargeCap = stock.marketCapTier === 'LARGE_CAP' || (stock.rank && stock.rank <= 50);

            return (
              <div
                key={stock.ticker}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/stock/${stock.ticker}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/stock/${stock.ticker}`);
                  }
                }}
                className="group relative flex flex-col justify-between p-4 rounded-xl bg-card/40 backdrop-blur-md border border-border/50 hover:border-primary/50 hover:shadow-[0_8px_30px_rgba(99,102,241,0.12)] hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden"
              >
                {/* Subtle top accent gradient line on hover */}
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/0 to-transparent group-hover:via-primary/50 transition-all duration-300" />

                {/* Top Row: Symbol, Exchange, Rank & Tier */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-base tracking-tight text-foreground group-hover:text-primary transition-colors">
                        {cleanTicker}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/80 text-muted-foreground font-mono font-semibold border border-border/40">
                        {stock.exchange || 'NSE'}
                      </span>
                      {stock.rank && (
                        <span className="text-[10px] font-mono text-muted-foreground/80">
                          #{stock.rank}
                        </span>
                      )}
                    </div>

                    <Badge
                      variant={isLargeCap ? 'purple' : 'glass'}
                      size="sm"
                    >
                      {isLargeCap ? 'Large Cap' : 'Mid Cap Alpha'}
                    </Badge>
                  </div>

                  {/* Company Full Name */}
                  <h3 className="text-xs font-medium text-muted-foreground group-hover:text-foreground/90 transition-colors line-clamp-1">
                    {stock.name}
                  </h3>

                  {/* Sector & Industry Pills */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {stock.sector && (
                      <span className="text-[10px] text-muted-foreground font-medium bg-secondary/50 px-2 py-0.5 rounded-md border border-border/40">
                        {stock.sector}
                      </span>
                    )}
                    {stock.industry && (
                      <span className="text-[10px] text-muted-foreground/80 truncate max-w-[170px] bg-secondary/30 px-1.5 py-0.5 rounded border border-border/30">
                        {stock.industry}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Row: Quick Action Link */}
                <div className="flex items-center justify-between pt-3 mt-3 border-t border-border/30 text-xs">
                  <span className="text-[11px] font-mono text-muted-foreground/70">
                    QuantX Terminal
                  </span>
                  <span className="text-xs text-primary font-semibold font-mono flex items-center gap-1 group-hover:translate-x-0.5 transition-transform duration-200">
                    Analyze <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Compact Institutional Table View ── */
        <div className="rounded-2xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/40 text-muted-foreground border-b border-border/40 uppercase tracking-wider font-mono text-[10px] font-semibold">
                <tr>
                  <th className="py-3 px-4">Rank</th>
                  <th className="py-3 px-4">Ticker & Asset</th>
                  <th className="py-3 px-4">Sector</th>
                  <th className="py-3 px-4">Industry</th>
                  <th className="py-3 px-4">Tier</th>
                  <th className="py-3 px-4">Exchange</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20 font-sans">
                {displayedStocks.map((stock: StockItem) => {
                  const cleanTicker = stock.ticker.replace('.NS', '');
                  const isLargeCap = stock.marketCapTier === 'LARGE_CAP' || (stock.rank && stock.rank <= 50);

                  return (
                    <tr
                      key={stock.ticker}
                      onClick={() => router.push(`/stock/${stock.ticker}`)}
                      className="hover:bg-primary/[0.04] transition-colors cursor-pointer group"
                    >
                      <td className="py-3 px-4 font-mono text-muted-foreground">
                        {stock.rank ? `#${stock.rank}` : '—'}
                      </td>
                      <td className="py-3 px-4 font-bold text-foreground">
                        <div className="font-mono text-sm group-hover:text-primary transition-colors">
                          {cleanTicker}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-normal line-clamp-1 max-w-xs">
                          {stock.name}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-[11px]">
                        {stock.sector || '—'}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground/80 text-[11px] max-w-[160px] truncate">
                        {stock.industry || '—'}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={isLargeCap ? 'purple' : 'glass'}
                          size="sm"
                        >
                          {isLargeCap ? 'Large Cap' : 'Mid Cap'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-mono text-muted-foreground text-[11px]">
                        {stock.exchange || 'NSE'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-primary font-mono text-xs font-semibold group-hover:translate-x-0.5 transition-transform">
                          Analyze <ArrowUpRight className="h-3.5 w-3.5" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Pagination / Load More ── */}
      {!isLoading && filteredStocks.length > displayedStocks.length && (
        <div className="flex flex-col items-center justify-center pt-6 space-y-3">
          <div className="text-xs text-muted-foreground font-mono">
            Displaying {displayedStocks.length} of {filteredStocks.length} equities
          </div>
          <div className="w-48 h-1 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{
                width: `${Math.min(100, (displayedStocks.length / filteredStocks.length) * 100)}%`,
              }}
            />
          </div>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-6 py-2.5 rounded-xl bg-card/70 hover:bg-card border border-border/60 text-foreground text-xs font-bold font-mono tracking-tight transition-all flex items-center gap-2 shadow-sm hover:border-primary/40 hover:-translate-y-0.5"
          >
            <ChevronDown className="h-4 w-4 text-primary" /> Load Next 30 Equities
          </button>
        </div>
      )}
    </div>
  );
}
