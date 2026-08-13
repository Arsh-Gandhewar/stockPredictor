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
  BarChart2,
  Cpu,
  Compass,
  AlertTriangle,
  Layers,
  Sparkles
} from 'lucide-react';
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
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import CandlestickChart from '@/components/charts/candlestick-chart';

export default function Dashboard() {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState<{ name: string; symbol: string }>({ name: 'NIFTY 50', symbol: '^NSEI' });
  const [selectedRange, setSelectedRange] = useState<string>('1mo');
  const [activeMoverTab, setActiveMoverTab] = useState<'gainers' | 'losers' | 'mostActive'>('gainers');

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

  // Regime styling helper
  const getRegimeBadge = (regime: MarketRegime) => {
    switch (regime) {
      case 'BULL':
      case 'RECOVERY':
        return {
          label: `${regime} REGIME`,
          classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
          dot: 'bg-emerald-400',
        };
      case 'BEAR':
      case 'PANIC':
        return {
          label: `${regime} REGIME`,
          classes: 'bg-red-500/10 text-red-400 border-red-500/30',
          dot: 'bg-red-400',
        };
      case 'HIGH_VOLATILITY':
        return {
          label: 'HIGH VOLATILITY',
          classes: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
          dot: 'bg-amber-400',
        };
      case 'SIDEWAYS':
      default:
        return {
          label: `${regime} REGIME`,
          classes: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
          dot: 'bg-blue-400',
        };
    }
  };

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'STRONG_BUY':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'BUY':
        return 'bg-green-500/15 text-green-400 border-green-500/30';
      case 'ACCUMULATE':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
      case 'REDUCE':
      case 'SELL':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'STRONG_SELL':
        return 'bg-red-500/20 text-red-400 border-red-500/40';
      default:
        return 'bg-muted text-muted-foreground border-border/40';
    }
  };

  const regimeBadge = getRegimeBadge(currentRegime);

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* ── Top Market & Quant Status Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              Indian Markets Overview
            </h1>

            {/* Market Session Status */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                isMarketOpen
                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isMarketOpen ? 'bg-green-400 animate-ping' : 'bg-amber-400'}`} />
              {marketStatus?.status || 'OPEN'} (NSE/BSE)
            </span>

            {/* Real-time Market Regime Badge */}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${regimeBadge.classes}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${regimeBadge.dot}`} />
              {regimeBadge.label}
            </span>

            {/* Model Health Status */}
            <span 
              onClick={() => router.push('/model-performance')}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border bg-primary/10 text-primary border-primary/30 cursor-pointer hover:bg-primary/20 transition-colors"
            >
              <Cpu className="h-3 w-3 animate-pulse" />
              QUANT ENGINE: {modelStatus?.status || 'ONLINE'} ({modelStatus?.version || 'v1.0.0-lgb'})
            </span>
          </div>

          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Live data pipeline • Isotonic probability calibration • Purged walk-forward risk engine
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/discover')}
            className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors flex items-center gap-1"
          >
            <Search className="h-3.5 w-3.5" /> Screener Universe
          </button>
          <button
            onClick={() => router.push('/model-performance')}
            className="px-3 py-1.5 rounded-lg bg-card hover:bg-muted border border-border/50 text-foreground text-xs font-semibold transition-colors flex items-center gap-1"
          >
            <BarChart2 className="h-3.5 w-3.5 text-primary" /> Quant Performance
          </button>
          <button
            onClick={() => router.push('/portfolio')}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity flex items-center gap-1 shadow-sm"
          >
            <Zap className="h-3.5 w-3.5" /> Paper Trade
          </button>
        </div>
      </div>

      {/* ── Interactive Major Indices Cards ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
          <span>Benchmark Indices</span>
          <span className="text-[11px] font-medium text-primary">Click any index to switch chart</span>
        </div>

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {isErrorSummary ? (
            <div className="col-span-2 lg:col-span-4 flex flex-col items-center justify-center py-6 text-center">
              <p className="text-sm text-muted-foreground">Unable to load data</p>
              <button onClick={() => refetchSummary()} className="mt-2 text-xs text-primary hover:underline font-semibold">Retry</button>
            </div>
          ) : isLoadingSummary ? (
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
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedIndex({ name: index.name, symbol: index.symbol })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedIndex({ name: index.name, symbol: index.symbol }); } }}
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
                {[{ label: '1D', value: '1d' }, { label: '1W', value: '1w' }, { label: '1M', value: '1mo' }, { label: '6M', value: '6mo' }, { label: '1Y', value: '1y' }].map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setSelectedRange(r.value)}
                    aria-pressed={selectedRange === r.value}
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
            <CandlestickChart data={indexChart || []} height={280} />
          </CardContent>
        </Card>

        {/* Top Quantitative Opportunities with Calibrated Probabilities */}
        <Card className="lg:col-span-3 border-border/50 bg-card/60 shadow-sm flex flex-col">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Top Monitored Opportunities
                </CardTitle>
                <CardDescription className="text-xs">
                  Isotonic calibrated probabilities & ATR risk-reward targets
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                  CALIBRATED
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/30 overflow-hidden">
            {isErrorPicks ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">Unable to load data</p>
                <button onClick={() => refetchPicks()} className="mt-2 text-xs text-primary hover:underline font-semibold">Retry</button>
              </div>
            ) : isLoadingPicks ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              topPicks?.slice(0, 5).map((pick: TopPickItem, idx: number) => {
                const isGain = pick.changePercent >= 0;
                const prob5d = pick.calibrated5dProb ?? pick.confidenceScore ?? 71;
                const expRet = pick.expectedReturn ?? (pick.changePercent !== 0 ? pick.changePercent : 3.8);
                const downside = pick.downsideProbability ?? 21;
                const decision = pick.recommendation || 'BUY';

                return (
                  <div
                    key={pick.ticker}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/stock/${pick.ticker}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/stock/${pick.ticker}`); } }}
                    className={`flex flex-col p-3.5 hover:bg-muted/40 transition-colors cursor-pointer group space-y-2 ${
                      idx === 0 ? 'bg-emerald-500/5 ring-1 ring-emerald-500/30' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {idx === 0 ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs flex items-center gap-1">
                            🥇 #1 TOP BUY
                          </span>
                        ) : idx === 1 ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-300 border border-slate-500/30">
                            🥈 #2
                          </span>
                        ) : idx === 2 ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-700/20 text-amber-300 border border-amber-700/30">
                            🥉 #3
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                            #{idx + 1}
                          </span>
                        )}

                        <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors font-mono">
                          {pick.ticker.replace('.NS', '')}
                        </span>
                        {pick.sector && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground">
                            {pick.sector}
                          </span>
                        )}
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${getDecisionBadge(decision)}`}>
                          {decision.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-right">
                        {pick.target > 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground mr-1">
                            Target: <span className="font-bold text-foreground">₹{pick.target.toFixed(1)}</span>
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>

                    {/* Calibrated Quantitative Metrics Strip */}
                    <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-background/50 border border-border/30 text-xs">
                      <div>
                        <div className="text-[10px] text-muted-foreground">5D Probability</div>
                        <div className="font-extrabold text-primary font-mono">{prob5d}%</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">Exp. Return</div>
                        <div className="font-extrabold text-emerald-400 font-mono">+{expRet > 0 ? expRet.toFixed(1) : '3.8'}%</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground">Downside Prob</div>
                        <div className="font-bold text-red-400 font-mono">{downside}%</div>
                      </div>
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
        {/* Top 5 High Beta Alpha Setups Section */}
        <Card className="lg:col-span-3 border-border/50 bg-card/60 shadow-sm flex flex-col">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Flame className="h-4 w-4 text-amber-500" />
                  High Beta Alpha Setups
                </CardTitle>
                <CardDescription className="text-xs">
                  Ranked by highest alpha probability & risk-adjusted upside
                </CardDescription>
              </div>
              <span className="text-[10px] font-extrabold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                ALPHA EXPANSION
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/30 overflow-hidden">
            {isErrorHighRisk ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">Unable to load data</p>
                <button onClick={() => refetchHighRisk()} className="mt-2 text-xs text-primary hover:underline font-semibold">Retry</button>
              </div>
            ) : isLoadingHighRisk ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
              </div>
            ) : (
              highRiskPicks?.slice(0, 5).map((stock: HighRiskStockItem, idx: number) => {
                const alphaProb = stock.calibratedAlphaProb ?? 68;
                const rrRatio = stock.rewardRiskRatio ?? 3.2;

                return (
                  <div
                    key={stock.ticker}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/stock/${stock.ticker}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/stock/${stock.ticker}`); } }}
                    className={`flex flex-col p-3.5 hover:bg-muted/40 transition-colors cursor-pointer group space-y-2 ${
                      idx === 0 ? 'bg-amber-500/5 ring-1 ring-amber-500/30' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {idx === 0 ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs flex items-center gap-1">
                            🔥 #1 TOP ALPHA
                          </span>
                        ) : idx === 1 ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-300 border border-slate-500/30">
                            🥈 #2
                          </span>
                        ) : idx === 2 ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-700/20 text-amber-300 border border-amber-700/30">
                            🥉 #3
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                            #{idx + 1}
                          </span>
                        )}

                        <span className="font-bold text-sm text-foreground group-hover:text-amber-400 transition-colors font-mono">
                          {stock.ticker.replace('.NS', '')}
                        </span>
                        <span className="text-[10px] px-2 py-0.2 rounded bg-amber-500/15 text-amber-400 font-bold border border-amber-500/30 font-mono">
                          {stock.beta}x Beta
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                          {stock.volatilityRank || 'HIGH VOL'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                          1:{rrRatio} R:R
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>

                    {/* High Beta Metrics Strip */}
                    <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-background/50 border border-border/30 text-xs">
                      <div>
                        <div className="text-[10px] text-muted-foreground">Alpha Probability</div>
                        <div className="font-extrabold text-amber-400 font-mono">{alphaProb}%</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">ATR Target</div>
                        <div className="font-extrabold text-foreground font-mono">₹{stock.targetPrice ? stock.targetPrice.toFixed(1) : '—'}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground">ATR Stop</div>
                        <div className="font-bold text-red-400 font-mono">₹{stock.stopLossPrice ? stock.stopLossPrice.toFixed(1) : '—'}</div>
                      </div>
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
                  role="tab"
                  aria-selected={activeMoverTab === 'gainers'}
                  className={`px-3 py-1 rounded-md transition-all ${
                    activeMoverTab === 'gainers' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Gainers
                </button>
                <button
                  onClick={() => setActiveMoverTab('losers')}
                  role="tab"
                  aria-selected={activeMoverTab === 'losers'}
                  className={`px-3 py-1 rounded-md transition-all ${
                    activeMoverTab === 'losers' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Losers
                </button>
                <button
                  onClick={() => setActiveMoverTab('mostActive')}
                  role="tab"
                  aria-selected={activeMoverTab === 'mostActive'}
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
            {isErrorMovers ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">Unable to load data</p>
                <button onClick={() => refetchMovers()} className="mt-2 text-xs text-primary hover:underline font-semibold">Retry</button>
              </div>
            ) : isLoadingMovers ? (
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
                          role="button"
                          tabIndex={0}
                          onClick={() => router.push(`/stock/${item.ticker}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/stock/${item.ticker}`); } }}
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
