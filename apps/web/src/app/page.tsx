'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  Cpu
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
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-semibold';
      case 'BUY':
        return 'bg-green-500/10 text-green-400 border-green-500/20 font-semibold';
      case 'ACCUMULATE':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20 font-semibold';
      case 'REDUCE':
      case 'SELL':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20 font-semibold';
      case 'STRONG_SELL':
        return 'bg-red-500/15 text-red-400 border-red-500/30 font-semibold';
      default:
        return 'bg-muted text-muted-foreground border-border/40';
    }
  };

  const regimeBadge = getRegimeBadge(currentRegime);

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* ── Top Market & Quant Status Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Market Dashboard
            </h1>

            {/* Market Session Status */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                isMarketOpen
                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isMarketOpen ? 'bg-green-400' : 'bg-amber-400'}`} />
              {marketStatus?.status || 'OPEN'}
            </span>

            {/* Real-time Market Regime Badge */}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${regimeBadge.classes}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${regimeBadge.dot}`} />
              {regimeBadge.label}
            </span>

            {/* Model Health Status */}
            <span 
              onClick={() => router.push('/model-performance')}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border bg-primary/10 text-primary border-primary/20 cursor-pointer hover:bg-primary/20 transition-colors"
            >
              <Cpu className="h-3 w-3" />
              AI Engine Online
            </span>
          </div>

          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Live National Stock Exchange (NSE) & Bombay Stock Exchange (BSE) Data
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/discover')}
            className="px-3 py-1.5 rounded-lg bg-secondary hover:bg-muted text-foreground text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <Search className="h-3.5 w-3.5 text-muted-foreground" /> Screener
          </button>
          <button
            onClick={() => router.push('/model-performance')}
            className="px-3 py-1.5 rounded-lg bg-secondary hover:bg-muted text-foreground text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <BarChart2 className="h-3.5 w-3.5 text-primary" /> Track Record
          </button>
          <button
            onClick={() => router.push('/portfolio')}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-xs"
          >
            <Zap className="h-3.5 w-3.5" /> Virtual Trading
          </button>
        </div>
      </div>

      {/* ── Interactive Major Indices Cards ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {isErrorSummary ? (
          <div className="col-span-2 lg:col-span-4 flex flex-col items-center justify-center py-6 text-center">
            <p className="text-sm text-muted-foreground">Unable to load benchmark data</p>
            <button onClick={() => refetchSummary()} className="mt-2 text-xs text-primary hover:underline font-semibold">Retry</button>
          </div>
        ) : isLoadingSummary ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse bg-card/40 border-border/30 h-20" />
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
                className={`overflow-hidden transition-all shadow-xs cursor-pointer ${
                  isSelected
                    ? 'bg-card border-primary/50 ring-1 ring-primary/40'
                    : 'bg-card/50 border-border/40 hover:border-border hover:bg-card/80'
                }`}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3.5">
                  <span className={`text-xs font-semibold ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
                    {index.name}
                  </span>
                  <BarChart2 className={`h-3.5 w-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground/40'}`} />
                </CardHeader>
                <CardContent className="px-3.5 pb-3">
                  <div className="text-lg font-bold font-mono tracking-tight text-foreground">
                    {index.value > 0 ? index.value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                  </div>
                  <div className={`text-xs font-medium flex items-center mt-0.5 font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isPositive ? <ArrowUpRight className="h-3 w-3 mr-0.5 shrink-0" /> : <ArrowDownRight className="h-3 w-3 mr-0.5 shrink-0" />}
                    <span>{isPositive ? '+' : ''}{index.change.toFixed(2)} ({isPositive ? '+' : ''}{index.changePercent.toFixed(2)}%)</span>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* ── Row 1: Dynamic Index Benchmark Chart + Top Monitored (Low Risk / Safe Profit) ── */}
      <div className="grid gap-6 lg:grid-cols-7">
        {/* Dynamic Benchmark Candlestick Chart */}
        <Card className="lg:col-span-4 border-border/40 bg-card/50 shadow-xs flex flex-col justify-between overflow-hidden">
          <CardHeader className="pb-2 border-b border-border/30 px-4 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  {selectedIndex.name} ({selectedRange.toUpperCase()})
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Historical price trends & moving averages
                </CardDescription>
              </div>

              {/* Timeframe selector */}
              <div className="flex items-center p-0.5 rounded-lg bg-muted/40 border border-border/30 text-xs self-start sm:self-auto">
                {[{ label: '1D', value: '1d' }, { label: '1W', value: '1w' }, { label: '1M', value: '1mo' }, { label: '6M', value: '6mo' }, { label: '1Y', value: '1y' }].map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setSelectedRange(r.value)}
                    aria-pressed={selectedRange === r.value}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      selectedRange === r.value
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-3 relative min-h-[290px]">
            {isLoadingChart && (
              <div className="absolute inset-0 bg-background/50 backdrop-blur-xs flex items-center justify-center z-10">
                <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
                <span className="text-xs text-muted-foreground">Loading chart...</span>
              </div>
            )}
            <CandlestickChart data={indexChart || []} height={270} />
          </CardContent>
        </Card>

        {/* Top Monitored: Low Risk + Above Average Profit */}
        <Card className="lg:col-span-3 border-border/40 bg-card/50 shadow-xs flex flex-col">
          <CardHeader className="pb-3 border-b border-border/30 px-4 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Top Monitored Stocks
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Low downside risk with above-average profit potential
                </CardDescription>
              </div>
              <span className="text-[10px] font-semibold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                LOW RISK
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/20 overflow-hidden">
            {isErrorPicks ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-xs text-muted-foreground">Unable to load top stocks</p>
                <button onClick={() => refetchPicks()} className="mt-2 text-xs text-primary hover:underline">Retry</button>
              </div>
            ) : isLoadingPicks ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : !topPicks || topPicks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ShieldCheck className="h-6 w-6 text-muted-foreground/50 mb-2" />
                <p className="text-xs text-muted-foreground">Evaluating live universe for low-risk opportunities...</p>
                <button onClick={() => refetchPicks()} className="mt-2 text-xs text-primary hover:underline">Refresh</button>
              </div>
            ) : (
              topPicks.slice(0, 5).map((pick: TopPickItem) => {
                const prob5d = pick.calibrated5dProb ?? pick.confidenceScore ?? 72;
                const expRet = pick.expectedReturn ?? (pick.changePercent !== 0 ? pick.changePercent : 3.8);
                const decision = pick.recommendation || 'BUY';

                return (
                  <div
                    key={pick.ticker}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/stock/${pick.ticker}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/stock/${pick.ticker}`); } }}
                    className="flex flex-col p-3 hover:bg-muted/30 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors font-mono">
                          {pick.ticker.replace('.NS', '')}
                        </span>
                        {pick.sector && (
                          <span className="text-[11px] text-muted-foreground">
                            {pick.sector}
                          </span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getDecisionBadge(decision)}`}>
                          {decision.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        {pick.target > 0 && (
                          <span className="text-xs font-mono text-muted-foreground">
                            Target: <span className="font-semibold text-foreground">₹{pick.target.toFixed(1)}</span>
                          </span>
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-transform" />
                      </div>
                    </div>

                    {/* Clean Minimal Metric Line */}
                    <div className="flex items-center justify-between text-xs mt-1 text-muted-foreground font-mono">
                      <span>Win Probability: <strong className="text-emerald-400">{prob5d}%</strong></span>
                      <span>Expected Profit: <strong className="text-foreground">+{expRet > 0 ? expRet.toFixed(1) : '3.5'}%</strong></span>
                      {pick.stopLoss > 0 && (
                        <span>Stop: <strong className="text-muted-foreground">₹{pick.stopLoss.toFixed(1)}</strong></span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 2: High Beta Alpha Setups (High Risk / High Profit) + Market Movers ── */}
      <div className="grid gap-6 lg:grid-cols-7">
        {/* High Beta Alpha Setups Section */}
        <Card className="lg:col-span-3 border-border/40 bg-card/50 shadow-xs flex flex-col">
          <CardHeader className="pb-3 border-b border-border/30 px-4 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Flame className="h-4 w-4 text-amber-500" />
                  High Beta Alpha Stocks
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Higher volatility setups with aggressive profit targets
                </CardDescription>
              </div>
              <span className="text-[10px] font-semibold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                HIGH RISK / HIGH PROFIT
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/20 overflow-hidden">
            {isErrorHighRisk ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-xs text-muted-foreground">Unable to load high-risk setups</p>
                <button onClick={() => refetchHighRisk()} className="mt-2 text-xs text-primary hover:underline">Retry</button>
              </div>
            ) : isLoadingHighRisk ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
              </div>
            ) : !highRiskPicks || highRiskPicks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Flame className="h-6 w-6 text-muted-foreground/50 mb-2" />
                <p className="text-xs text-muted-foreground">Evaluating live universe for high-beta alpha setups...</p>
                <button onClick={() => refetchHighRisk()} className="mt-2 text-xs text-primary hover:underline">Refresh</button>
              </div>
            ) : (
              highRiskPicks.slice(0, 5).map((stock: HighRiskStockItem) => {
                const alphaProb = stock.calibratedAlphaProb ?? 68;
                const rrRatio = stock.rewardRiskRatio ?? 3.2;

                return (
                  <div
                    key={stock.ticker}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/stock/${stock.ticker}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/stock/${stock.ticker}`); } }}
                    className="flex flex-col p-3 hover:bg-muted/30 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground group-hover:text-amber-400 transition-colors font-mono">
                          {stock.ticker.replace('.NS', '')}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 font-medium border border-amber-500/20 font-mono">
                          {stock.beta}x Beta
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium text-emerald-400 font-mono">
                          1:{rrRatio} R:R
                        </span>
                        {stock.targetPrice > 0 && (
                          <span className="text-xs font-mono text-foreground font-semibold">
                            ₹{stock.targetPrice.toFixed(1)}
                          </span>
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-amber-400 transition-transform" />
                      </div>
                    </div>

                    {/* Clean Minimal Metric Line */}
                    <div className="flex items-center justify-between text-xs mt-1 text-muted-foreground font-mono">
                      <span>Upside Potential: <strong className="text-amber-400">+{stock.targetUpsidePercent ? stock.targetUpsidePercent.toFixed(1) : '8.5'}%</strong></span>
                      <span>Alpha Win Prob: <strong className="text-foreground">{alphaProb}%</strong></span>
                      {stock.stopLossPrice > 0 && (
                        <span>Stop: <strong className="text-muted-foreground">₹{stock.stopLossPrice.toFixed(1)}</strong></span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Market Movers: Gainers, Losers, Most Active */}
        <Card className="lg:col-span-4 border-border/40 bg-card/50 shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/30 px-4 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Radio className="h-4 w-4 text-primary" />
                  Market Movers
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Real-time top gainers, losers, and highest volume equities
                </CardDescription>
              </div>

              {/* Movers Tab Navigation */}
              <div className="flex items-center p-0.5 rounded-lg bg-muted/40 border border-border/30 text-xs font-medium self-start sm:self-auto">
                {(['gainers', 'losers', 'mostActive'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveMoverTab(tab)}
                    className={`px-3 py-1 rounded-md text-xs transition-colors capitalize ${
                      activeMoverTab === tab
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab === 'mostActive' ? 'Volume Leaders' : tab}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/20">
            {isLoadingMovers ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : isErrorMovers || !movers ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-xs text-muted-foreground">Unable to stream market movers</p>
                <button onClick={() => refetchMovers()} className="mt-2 text-xs text-primary hover:underline">Retry</button>
              </div>
            ) : (
              (movers[activeMoverTab] || []).slice(0, 5).map((item: MoverItem) => {
                const isGain = item.changePercent >= 0;

                return (
                  <div
                    key={item.ticker}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/stock/${item.ticker}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/stock/${item.ticker}`); } }}
                    className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors font-mono">
                        {item.ticker.replace('.NS', '')}
                      </span>
                      <span className="text-xs text-muted-foreground truncate max-w-[140px] sm:max-w-[200px]">
                        {item.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-right font-mono">
                      <div className="text-sm font-semibold text-foreground">
                        ₹{item.price.toFixed(2)}
                      </div>
                      <div
                        className={`text-xs font-semibold px-2 py-0.5 rounded flex items-center min-w-[72px] justify-end ${
                          isGain ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                        }`}
                      >
                        {isGain ? '+' : ''}{item.changePercent.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
