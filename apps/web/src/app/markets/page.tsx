'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  ArrowUpRight, 
  ArrowDownRight, 
  Loader2, 
  Flame, 
  BarChart3, 
  Layers, 
  RefreshCw,
  Globe2,
  ChevronRight,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react';
import { useMarketSummary, useMarketStatus, useMarketMovers, MarketIndex, MoverItem } from '@/hooks/use-stock';

export default function MarketsPage() {
  const router = useRouter();
  const [activeMoverTab, setActiveMoverTab] = useState<'gainers' | 'losers' | 'mostActive'>('gainers');
  const [selectedBenchmark, setSelectedBenchmark] = useState<string | null>(null);

  const { data: indices, isLoading: isLoadingIndices, refetch: refetchIndices, isRefetching: isRefetchingIndices } = useMarketSummary();
  const { data: marketStatus } = useMarketStatus();
  const { data: movers, isLoading: isLoadingMovers, refetch: refetchMovers, isRefetching: isRefetchingMovers } = useMarketMovers();

  const isMarketOpen = marketStatus?.status === 'OPEN';

  // Calculate Market Breadth metrics from movers
  const gainersCount = movers?.gainers?.length || 0;
  const losersCount = movers?.losers?.length || 0;
  const totalCount = gainersCount + losersCount || 1;
  const advancePercent = Math.round((gainersCount / totalCount) * 100);
  const declinePercent = 100 - advancePercent;

  // Find max absolute change for proportional move bar scaling
  const maxGainerMove = Math.max(...(movers?.gainers?.map(g => Math.abs(g.changePercent)) || [5]), 5);
  const maxLoserMove = Math.max(...(movers?.losers?.map(l => Math.abs(l.changePercent)) || [5]), 5);

  const handleRefresh = () => {
    refetchIndices();
    refetchMovers();
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* ── Page Header with Institutional Telemetry ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70">
              Global & Indian Markets
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                isMarketOpen
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isMarketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              {marketStatus?.status || 'REGULAR'} SESSION
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 text-muted-foreground border border-border/40 text-[10px] font-mono">
              <Globe2 className="h-3 w-3 text-primary" /> NSE / BSE
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
            <Clock className="h-3 w-3" /> Real-time multi-index tracking, market breadth distribution, and momentum flows.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <button
            onClick={handleRefresh}
            disabled={isRefetchingIndices || isRefetchingMovers}
            className="px-3 py-1.5 rounded-xl bg-card hover:bg-muted/60 border border-border/50 text-foreground text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            title="Refresh Quotes"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-primary ${isRefetchingIndices || isRefetchingMovers ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
          <button
            onClick={() => router.push('/discover')}
            className="px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all flex items-center gap-1.5 shadow-sm"
          >
            <span>Stock Screener</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Market Breadth & Sentiment Gauge Row ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Breadth Distribution */}
        <div className="p-3.5 rounded-xl bg-card/60 backdrop-blur-md border border-border/50 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-primary" /> Market Breadth
            </span>
            <span className="font-mono font-bold text-foreground">
              {gainersCount} : {losersCount}
            </span>
          </div>
          <div className="space-y-1">
            <div className="h-2 w-full bg-muted/50 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${advancePercent}%` }}
                className="bg-emerald-500 transition-all duration-500 h-full"
                title={`Advances: ${advancePercent}%`}
              />
              <div
                style={{ width: `${declinePercent}%` }}
                className="bg-rose-500 transition-all duration-500 h-full"
                title={`Declines: ${declinePercent}%`}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono font-medium">
              <span className="text-emerald-400">{advancePercent}% Advances</span>
              <span className="text-rose-400">{declinePercent}% Declines</span>
            </div>
          </div>
        </div>

        {/* Advance/Decline Ratio */}
        <div className="p-3.5 rounded-xl bg-card/60 backdrop-blur-md border border-border/50 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-400" /> A/D Ratio
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
              {advancePercent >= 50 ? 'BULL BREADTH' : 'BEAR BREADTH'}
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold font-mono tracking-tight text-foreground">
              {(gainersCount / (losersCount || 1)).toFixed(2)}x
            </span>
            <span className="text-[11px] text-muted-foreground font-mono">
              {advancePercent >= 50 ? 'Net positive liquidity flow' : 'Defensive profit taking'}
            </span>
          </div>
        </div>

        {/* Momentum Velocity */}
        <div className="p-3.5 rounded-xl bg-card/60 backdrop-blur-md border border-border/50 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-amber-500" /> Top Move Spike
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 font-bold border border-amber-500/20">
              ALPHA
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold font-mono tracking-tight text-emerald-400">
              +{maxGainerMove.toFixed(2)}%
            </span>
            <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
              {movers?.gainers?.[0]?.ticker?.replace('.NS', '') || 'Broad Market'}
            </span>
          </div>
        </div>

        {/* Benchmark Tracking Status */}
        <div className="p-3.5 rounded-xl bg-card/60 backdrop-blur-md border border-border/50 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-primary" /> Tracked Indices
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/10 text-primary font-bold border border-primary/20">
              INSTITUTIONAL
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold font-mono tracking-tight text-foreground">
              {indices?.length || 4} Benchmarks
            </span>
            <span className="text-[11px] text-muted-foreground font-mono">
              NSE / BSE Core
            </span>
          </div>
        </div>
      </div>

      {/* ── Institutional Benchmark Cards Grid ── */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Major Benchmark Indices
          </h2>
          <span className="text-[11px] text-muted-foreground">
            Click an index to explore constituents
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isLoadingIndices ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="animate-pulse bg-card/40 border-border/40 h-28" />
            ))
          ) : (
            indices?.map((index: MarketIndex) => {
              const isPositive = index.changePercent >= 0;
              const isSelected = selectedBenchmark === index.symbol;

              return (
                <Card
                  key={index.symbol}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedBenchmark(isSelected ? null : index.symbol)}
                  className={`bg-card/60 backdrop-blur-md border transition-all duration-200 cursor-pointer p-4 space-y-2.5 relative overflow-hidden group hover:shadow-md ${
                    isSelected
                      ? 'border-primary ring-1 ring-primary/40 bg-card/90 shadow-primary/5'
                      : 'border-border/50 hover:border-border hover:bg-card/80'
                  }`}
                >
                  <div className="flex justify-between items-center text-xs font-bold text-muted-foreground">
                    <span className="text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                      {index.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground font-mono">
                      {index.symbol}
                    </span>
                  </div>

                  <div className="text-2xl font-black tracking-tight text-foreground font-mono">
                    {index.value > 0 ? index.value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border/20 text-xs font-mono font-bold">
                    <div className={`flex items-center gap-1 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPositive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      <span>
                        {isPositive ? '+' : ''}{index.change.toFixed(2)} ({isPositive ? '+' : ''}{index.changePercent.toFixed(2)}%)
                      </span>
                    </div>

                    <span className="text-[10px] text-muted-foreground font-normal">
                      {index.marketState || 'REGULAR'}
                    </span>
                  </div>

                  {/* Soft bottom glow accent */}
                  <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${isPositive ? 'bg-emerald-500/40' : 'bg-rose-500/40'}`} />
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* ── Market Movers with Percentage Move Progress Bars ── */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-500" />
              NSE / BSE Market Movers & Momentum Leaders
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Top percentage gainers, heavy volume decliners, and institutional liquidity drivers.
            </p>
          </div>

          {/* Segmented Movers Tab Navigation */}
          <div className="flex items-center p-1 rounded-xl bg-muted/40 border border-border/40 text-xs font-semibold self-start sm:self-auto">
            <button
              onClick={() => setActiveMoverTab('gainers')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeMoverTab === 'gainers'
                  ? 'bg-background text-emerald-400 shadow-xs border border-border/40 font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Leading Gainers</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-400">
                {movers?.gainers?.length || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveMoverTab('losers')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeMoverTab === 'losers'
                  ? 'bg-background text-rose-400 shadow-xs border border-border/40 font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <TrendingDown className="h-3.5 w-3.5" />
              <span>Leading Decliners</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/10 text-rose-400">
                {movers?.losers?.length || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveMoverTab('mostActive')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeMoverTab === 'mostActive'
                  ? 'bg-background text-primary shadow-xs border border-border/40 font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Volume Leaders</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary/10 text-primary">
                {movers?.mostActive?.length || 0}
              </span>
            </button>
          </div>
        </div>

        {/* Movers Grid / List View */}
        <Card className="border-border/50 bg-card/60 backdrop-blur-md shadow-sm overflow-hidden">
          <CardContent className="p-0">
            {isLoadingMovers ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                <span className="text-xs text-muted-foreground">Streaming real-time mover telemetry...</span>
              </div>
            ) : (
              <div className="divide-y divide-border/20">
                {((movers && movers[activeMoverTab]) || []).map((stock: MoverItem, idx: number) => {
                  const isPositive = stock.changePercent >= 0;
                  const absChange = Math.abs(stock.changePercent);
                  const scaleMax = activeMoverTab === 'gainers' ? maxGainerMove : maxLoserMove;
                  const barWidthPercent = Math.min(Math.max((absChange / scaleMax) * 100, 8), 100);

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
                      className="p-3.5 hover:bg-muted/30 transition-all cursor-pointer group flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      {/* Left: Rank, Ticker, Name */}
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <span className="font-mono text-xs text-muted-foreground/60 w-5 text-center font-bold">
                          #{idx + 1}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors font-mono">
                              {stock.ticker.replace('.NS', '')}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground font-semibold">
                              NSE
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground line-clamp-1 max-w-[220px]">
                            {stock.name}
                          </div>
                        </div>
                      </div>

                      {/* Middle: Relative Percentage Move Visual Bar */}
                      <div className="flex-1 max-w-md hidden md:block px-4">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono mb-1">
                          <span>Momentum Magnitude</span>
                          <span className={isPositive ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            {absChange.toFixed(2)}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${barWidthPercent}%` }}
                            className={`h-full rounded-full transition-all duration-300 ${
                              isPositive ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                          />
                        </div>
                      </div>

                      {/* Right: LTP & Percentage Change & Action */}
                      <div className="flex items-center justify-between sm:justify-end gap-4 text-right">
                        <div>
                          <div className="font-bold text-sm font-mono text-foreground">
                            ₹{stock.price.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            Vol: {stock.volume ? stock.volume.toLocaleString('en-IN') : '—'}
                          </div>
                        </div>

                        <div
                          className={`min-w-[85px] py-1 px-2.5 rounded-lg text-xs font-mono font-bold flex items-center justify-end gap-1 ${
                            isPositive
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {isPositive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                          <span>
                            {isPositive ? '+' : ''}{stock.changePercent.toFixed(2)}%
                          </span>
                        </div>

                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all hidden sm:block" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
