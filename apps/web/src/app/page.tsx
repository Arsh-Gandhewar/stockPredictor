'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  TrendingUp, 
  Activity, 
  Search, 
  Clock, 
  Loader2, 
  ArrowUpRight, 
  ArrowDownRight, 
  Radio, 
  ShieldCheck, 
  Zap, 
  ChevronRight, 
  Flame, 
  Target,
  BarChart2
} from 'lucide-react';
import { useMarketSummary, useMarketStatus, useMarketMovers, useTopPicks, useStockChart, useHighRiskStocks, MarketIndex, MoverItem, TopPickItem, HighRiskStockItem } from '@/hooks/use-stock';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

export default function Dashboard() {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState<{ name: string; symbol: string }>({ name: 'NIFTY 50', symbol: '^NSEI' });
  const [selectedRange, setSelectedRange] = useState<string>('1mo');
  const [activeMoverTab, setActiveMoverTab] = useState<'gainers' | 'losers' | 'mostActive'>('gainers');

  const { data: indices, isLoading: isLoadingSummary } = useMarketSummary();
  const { data: marketStatus } = useMarketStatus();
  const { data: movers, isLoading: isLoadingMovers } = useMarketMovers();
  const { data: topPicks, isLoading: isLoadingPicks } = useTopPicks();
  const { data: highRiskPicks, isLoading: isLoadingHighRisk } = useHighRiskStocks();
  const { data: indexChart, isLoading: isLoadingChart } = useStockChart(selectedIndex.symbol, selectedRange);

  const chartContainerRef = useRef<HTMLDivElement>(null);

  const chartRanges = [
    { label: '1D', value: '1d' },
    { label: '1W', value: '1w' },
    { label: '1M', value: '1mo' },
    { label: '6M', value: '6mo' },
    { label: '1Y', value: '1y' },
  ];

  // Interactive Dynamic Index Candlestick Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (!indexChart || indexChart.length === 0) return;

    chartContainerRef.current.innerHTML = '';

    const containerWidth = chartContainerRef.current.clientWidth || 600;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      width: containerWidth,
      height: 280,
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Sanitize, sort, and strictly deduplicate candle data by timestamp
    const seenTimes = new Set<string | number>();
    const sanitizedData = [...indexChart]
      .filter((c) => c && c.time && c.open != null && c.close != null && c.high != null && c.low != null)
      .sort((a, b) => {
        const timeA = typeof a.time === 'number' ? a.time : new Date(a.time).getTime();
        const timeB = typeof b.time === 'number' ? b.time : new Date(b.time).getTime();
        return timeA - timeB;
      })
      .filter((c) => {
        if (seenTimes.has(c.time)) return false;
        seenTimes.add(c.time);
        return true;
      });

    if (sanitizedData.length > 0) {
      series.setData(sanitizedData as any);
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [indexChart, selectedIndex, selectedRange]);

  const isMarketOpen = marketStatus?.status === 'OPEN';

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* ── Top Market Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              Indian Markets Overview
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                isMarketOpen
                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isMarketOpen ? 'bg-green-400 animate-ping' : 'bg-amber-400'}`} />
              {marketStatus?.status || 'MARKET'} (NSE/BSE)
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Live data pipeline • Indian Standard Time (IST) • Real-time quantitative indicators
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/discover')}
            className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors flex items-center gap-1"
          >
            <Search className="h-3.5 w-3.5" /> Explore Universe
          </button>
          <button
            onClick={() => router.push('/portfolio')}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity flex items-center gap-1 shadow-sm"
          >
            <Zap className="h-3.5 w-3.5" /> Paper Trade
          </button>
        </div>
      </div>

      {/* ── Interactive Major Indices Cards (Click any to view its chart) ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
          <span>Benchmark Indices</span>
          <span className="text-[11px] font-medium text-primary">Click any index to switch chart</span>
        </div>

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {isLoadingSummary ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="animate-pulse bg-muted/20 border-border/40 h-24" />
            ))
          ) : (
            indices?.map((index: MarketIndex) => {
              const isPositive = index.changePercent >= 0;
              const isSelected = selectedIndex.symbol === index.symbol;

              return (
                <Card
                  key={index.symbol}
                  onClick={() => setSelectedIndex({ name: index.name, symbol: index.symbol })}
                  className={`overflow-hidden relative transition-all shadow-sm cursor-pointer group hover:-translate-y-0.5 ${
                    isSelected
                      ? 'bg-gradient-to-br from-primary/15 via-card to-card border-primary/60 ring-2 ring-primary/40 shadow-md'
                      : 'bg-gradient-to-br from-card to-card/60 border-border/50 hover:border-primary/40'
                  }`}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-bold uppercase tracking-wider ${isSelected ? 'text-primary' : 'text-muted-foreground group-hover:text-primary transition-colors'}`}>
                        {index.name}
                      </span>
                      {isSelected && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
                      )}
                    </div>
                    <BarChart2 className={`h-3.5 w-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground/60'}`} />
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <div className="text-xl font-extrabold tracking-tight font-mono">
                      {index.value > 0 ? index.value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                    </div>
                    <div className={`text-xs font-semibold flex items-center mt-0.5 font-mono ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                      {isPositive ? <ArrowUpRight className="h-3 w-3 mr-0.5 shrink-0" /> : <ArrowDownRight className="h-3 w-3 mr-0.5 shrink-0" />}
                      <span>{isPositive ? '+' : ''}{index.change.toFixed(2)} ({isPositive ? '+' : ''}{index.changePercent.toFixed(2)}%)</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* ── Row 1: Dynamic Index Benchmark Chart + Top Monitored Opportunities ── */}
      <div className="grid gap-6 lg:grid-cols-7">
        {/* Dynamic Benchmark Candlestick Chart */}
        <Card className="lg:col-span-4 border-border/50 bg-card/60 shadow-sm flex flex-col justify-between overflow-hidden">
          <CardHeader className="pb-2 border-b border-border/30">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  {selectedIndex.name} ({selectedRange.toUpperCase()})
                </CardTitle>
                <CardDescription className="text-xs">
                  Candlestick price action directly from {selectedIndex.symbol.includes('BSE') ? 'Bombay Stock Exchange (BSE)' : 'National Stock Exchange (NSE)'}
                </CardDescription>
              </div>

              {/* Timeframe selector */}
              <div className="flex items-center p-1 rounded-lg bg-muted/60 border border-border/40 text-xs font-semibold self-start sm:self-auto">
                {chartRanges.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setSelectedRange(r.value)}
                    className={`px-2.5 py-0.5 rounded-md transition-all ${
                      selectedRange === r.value
                        ? 'bg-background text-foreground shadow-sm font-bold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 relative min-h-[300px]">
            {isLoadingChart && (
              <div className="absolute inset-0 bg-background/50 backdrop-blur-xs flex items-center justify-center z-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                <span className="text-xs text-muted-foreground font-semibold">Streaming candles for {selectedIndex.name}...</span>
              </div>
            )}
            <div ref={chartContainerRef} className="w-full h-[280px]" />
          </CardContent>
        </Card>

        {/* Top Research & AI Picks */}
        <Card className="lg:col-span-3 border-border/50 bg-card/60 shadow-sm flex flex-col">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Top Monitored Opportunities
                </CardTitle>
                <CardDescription className="text-xs">
                  Real-time prices with quantitative confidence scores
                </CardDescription>
              </div>
              <span className="text-[10px] font-semibold text-primary px-2 py-0.5 rounded bg-primary/10">
                NIFTY 50
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/30 overflow-hidden">
            {isLoadingPicks ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              topPicks?.slice(0, 5).map((pick: TopPickItem) => {
                const isGain = pick.changePercent >= 0;
                return (
                  <div
                    key={pick.ticker}
                    onClick={() => router.push(`/stock/${pick.ticker}`)}
                    className="flex items-center justify-between p-3.5 hover:bg-muted/40 transition-colors cursor-pointer group"
                  >
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors font-mono">
                          {pick.ticker.replace('.NS', '')}
                        </span>
                        {pick.sector && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                            {pick.sector}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground line-clamp-1">{pick.name}</span>
                    </div>

                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="font-extrabold text-sm font-mono">
                          ₹{pick.price > 0 ? pick.price.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                        </div>
                        <div className={`text-xs font-semibold flex items-center justify-end ${isGain ? 'text-green-500' : 'text-red-500'}`}>
                          {isGain ? '+' : ''}{pick.changePercent.toFixed(2)}%
                        </div>
                      </div>

                      <div className="hidden sm:flex flex-col items-end">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                          {pick.recommendation} ({pick.confidence}%)
                        </span>
                      </div>

                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 2: High Beta Alpha (Top 5) + Market Movers ── */}
      <div className="grid gap-6 lg:grid-cols-7">
        {/* Top 5 High Beta Alpha Opportunities Section */}
        <Card className="lg:col-span-3 border-border/50 bg-card/60 shadow-sm flex flex-col">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Flame className="h-4 w-4 text-amber-500" />
                  High Beta Alpha (Top 5)
                </CardTitle>
                <CardDescription className="text-xs">
                  High-volatility growth setups with asymmetric reward
                </CardDescription>
              </div>
              <span className="text-[10px] font-extrabold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                &gt;1:3.0 R:R
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/30 overflow-hidden">
            {isLoadingHighRisk ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
              </div>
            ) : (
              highRiskPicks?.slice(0, 5).map((stock: HighRiskStockItem) => {
                const isGain = stock.changePercent >= 0;
                return (
                  <div
                    key={stock.ticker}
                    onClick={() => router.push(`/stock/${stock.ticker}`)}
                    className="flex items-center justify-between p-3.5 hover:bg-muted/40 transition-colors cursor-pointer group"
                  >
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-foreground group-hover:text-amber-400 transition-colors font-mono">
                          {stock.ticker.replace('.NS', '')}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20">
                          {stock.beta}x Beta
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground line-clamp-1">{stock.name}</span>
                    </div>

                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <div className="font-extrabold text-sm font-mono">
                          ₹{stock.price > 0 ? stock.price.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                        </div>
                        <div className={`text-xs font-semibold flex items-center justify-end ${isGain ? 'text-green-500' : 'text-red-500'}`}>
                          {isGain ? '+' : ''}{stock.changePercent.toFixed(2)}%
                        </div>
                      </div>

                      <div className="hidden sm:flex flex-col items-end">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 flex items-center gap-0.5">
                          <Target className="h-3 w-3" /> +{stock.targetUpsidePercent}%
                        </span>
                      </div>

                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Market Movers: Gainers, Losers, Most Active */}
        <Card className="lg:col-span-4 border-border/50 bg-card/60 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Radio className="h-4 w-4 text-primary animate-pulse" />
                  Market Movers & Unusual Activity
                </CardTitle>
                <CardDescription className="text-xs">
                  Real-time intraday momentum across the NIFTY universe
                </CardDescription>
              </div>

              <div className="flex items-center p-1 rounded-lg bg-muted/60 border border-border/40 text-xs font-semibold">
                <button
                  onClick={() => setActiveMoverTab('gainers')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    activeMoverTab === 'gainers' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Gainers
                </button>
                <button
                  onClick={() => setActiveMoverTab('losers')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    activeMoverTab === 'losers' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Losers
                </button>
                <button
                  onClick={() => setActiveMoverTab('mostActive')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    activeMoverTab === 'mostActive' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Most Active
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoadingMovers ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                <span className="text-xs text-muted-foreground">Scanning stock universe...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/30 text-muted-foreground border-b border-border/40 uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="py-2.5 px-4">Stock</th>
                      <th className="py-2.5 px-4 text-right">LTP (₹)</th>
                      <th className="py-2.5 px-4 text-right">Change (%)</th>
                      <th className="py-2.5 px-4 text-right">Volume</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {(movers?.[activeMoverTab] || []).slice(0, 5).map((item: MoverItem) => {
                      const isPositive = item.changePercent >= 0;
                      return (
                        <tr
                          key={item.ticker}
                          className="hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => router.push(`/stock/${item.ticker}`)}
                        >
                          <td className="py-2.5 px-4 font-bold text-foreground flex flex-col">
                            <span className="font-mono">{item.ticker.replace('.NS', '')}</span>
                            <span className="text-[10px] text-muted-foreground font-normal line-clamp-1">{item.name}</span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-extrabold text-foreground font-mono">
                            ₹{item.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td className={`py-2.5 px-4 text-right font-bold font-mono ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                            {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-4 text-right text-muted-foreground font-mono">
                            {item.volume ? item.volume.toLocaleString('en-IN') : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/stock/${item.ticker}`);
                              }}
                              className="px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-[11px] transition-colors"
                            >
                              Analyze
                            </button>
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
      </div>
    </div>
  );
}
