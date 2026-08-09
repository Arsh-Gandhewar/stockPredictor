'use client';

import {
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Clock,
  Radio,
  Search,
  ChevronRight,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  useMarketSummary,
  useMarketStatus,
  useMarketMovers,
  useTopPicks,
  useStockChart,
  MarketIndex,
  MoverItem,
  TopPickItem,
} from '@/hooks/use-stock';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

export default function Dashboard() {
  const router = useRouter();
  const { data: indices, isLoading: isLoadingSummary } = useMarketSummary();
  const { data: marketStatus } = useMarketStatus();
  const { data: movers, isLoading: isLoadingMovers } = useMarketMovers();
  const { data: topPicks, isLoading: isLoadingPicks } = useTopPicks();
  const { data: niftyChart, isLoading: isLoadingChart } = useStockChart('^NSEI', '1mo');

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [activeMoverTab, setActiveMoverTab] = useState<'gainers' | 'losers' | 'mostActive'>('gainers');

  // Interactive NIFTY 50 Chart on Dashboard
  useEffect(() => {
    if (!chartContainerRef.current || !niftyChart || niftyChart.length === 0) return;

    chartContainerRef.current.innerHTML = '';

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      width: chartContainerRef.current.clientWidth,
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

    series.setData(niftyChart as any);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [niftyChart]);

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

      {/* ── Major Indices Cards ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {isLoadingSummary ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse bg-muted/20 border-border/40 h-24" />
          ))
        ) : (
          indices?.map((index: MarketIndex) => {
            const isPositive = index.changePercent >= 0;
            return (
              <Card
                key={index.symbol}
                className="overflow-hidden relative bg-gradient-to-br from-card to-card/60 border-border/50 hover:border-primary/30 transition-all shadow-sm group"
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
                    {index.name}
                  </span>
                  <Activity className="h-3.5 w-3.5 text-muted-foreground/60" />
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="text-xl font-extrabold tracking-tight">
                    {index.value > 0 ? index.value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                  </div>
                  <div className={`text-xs font-semibold flex items-center mt-0.5 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                    {isPositive ? <ArrowUpRight className="h-3 w-3 mr-0.5 shrink-0" /> : <ArrowDownRight className="h-3 w-3 mr-0.5 shrink-0" />}
                    <span>{isPositive ? '+' : ''}{index.change.toFixed(2)} ({isPositive ? '+' : ''}{index.changePercent.toFixed(2)}%)</span>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* ── Main Grid: NIFTY Chart + Top AI Opportunities ── */}
      <div className="grid gap-6 lg:grid-cols-7">
        {/* NIFTY 50 Benchmark Trend */}
        <Card className="lg:col-span-4 border-border/50 bg-card/60 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  NIFTY 50 Benchmark (1 Month)
                </CardTitle>
                <CardDescription className="text-xs">
                  Candlestick price action directly from National Stock Exchange
                </CardDescription>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono">
                1D Interval
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {isLoadingChart ? (
              <div className="h-[280px] w-full flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                <span className="text-xs text-muted-foreground">Streaming historical candles...</span>
              </div>
            ) : (
              <div ref={chartContainerRef} className="w-full h-[280px]" />
            )}
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
                        <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                          {pick.ticker.replace('.NS', '')}
                        </span>
                        {pick.sector && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground">
                            {pick.sector}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground line-clamp-1">{pick.name}</span>
                    </div>

                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="font-extrabold text-sm">
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

      {/* ── Market Movers: Gainers, Losers, Most Active ── */}
      <Card className="border-border/50 bg-card/60 shadow-sm">
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
                Top Gainers
              </button>
              <button
                onClick={() => setActiveMoverTab('losers')}
                className={`px-3 py-1 rounded-md transition-all ${
                  activeMoverTab === 'losers' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Top Losers
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
                    <th className="py-2.5 px-4 text-right">Change (₹)</th>
                    <th className="py-2.5 px-4 text-right">Change (%)</th>
                    <th className="py-2.5 px-4 text-right">Volume</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {(movers?.[activeMoverTab] || []).map((item: MoverItem) => {
                    const isPositive = item.changePercent >= 0;
                    return (
                      <tr
                        key={item.ticker}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => router.push(`/stock/${item.ticker}`)}
                      >
                        <td className="py-3 px-4 font-bold text-foreground flex flex-col">
                          <span>{item.ticker.replace('.NS', '')}</span>
                          <span className="text-[10px] text-muted-foreground font-normal line-clamp-1">{item.name}</span>
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-foreground">
                          ₹{item.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className={`py-3 px-4 text-right font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                          {isPositive ? '+' : ''}{item.change.toFixed(2)}
                        </td>
                        <td className={`py-3 px-4 text-right font-bold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                          {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
                        </td>
                        <td className="py-3 px-4 text-right text-muted-foreground font-mono">
                          {item.volume ? item.volume.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
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
  );
}
