'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Star,
  Plus,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Loader2,
  TrendingUp,
  TrendingDown,
  Activity,
  X,
  Sparkles,
  Check,
  Shield,
  Clock,
  Compass,
  Zap,
} from 'lucide-react';
import {
  useWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useAllStocks,
  StockQuote,
} from '@/hooks/use-stock';

export default function WatchlistPage() {
  const router = useRouter();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedQuickCategory, setSelectedQuickCategory] = useState<string>('ALL');

  const { data: quotes, isLoading } = useWatchlist();
  const { data: allStocks } = useAllStocks();
  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAddOpen) {
        setIsAddOpen(false);
        setAddSearch('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddOpen]);

  const handleAdd = (ticker: string) => {
    addMutation.mutate(ticker);
    setIsAddOpen(false);
    setAddSearch('');
  };

  const handleRemove = (e: React.MouseEvent, ticker: string) => {
    e.stopPropagation();
    removeMutation.mutate(ticker);
  };

  // Set of tickers currently in watchlist
  const watchlistTickers = useMemo(() => {
    return new Set(quotes?.map((q) => q.ticker) || []);
  }, [quotes]);

  // Telemetry metrics
  const telemetry = useMemo(() => {
    if (!quotes || quotes.length === 0) {
      return { total: 0, gainers: 0, losers: 0, avgMove: 0, topGainer: null };
    }
    const gainers = quotes.filter((q) => q.changePercent >= 0).length;
    const losers = quotes.length - gainers;
    const totalMove = quotes.reduce((acc, q) => acc + (q.changePercent || 0), 0);
    const avgMove = totalMove / quotes.length;
    const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
    const topGainer = sorted[0] || null;

    return {
      total: quotes.length,
      gainers,
      losers,
      avgMove,
      topGainer,
    };
  }, [quotes]);

  // Filtered watchlist rows
  const filteredQuotes = useMemo(() => {
    if (!quotes) return [];
    if (!filterQuery.trim()) return quotes;
    const q = filterQuery.toLowerCase().trim();
    return quotes.filter(
      (item) =>
        item.ticker.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q)
    );
  }, [quotes, filterQuery]);

  // Search results inside Add Modal
  const modalSearchResults = useMemo(() => {
    if (!allStocks) return [];

    let filtered = allStocks;
    if (selectedQuickCategory === 'NIFTY50') {
      filtered = filtered.filter((s) => (s.rank || 999) <= 50);
    } else if (selectedQuickCategory === 'DEFENSE') {
      filtered = filtered.filter((s) =>
        ['HAL.NS', 'BEL.NS', 'MAZDOCK.NS', 'COCHINSHIP.NS', 'BDL.NS', 'RVNL.NS', 'IRFC.NS'].includes(s.ticker)
      );
    } else if (selectedQuickCategory === 'TECH') {
      filtered = filtered.filter((s) => s.sector?.toLowerCase().includes('technology'));
    }

    if (addSearch.trim()) {
      const q = addSearch.toLowerCase().trim();
      filtered = filtered.filter(
        (s) =>
          s.ticker.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.sector && s.sector.toLowerCase().includes(q))
      );
    }

    return filtered.slice(0, 8);
  }, [allStocks, addSearch, selectedQuickCategory]);

  const starterPicks = [
    { ticker: 'RELIANCE.NS', label: 'RELIANCE' },
    { ticker: 'TCS.NS', label: 'TCS' },
    { ticker: 'HDFCBANK.NS', label: 'HDFCBANK' },
    { ticker: 'HAL.NS', label: 'HAL' },
    { ticker: 'INFY.NS', label: 'INFY' },
    { ticker: 'DIXON.NS', label: 'DIXON' },
  ];

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* ── Header & Institutional Telemetry ── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70">
              Personal Watchlist
            </h1>

            {/* 5S SYNC Pulsing Beacon */}
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              5S LIVE SYNC
            </div>

            <Badge variant="glass" size="sm">
              INSTITUTIONAL TAPE
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            Real-time monitored Indian equities with live price quotes, intraday spread tracking, and instant quant model shortcuts.
          </p>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2.5 self-start lg:self-auto">
          <button
            onClick={() => setIsAddOpen(true)}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold font-mono text-xs hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" /> Add Stock to Watchlist
          </button>
        </div>
      </div>

      {/* ── Summary KPI / Telemetry Bar ── */}
      {quotes && quotes.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Total Tracked */}
          <div className="p-3.5 rounded-xl bg-card/40 backdrop-blur-md border border-border/40 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">
                Tracked Assets
              </span>
              <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
            </div>
            <div className="text-xl font-bold font-mono text-foreground mt-1 tabular-nums">
              {telemetry.total} <span className="text-xs font-normal text-muted-foreground">Equities</span>
            </div>
          </div>

          {/* Gainers */}
          <div className="p-3.5 rounded-xl bg-card/40 backdrop-blur-md border border-border/40 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">
                Advancing
              </span>
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">
              {telemetry.gainers}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                ({Math.round((telemetry.gainers / (telemetry.total || 1)) * 100)}%)
              </span>
            </div>
          </div>

          {/* Losers */}
          <div className="p-3.5 rounded-xl bg-card/40 backdrop-blur-md border border-border/40 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">
                Declining
              </span>
              <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
            </div>
            <div className="text-xl font-bold font-mono text-rose-400 mt-1 tabular-nums">
              {telemetry.losers}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                ({Math.round((telemetry.losers / (telemetry.total || 1)) * 100)}%)
              </span>
            </div>
          </div>

          {/* Average Move */}
          <div className="p-3.5 rounded-xl bg-card/40 backdrop-blur-md border border-border/40 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">
                Net Watchlist Move
              </span>
              <Activity className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className={`text-xl font-bold font-mono mt-1 tabular-nums ${
              telemetry.avgMove >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {telemetry.avgMove >= 0 ? '+' : ''}
              {telemetry.avgMove.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* ── Watchlist Filter & Count Strip ── */}
      {quotes && quotes.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-card/30 backdrop-blur-md border border-border/40">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter within watchlist..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-7 text-xs rounded-lg bg-secondary/50 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground font-sans"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="text-xs text-muted-foreground font-mono flex items-center justify-between sm:justify-end gap-2">
            <span>Showing {filteredQuotes.length} of {quotes.length} items</span>
          </div>
        </div>
      )}

      {/* ── Institutional Watchlist Table ── */}
      <Card className="border-border/50 bg-card/40 backdrop-blur-xl shadow-2xl overflow-hidden rounded-2xl">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-28">
              <Loader2 className="h-9 w-9 animate-spin text-primary mb-3" />
              <span className="text-xs font-mono font-medium text-muted-foreground">
                Streaming live Indian equities watchlist quotes...
              </span>
            </div>
          ) : quotes?.length === 0 ? (
            /* ── Empty State with Quick Add Starter Basket ── */
            <div className="p-12 md:p-16 text-center space-y-5">
              <div className="relative inline-flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-amber-500/10 blur-xl" />
                <div className="h-16 w-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 relative">
                  <Star className="h-8 w-8 fill-amber-400" />
                </div>
              </div>

              <div className="space-y-1.5 max-w-md mx-auto">
                <h3 className="text-lg font-bold text-foreground">Your Watchlist is Empty</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Start tracking high-conviction Indian equities with live 10-second polling quotes, intraday spreads, and quantitative AI signals.
                </p>
              </div>

              {/* Starter Basket Quick Add Chips */}
              <div className="pt-2">
                <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-2.5">
                  Instant One-Click Starter Basket
                </div>
                <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
                  {starterPicks.map((pick) => (
                    <button
                      key={pick.ticker}
                      onClick={() => addMutation.mutate(pick.ticker)}
                      disabled={addMutation.isPending}
                      className="px-3 py-1.5 rounded-lg bg-card/60 hover:bg-card border border-border/50 hover:border-primary/50 text-xs font-mono font-semibold text-foreground flex items-center gap-1.5 transition-all shadow-xs hover:-translate-y-0.5"
                    >
                      <Plus className="h-3 w-3 text-primary" />
                      {pick.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setIsAddOpen(true)}
                  className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold font-mono text-xs hover:bg-primary/90 transition-all inline-flex items-center gap-2 shadow-sm"
                >
                  <Search className="h-4 w-4" /> Search All Top-300 Equities
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/40 text-muted-foreground border-b border-border/40 uppercase tracking-wider font-mono text-[10px] font-semibold">
                  <tr>
                    <th className="py-3.5 px-4">Stock / Asset</th>
                    <th className="py-3.5 px-4">Exchange</th>
                    <th className="py-3.5 px-4 text-right">LTP (₹)</th>
                    <th className="py-3.5 px-4 text-right">24h Move</th>
                    <th className="py-3.5 px-4 text-center min-w-[180px]">Day Range (L — H)</th>
                    <th className="py-3.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20 font-sans">
                  {filteredQuotes.map((quote: StockQuote) => {
                    const isPositive = quote.changePercent >= 0;
                    const cleanTicker = quote.ticker.replace('.NS', '');

                    // Range calculation for visual range bar
                    const hasValidRange = quote.dayHigh && quote.dayLow && quote.dayHigh > quote.dayLow;
                    const rangePercent = hasValidRange
                      ? Math.min(100, Math.max(0, ((quote.price - quote.dayLow) / (quote.dayHigh - quote.dayLow)) * 100))
                      : 50;

                    return (
                      <tr
                        key={quote.ticker}
                        onClick={() => router.push(`/stock/${quote.ticker}`)}
                        className="hover:bg-primary/[0.04] transition-colors cursor-pointer group"
                      >
                        {/* Stock Symbol & Star */}
                        <td className="py-3.5 px-4 font-bold text-foreground">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={(e) => handleRemove(e, quote.ticker)}
                              className="text-amber-400 hover:text-amber-300 hover:scale-110 transition-transform p-0.5"
                              title="Click star to remove from watchlist"
                            >
                              <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />
                            </button>
                            <div>
                              <div className="font-mono text-sm group-hover:text-primary transition-colors flex items-center gap-1.5">
                                {cleanTicker}
                              </div>
                              <div className="text-[11px] text-muted-foreground font-normal line-clamp-1 max-w-[200px]">
                                {quote.name}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Exchange & Freshness */}
                        <td className="py-3.5 px-4 text-muted-foreground">
                          <span className="px-2 py-0.5 rounded bg-secondary/80 text-[10px] font-mono font-semibold border border-border/40">
                            {quote.exchange || 'NSE'}
                          </span>
                        </td>

                        {/* Last Traded Price (LTP) */}
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-sm text-foreground tabular-nums">
                          ₹{quote.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>

                        {/* Day Change (%) */}
                        <td className="py-3.5 px-4 text-right">
                          <span
                            className={`inline-flex items-center font-mono font-bold px-2 py-0.5 rounded-md text-xs tabular-nums border ${
                              isPositive
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                            }`}
                          >
                            {isPositive ? (
                              <ArrowUpRight className="h-3 w-3 mr-0.5 shrink-0" />
                            ) : (
                              <ArrowDownRight className="h-3 w-3 mr-0.5 shrink-0" />
                            )}
                            {isPositive ? '+' : ''}
                            {quote.changePercent.toFixed(2)}%
                          </span>
                        </td>

                        {/* Day Range Visual Progress Bar */}
                        <td className="py-3.5 px-4 text-center">
                          {hasValidRange ? (
                            <div className="flex flex-col items-center space-y-1 w-full max-w-[170px] mx-auto">
                              <div className="flex justify-between w-full text-[10px] font-mono text-muted-foreground tabular-nums">
                                <span>₹{quote.dayLow.toFixed(1)}</span>
                                <span>₹{quote.dayHigh.toFixed(1)}</span>
                              </div>
                              <div className="relative w-full h-1.5 bg-secondary/70 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    isPositive ? 'bg-emerald-400' : 'bg-rose-400'
                                  }`}
                                  style={{ width: `${rangePercent}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] font-mono text-muted-foreground/60">
                              Spread Pending
                            </span>
                          )}
                        </td>

                        {/* Quick Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="hidden sm:inline-flex items-center gap-0.5 text-primary font-mono text-xs font-semibold group-hover:translate-x-0.5 transition-transform mr-2">
                              Analyze <ArrowUpRight className="h-3.5 w-3.5" />
                            </span>
                            <button
                              onClick={(e) => handleRemove(e, quote.ticker)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              title="Remove from watchlist"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Sleek Add Stock Modal Dialog ── */}
      <AnimatePresence>
        {isAddOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="bg-card/95 backdrop-blur-2xl border border-white/10 rounded-2xl max-w-lg w-full p-6 shadow-[0_0_50px_rgba(0,0,0,0.8)] space-y-4"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                    <Plus className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-foreground">Add Stock to Watchlist</h3>
                    <p className="text-[10px] text-muted-foreground">
                      Search across Top-300 Indian equities universe
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsAddOpen(false);
                    setAddSearch('');
                  }}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Quick Category Filters in Modal */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'NIFTY50', label: 'NIFTY 50' },
                  { id: 'DEFENSE', label: 'Defense & Rail' },
                  { id: 'TECH', label: 'IT Leaders' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedQuickCategory(cat.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-colors ${
                      selectedQuickCategory === cat.id
                        ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                        : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search ticker, company name (e.g. RELIANCE, TCS, HAL)..."
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  autoFocus
                  className="w-full h-9 pl-9 pr-8 text-xs rounded-xl bg-secondary/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/70"
                />
                {addSearch && (
                  <button
                    onClick={() => setAddSearch('')}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Search Results List */}
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {modalSearchResults.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No matching stocks found in Top-300 universe.
                  </div>
                ) : (
                  modalSearchResults.map((stock: any) => {
                    const isAlreadyAdded = watchlistTickers.has(stock.ticker);
                    const cleanTicker = stock.ticker.replace('.NS', '');

                    return (
                      <div
                        key={stock.ticker}
                        onClick={() => !isAlreadyAdded && handleAdd(stock.ticker)}
                        className={`p-2.5 rounded-xl border flex items-center justify-between transition-all ${
                          isAlreadyAdded
                            ? 'bg-secondary/20 border-border/30 opacity-60 cursor-default'
                            : 'bg-card/50 hover:bg-card border-border/40 hover:border-primary/40 cursor-pointer shadow-xs hover:-translate-y-0.5'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-foreground">
                              {cleanTicker}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-secondary text-muted-foreground font-mono">
                              {stock.exchange || 'NSE'}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground line-clamp-1">
                            {stock.name}
                          </div>
                          {stock.sector && (
                            <div className="text-[10px] text-muted-foreground/80 font-mono">
                              {stock.sector}
                            </div>
                          )}
                        </div>

                        <div>
                          {isAlreadyAdded ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground px-2 py-0.5 rounded bg-secondary/50">
                              <Check className="h-3 w-3 text-emerald-400" /> In Watchlist
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdd(stock.ticker);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-primary/15 hover:bg-primary text-primary hover:text-primary-foreground text-xs font-mono font-bold transition-colors flex items-center gap-1 border border-primary/30"
                            >
                              <Plus className="h-3 w-3" /> Add
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal Footer hint */}
              <div className="pt-2 border-t border-border/30 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                <span>Press ESC to close</span>
                <span>{allStocks?.length || 300} Equities Monitored</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
