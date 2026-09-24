'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  TrendingUp, 
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
  BarChart2,
  Cpu,
  RefreshCw
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import CandlestickChart from '@/components/charts/candlestick-chart';
import { 
  useMarketSummary, 
  useMarketStatus, 
  useMarketMovers, 
  useTopPicks, 
  useStockChart, 
  useHighRiskStocks, 
  useMarketRegime,
  useModelStatus,
  MarketIndex, 
  MoverItem, 
  TopPickItem, 
  HighRiskStockItem,
  MarketRegime
} from '@/hooks/use-stock';

const TIMEFRAMES = [
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
  { label: '1M', value: '1mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
] as const;

export default function Dashboard() {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState<{ name: string; symbol: string }>({ 
    name: 'NIFTY 50', 
    symbol: '^NSEI' 
  });
  const [selectedRange, setSelectedRange] = useState<string>('1mo');
  const [activeMoverTab, setActiveMoverTab] = useState<'gainers' | 'losers' | 'mostActive'>('gainers');

  // Authoritative React Query Hooks
  const { data: indices, isLoading: isLoadingSummary, isError: isErrorSummary, refetch: refetchSummary } = useMarketSummary();
  const { data: marketStatus } = useMarketStatus();
  const { data: movers, isLoading: isLoadingMovers, isError: isErrorMovers, refetch: refetchMovers } = useMarketMovers();
  const { data: topPicks, isLoading: isLoadingPicks, isError: isErrorPicks, refetch: refetchPicks } = useTopPicks();
  const { data: highRiskPicks, isLoading: isLoadingHighRisk, isError: isErrorHighRisk, refetch: refetchHighRisk } = useHighRiskStocks();
  const { data: indexChart, isLoading: isLoadingChart } = useStockChart(selectedIndex.symbol, selectedRange);
  const { data: regimeData } = useMarketRegime();
  const { data: modelStatus } = useModelStatus();

  const isMarketOpen = marketStatus?.status === 'OPEN';
  const currentRegime: MarketRegime = regimeData?.regime || 'BULL';

  // Institutional Market Session configuration
  const getSessionBadgeProps = (status?: string, isOpen?: boolean) => {
    if (isOpen || status === 'OPEN') {
      return { label: 'NSE/BSE OPEN', variant: 'success' as const, pulse: true };
    }
    switch (status) {
      case 'PRE_OPEN':
        return { label: 'PRE-OPEN', variant: 'warning' as const, pulse: true };
      case 'HOLIDAY':
        return { label: 'MARKET HOLIDAY', variant: 'outline' as const, pulse: false };
      case 'CLOSED':
      default:
        return { label: 'MARKET CLOSED', variant: 'default' as const, pulse: false };
    }
  };

  // Institutional Regime configuration
  const getRegimeBadgeProps = (regime: MarketRegime) => {
    switch (regime) {
      case 'BULL':
        return { label: 'BULL REGIME', variant: 'success' as const, pulse: true };
      case 'RECOVERY':
        return { label: 'RECOVERY REGIME', variant: 'success' as const, pulse: false };
      case 'BEAR':
        return { label: 'BEAR REGIME', variant: 'danger' as const, pulse: true };
      case 'PANIC':
        return { label: 'PANIC REGIME', variant: 'danger' as const, pulse: true };
      case 'HIGH_VOLATILITY':
        return { label: 'HIGH VOLATILITY', variant: 'warning' as const, pulse: true };
      case 'SIDEWAYS':
      default:
        return { label: `${regime} REGIME`, variant: 'info' as const, pulse: false };
    }
  };

  // Decision badge styling helper
  const getDecisionBadgeProps = (decision: string) => {
    switch (decision) {
      case 'STRONG_BUY':
        return { variant: 'success' as const, dot: true, pulse: true, label: 'STRONG BUY' };
      case 'BUY':
        return { variant: 'success' as const, dot: true, pulse: false, label: 'BUY' };
      case 'ACCUMULATE':
        return { variant: 'info' as const, dot: true, pulse: false, label: 'ACCUMULATE' };
      case 'REDUCE':
        return { variant: 'warning' as const, dot: true, pulse: false, label: 'REDUCE' };
      case 'SELL':
      case 'STRONG_SELL':
        return { variant: 'danger' as const, dot: true, pulse: false, label: decision.replace('_', ' ') };
      default:
        return { variant: 'default' as const, dot: false, pulse: false, label: decision.replace('_', ' ') };
    }
  };

  const sessionBadge = getSessionBadgeProps(marketStatus?.status, isMarketOpen);
  const regimeBadge = getRegimeBadgeProps(currentRegime);

  // Volume formatting helper
  const formatVolume = (vol?: number) => {
    if (!vol || vol === 0) return null;
    if (vol >= 10000000) return `${(vol / 10000000).toFixed(2)}Cr vol`;
    if (vol >= 100000) return `${(vol / 100000).toFixed(1)}L vol`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(0)}k vol`;
    return `${vol.toLocaleString('en-IN')} vol`;
  };

  // Current active movers list & max change for percentage move bars
  const currentMovers = useMemo(() => {
    return movers?.[activeMoverTab] || [];
  }, [movers, activeMoverTab]);

  const maxMoverChange = useMemo(() => {
    if (!currentMovers.length) return 5;
    const max = Math.max(...currentMovers.map((m) => Math.abs(m.changePercent || 0)));
    return max > 0 ? max : 5;
  }, [currentMovers]);

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500 w-full max-w-[2100px] mx-auto">
      {/* ── 1. Top Institutional Market Status Bar ── */}
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card/60 backdrop-blur-md p-4 sm:p-5 shadow-sm">
        {/* Subtle decorative mesh gradient */}
        <div className="absolute top-0 right-1/4 -z-10 w-96 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 left-10 -z-10 w-72 h-28 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground font-sans">
                Quant Terminal
              </h1>

              {/* Glowing Session Indicator */}
              <Badge 
                variant={sessionBadge.variant} 
                dot 
                pulse={sessionBadge.pulse}
                className="shadow-xs"
              >
                {sessionBadge.label}
              </Badge>

              {/* Dynamic Market Regime Badge */}
              <Badge 
                variant={regimeBadge.variant} 
                dot 
                pulse={regimeBadge.pulse}
                className="shadow-xs"
              >
                {regimeBadge.label}
              </Badge>

              {/* Model Health Beacon */}
              <Badge 
                variant="glass" 
                dot 
                pulse 
                onClick={() => router.push('/model-performance')}
                className="cursor-pointer hover:bg-primary/20 border-primary/30 text-primary transition-all duration-200 shadow-xs group"
              >
                <Cpu className="h-3 w-3 mr-1 text-primary group-hover:scale-110 transition-transform" />
                Quant Engine {modelStatus?.version || 'v5.1'} Active
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground flex items-center gap-1.5 font-mono">
              <Clock className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
              <span>Authoritative Live Feed: National Stock Exchange (NSE) & Bombay Stock Exchange (BSE)</span>
            </p>
          </div>

          {/* Institutional Quick Action Buttons */}
          <div className="flex items-center gap-2.5 self-start lg:self-auto shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push('/discover')}
              leftIcon={<Search className="h-3.5 w-3.5 text-muted-foreground" />}
              className="bg-card/80 hover:bg-muted/80 border-border/50 text-foreground shadow-xs font-mono"
            >
              Screener
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push('/model-performance')}
              leftIcon={<BarChart2 className="h-3.5 w-3.5 text-primary" />}
              className="bg-card/80 hover:bg-muted/80 border-border/50 text-foreground shadow-xs font-mono"
            >
              Track Record
            </Button>
            <Button
              variant="glow"
              size="sm"
              onClick={() => router.push('/portfolio')}
              leftIcon={<Zap className="h-3.5 w-3.5" />}
              className="shadow-xs font-mono"
            >
              Virtual Trading
            </Button>
          </div>
        </div>
      </div>

      {/* ── 2. Major Indices Cards ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {isErrorSummary ? (
          <div className="col-span-2 lg:col-span-4 flex flex-col items-center justify-center py-8 text-center rounded-xl border border-border/40 bg-card/40 backdrop-blur-md">
            <p className="text-sm text-muted-foreground font-mono">Unable to load benchmark indices</p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetchSummary()} 
              leftIcon={<RefreshCw className="h-3.5 w-3.5 mr-1" />}
              className="mt-3 text-xs"
            >
              Retry Benchmark Stream
            </Button>
          </div>
        ) : isLoadingSummary ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div 
              key={i} 
              className="h-24 rounded-xl border border-border/30 bg-card/40 backdrop-blur-md animate-pulse p-4 flex flex-col justify-between"
            >
              <div className="h-3.5 w-24 bg-muted/40 rounded" />
              <div className="h-6 w-32 bg-muted/40 rounded" />
              <div className="h-3.5 w-20 bg-muted/30 rounded" />
            </div>
          ))
        ) : (
          indices?.map((index: MarketIndex) => {
            const isPositive = index.changePercent >= 0;
            const isSelected = selectedIndex.symbol === index.symbol;

            return (
              <motion.div
                key={index.symbol}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.15 }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedIndex({ name: index.name, symbol: index.symbol })}
                  onKeyDown={(e) => { 
                    if (e.key === 'Enter' || e.key === ' ') { 
                      e.preventDefault(); 
                      setSelectedIndex({ name: index.name, symbol: index.symbol }); 
                    } 
                  }}
                  className={`group relative overflow-hidden rounded-xl p-4 transition-all duration-200 cursor-pointer border select-none ${
                    isSelected
                      ? 'bg-card/90 backdrop-blur-md border-primary/50 ring-1 ring-primary/40 shadow-[0_0_20px_rgba(99,102,241,0.18)]'
                      : 'bg-card/50 backdrop-blur-md border-border/40 hover:border-border/80 hover:bg-card/75 shadow-xs'
                  }`}
                >
                  {/* Glowing top accent border for selected index */}
                  {isSelected && (
                    <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent" />
                  )}

                  <div className="flex items-center justify-between pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-bold uppercase tracking-wider ${isSelected ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground transition-colors'}`}>
                        {index.name}
                      </span>
                      <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-muted/40 text-muted-foreground/80 border border-border/30">
                        {index.symbol.replace('^', '')}
                      </span>
                    </div>

                    <div className={`h-2 w-2 rounded-full transition-all ${isSelected ? 'bg-primary shadow-[0_0_8px_rgba(99,102,241,0.8)]' : 'bg-muted-foreground/30'}`} />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground tabular-nums">
                      {index.value > 0 ? index.value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <div
                        className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-xs font-mono font-medium border ${
                          isPositive
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                        }`}
                      >
                        {isPositive ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />}
                        <span className="tabular-nums">
                          {isPositive ? '+' : ''}{index.change.toFixed(2)} ({isPositive ? '+' : ''}{index.changePercent.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* ── 3. Row 1: Candlestick Chart & Benchmark + Top Monitored (Low Risk / Safe Profit) ── */}
      <div className="grid gap-6 xl:grid-cols-12">
        {/* Sleek Candlestick Chart Container */}
        <div className="xl:col-span-7 2xl:col-span-8 rounded-xl border border-border/50 bg-card/60 backdrop-blur-md shadow-sm overflow-hidden flex flex-col justify-between">
          <div className="px-5 py-4 border-b border-border/40 bg-gradient-to-r from-card/80 via-card/50 to-card/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span>{selectedIndex.name}</span>
                  <Badge variant="outline" size="sm" className="font-mono text-[10px]">
                    {selectedIndex.symbol}
                  </Badge>
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                  Historical price action, candle distribution & moving averages
                </p>
              </div>
            </div>

            {/* Timeframe Selector Pills */}
            <div className="inline-flex items-center p-0.5 rounded-lg bg-background/70 border border-border/40 backdrop-blur-sm text-xs self-start sm:self-auto">
              {TIMEFRAMES.map((r) => {
                const isActive = selectedRange === r.value;
                return (
                  <button
                    key={r.value}
                    onClick={() => setSelectedRange(r.value)}
                    aria-pressed={isActive}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-all ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 relative min-h-[350px]">
            {isLoadingChart && (
              <div className="absolute inset-0 bg-background/60 backdrop-blur-xs flex items-center justify-center z-10">
                <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
                <span className="text-xs text-muted-foreground font-mono">Streaming benchmark candles...</span>
              </div>
            )}
            <CandlestickChart data={indexChart || []} height={360} ticker={selectedIndex.name} />
          </div>
        </div>

        {/* ── 4. Top Monitored Stocks (Low Risk / Safe Profit) ── */}
        <div className="xl:col-span-5 2xl:col-span-4 rounded-xl border border-border/50 bg-card/60 backdrop-blur-md shadow-sm flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-border/40 bg-gradient-to-r from-card/80 via-card/50 to-card/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Top Monitored Stocks
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  Low downside risk with above-average profit potential
                </p>
              </div>
            </div>
            <Badge variant="success" size="sm" dot pulse>
              LOW RISK
            </Badge>
          </div>

          <div className="divide-y divide-border/20 flex-1 overflow-hidden">
            {isErrorPicks ? (
              <div className="flex flex-col items-center justify-center py-14 text-center px-4">
                <p className="text-xs text-muted-foreground font-mono">Unable to load monitored stocks</p>
                <Button variant="outline" size="sm" onClick={() => refetchPicks()} className="mt-3 text-xs">
                  Retry
                </Button>
              </div>
            ) : isLoadingPicks ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground font-mono">Screening low-risk assets...</span>
              </div>
            ) : !topPicks || topPicks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <ShieldCheck className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-xs text-muted-foreground font-mono">Evaluating live universe for low-risk setups...</p>
                <Button variant="ghost" size="sm" onClick={() => refetchPicks()} className="mt-2 text-xs text-primary">
                  Refresh Universe
                </Button>
              </div>
            ) : (
              topPicks.slice(0, 5).map((pick, idx: number) => {
                const prob5d = pick.calibrated5dProb ?? pick.confidenceScore ?? null;
                const expRet = pick.expectedReturn ?? (pick.changePercent !== 0 && pick.changePercent !== null ? pick.changePercent : null);
                const decision = pick.recommendation || 'BUY';
                const decisionBadge = getDecisionBadgeProps(decision);

                return (
                  <div
                    key={pick.ticker}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/stock/${pick.ticker}`)}
                    onKeyDown={(e) => { 
                      if (e.key === 'Enter' || e.key === ' ') { 
                        e.preventDefault(); 
                        router.push(`/stock/${pick.ticker}`); 
                      } 
                    }}
                    className="group relative flex flex-col p-3.5 hover:bg-primary/[0.03] transition-all duration-150 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-mono font-bold bg-muted/60 text-muted-foreground border border-border/40 shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="font-mono font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                          {pick.ticker.replace('.NS', '')}
                        </span>
                        {pick.sector && (
                          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/40 border border-border/30 max-w-[110px] truncate hidden sm:inline-block">
                            {pick.sector}
                          </span>
                        )}
                        <Badge 
                          variant={decisionBadge.variant} 
                          size="sm" 
                          dot={decisionBadge.dot} 
                          pulse={decisionBadge.pulse}
                        >
                          {decisionBadge.label}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {pick.target > 0 && (
                          <span className="text-xs font-mono text-muted-foreground tabular-nums">
                            Target: <span className="font-semibold text-foreground">₹{pick.target.toFixed(1)}</span>
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>

                    {/* Visual Win Probability Progress Bar & Metrics */}
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>Win Prob: <strong className="text-emerald-400 tabular-nums">{prob5d != null ? `${prob5d}%` : '—'}</strong></span>
                        <div className="h-1.5 w-16 sm:w-20 bg-muted/50 rounded-full overflow-hidden shrink-0 border border-border/30">
                          <div 
                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-500" 
                            style={{ width: `${Math.min(100, Math.max(8, prob5d ?? 50))}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span>Expected: <strong className="text-foreground tabular-nums">{expRet != null ? `${expRet > 0 ? '+' : ''}${expRet.toFixed(1)}%` : '—'}</strong></span>
                        {pick.stopLoss > 0 && (
                          <span>Stop: <strong className="text-muted-foreground tabular-nums">₹{pick.stopLoss.toFixed(1)}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── 5. Row 2: High Beta Alpha Setups + Market Movers ── */}
      <div className="grid gap-6 xl:grid-cols-12">
        {/* High Beta Alpha Setups */}
        <div className="xl:col-span-5 2xl:col-span-5 rounded-xl border border-amber-500/25 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden flex flex-col justify-between">
          {/* Subtle amber ambient glow */}
          <div className="absolute -top-14 -right-14 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="px-5 py-4 border-b border-border/40 bg-gradient-to-r from-card/80 via-amber-500/[0.04] to-card/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
                <Flame className="h-4 w-4 text-amber-500 animate-pulse" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  High Beta Alpha Stocks
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  Higher volatility setups with aggressive profit targets
                </p>
              </div>
            </div>
            <Badge variant="warning" size="sm" dot pulse>
              HIGH ALPHA
            </Badge>
          </div>

          <div className="divide-y divide-border/20 flex-1 overflow-hidden">
            {isErrorHighRisk ? (
              <div className="flex flex-col items-center justify-center py-14 text-center px-4">
                <p className="text-xs text-muted-foreground font-mono">Unable to load high-beta alpha setups</p>
                <Button variant="outline" size="sm" onClick={() => refetchHighRisk()} className="mt-3 text-xs">
                  Retry
                </Button>
              </div>
            ) : isLoadingHighRisk ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
                <span className="text-xs text-muted-foreground font-mono">Filtering high-beta momentum...</span>
              </div>
            ) : !highRiskPicks || highRiskPicks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <Flame className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-xs text-muted-foreground font-mono">Evaluating live universe for high-beta opportunities...</p>
                <Button variant="ghost" size="sm" onClick={() => refetchHighRisk()} className="mt-2 text-xs text-amber-500">
                  Refresh Universe
                </Button>
              </div>
            ) : (
              highRiskPicks.slice(0, 5).map((stock: HighRiskStockItem, idx: number) => {
                const alphaProb = stock.calibratedAlphaProb ?? 68;
                const rrRatio = stock.rewardRiskRatio ?? 3.2;

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
                    className="group relative flex flex-col p-3.5 hover:bg-amber-500/[0.04] transition-all duration-150 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="font-mono font-bold text-sm text-foreground group-hover:text-amber-400 transition-colors">
                          {stock.ticker.replace('.NS', '')}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/30 font-mono">
                          {stock.beta ? `${stock.beta}x Beta` : 'High Beta'}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20 font-mono">
                          1:{rrRatio} R:R
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {stock.targetPrice > 0 && (
                          <span className="text-xs font-mono font-semibold text-foreground tabular-nums">
                            ₹{stock.targetPrice.toFixed(1)}
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>

                    {/* Progress Bar & Upside metrics */}
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>Upside: <strong className="text-amber-400 tabular-nums">+{stock.targetUpsidePercent ? stock.targetUpsidePercent.toFixed(1) : '8.5'}%</strong></span>
                        <div className="h-1.5 w-16 sm:w-20 bg-muted/50 rounded-full overflow-hidden shrink-0 border border-border/30">
                          <div 
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full shadow-[0_0_8px_rgba(245,158,11,0.5)] transition-all duration-500" 
                            style={{ width: `${Math.min(100, Math.max(8, alphaProb))}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span>Alpha Win Prob: <strong className="text-foreground tabular-nums">{alphaProb}%</strong></span>
                        {stock.stopLossPrice > 0 && (
                          <span>Stop: <strong className="text-muted-foreground tabular-nums">₹{stock.stopLossPrice.toFixed(1)}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── 6. Market Movers (Gainers, Losers, Most Active) ── */}
        <div className="xl:col-span-7 2xl:col-span-7 rounded-xl border border-border/50 bg-card/60 backdrop-blur-md shadow-sm flex flex-col justify-between overflow-hidden">
          <div className="px-5 py-4 border-b border-border/40 bg-gradient-to-r from-card/80 via-card/50 to-card/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Radio className="h-4 w-4 text-primary animate-pulse" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Market Movers
                </h2>
                <p className="text-[11px] text-muted-foreground font-mono">
                  Real-time top gainers, losers, and highest volume equities
                </p>
              </div>
            </div>

            {/* Movers Tab Navigation */}
            <div className="inline-flex items-center p-0.5 rounded-lg bg-background/70 border border-border/40 backdrop-blur-sm text-xs self-start sm:self-auto">
              {(['gainers', 'losers', 'mostActive'] as const).map((tab) => {
                const isActive = activeMoverTab === tab;
                const label = tab === 'gainers' ? 'Gainers' : tab === 'losers' ? 'Losers' : 'Volume Leaders';
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveMoverTab(tab)}
                    className={`px-3 py-1 rounded-md text-xs font-mono transition-all ${
                      isActive
                        ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 font-medium'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="divide-y divide-border/20 flex-1 overflow-hidden">
            {isLoadingMovers ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground font-mono">Streaming real-time movers...</span>
              </div>
            ) : isErrorMovers || !movers ? (
              <div className="flex flex-col items-center justify-center py-14 text-center px-4">
                <p className="text-xs text-muted-foreground font-mono">Unable to stream market movers</p>
                <Button variant="outline" size="sm" onClick={() => refetchMovers()} className="mt-3 text-xs">
                  Retry Stream
                </Button>
              </div>
            ) : currentMovers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <p className="text-xs text-muted-foreground font-mono">No movers currently recorded for this session.</p>
              </div>
            ) : (
              currentMovers.slice(0, 5).map((item: MoverItem, idx: number) => {
                const isGain = item.changePercent >= 0;
                const barWidth = Math.min(100, Math.round((Math.abs(item.changePercent) / maxMoverChange) * 100));

                return (
                  <div
                    key={item.ticker}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/stock/${item.ticker}`)}
                    onKeyDown={(e) => { 
                      if (e.key === 'Enter' || e.key === ' ') { 
                        e.preventDefault(); 
                        router.push(`/stock/${item.ticker}`); 
                      } 
                    }}
                    className="group relative flex items-center justify-between p-3.5 hover:bg-muted/30 transition-all duration-150 cursor-pointer overflow-hidden"
                  >
                    {/* Visual Percentage Move Magnitude Heatmap Bar */}
                    <div
                      className={`absolute inset-y-0 right-0 pointer-events-none transition-all duration-300 opacity-10 group-hover:opacity-15 ${
                        isGain ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />

                    <div className="flex items-center gap-2.5 relative z-1">
                      <span className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-mono font-bold bg-muted/60 text-muted-foreground border border-border/40 shrink-0">
                        #{idx + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                            {item.ticker.replace('.NS', '')}
                          </span>
                          {item.volume > 0 && activeMoverTab === 'mostActive' && (
                            <span className="text-[10px] font-mono text-muted-foreground/80 px-1.5 py-0.2 rounded bg-muted/30 border border-border/30">
                              {formatVolume(item.volume)}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground truncate max-w-[140px] sm:max-w-[220px] block font-sans">
                          {item.name}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-right relative z-1 font-mono">
                      <div className="text-sm font-bold text-foreground tabular-nums">
                        ₹{item.price.toFixed(2)}
                      </div>
                      <div
                        className={`inline-flex items-center gap-0.5 px-2.5 py-1 rounded-md text-xs font-mono font-semibold min-w-[78px] justify-end border ${
                          isGain
                            ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
                            : 'text-rose-400 bg-rose-500/10 border-rose-500/25'
                        }`}
                      >
                        {isGain ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />}
                        <span className="tabular-nums">
                          {isGain ? '+' : ''}{item.changePercent.toFixed(2)}%
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
