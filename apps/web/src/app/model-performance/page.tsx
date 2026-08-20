'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  useModelPerformance, 
  useModelStatus 
} from '@/hooks/use-stock';
import { 
  CheckCircle2, 
  TrendingUp, 
  ShieldCheck, 
  Zap, 
  Clock, 
  BarChart2, 
  HelpCircle, 
  Loader2,
  AlertTriangle
} from 'lucide-react';

function MetricSkeleton() {
  return (
    <Card className="bg-card/50 border-border/40 shadow-xs animate-pulse">
      <CardHeader className="pb-1 pt-4 px-4">
        <div className="h-3 w-24 bg-muted rounded" />
        <div className="h-7 w-16 bg-muted rounded mt-2" />
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1">
        <div className="h-3 w-full bg-muted/60 rounded" />
      </CardContent>
    </Card>
  );
}

function TimeframeSkeleton() {
  return (
    <Card className="bg-card/50 border-border/40 shadow-xs animate-pulse">
      <CardHeader className="pb-2">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-3 w-48 bg-muted/60 rounded mt-1" />
      </CardHeader>
      <CardContent className="space-y-2 pt-1">
        <div className="h-3 w-full bg-muted/60 rounded" />
        <div className="h-3 w-full bg-muted/60 rounded" />
        <div className="h-1.5 w-full bg-muted/40 rounded-full mt-2" />
      </CardContent>
    </Card>
  );
}

export default function ModelPerformancePage() {
  const { data: perf, isLoading, isError } = useModelPerformance();
  const { data: status } = useModelStatus();

  const winRate = perf?.overallWinRate ?? 0;
  const avgReturn = perf?.overallAvgReturn ?? 0;
  const rrRatio = perf?.overallRiskRewardRatio ?? 0;
  const annualReturn = perf?.annualizedReturn ?? 0;
  const niftyReturn = perf?.nifty50AnnualReturn ?? 0;
  const totalTrades = perf?.totalTrades ?? 0;
  const stocksEvaluated = perf?.stocksEvaluated ?? 0;
  const datasetPeriod = perf?.datasetPeriod ?? '1 year';

  const h1d = perf?.horizons?.['1d'];
  const h5d = perf?.horizons?.['5d'];
  const h20d = perf?.horizons?.['20d'];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500 max-w-6xl mx-auto">
      {/* ── Page Header ── */}
      <div className="border-b border-border/40 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-primary" />
              AI Model Track Record & Accuracy
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Walk-forward backtested performance across {stocksEvaluated > 0 ? stocksEvaluated : '...'} stocks over {datasetPeriod} of historical market data. No look-ahead bias.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isLoading && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running Backtest...
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Engine Status: {status?.status || 'ONLINE'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Error State ── */}
      {isError && (
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Failed to load backtest results. The engine may still be computing. Try refreshing in a minute.</p>
          </CardContent>
        </Card>
      )}

      {/* ── 4 Main Key Metric Cards ── */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </>
        ) : (
          <>
            {/* Metric 1: Overall Win Rate */}
            <Card className="bg-card/50 border-border/40 shadow-xs">
              <CardHeader className="pb-1 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Overall Win Rate</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <div className={`text-2xl font-bold font-mono mt-1 ${winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {winRate.toFixed(1)}%
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-1">
                <p className="text-xs text-muted-foreground">
                  Direction predicted correctly across {totalTrades.toLocaleString()} backtested trades.
                </p>
              </CardContent>
            </Card>

            {/* Metric 2: Average Return per Trade */}
            <Card className="bg-card/50 border-border/40 shadow-xs">
              <CardHeader className="pb-1 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Average Return / Trade</span>
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <div className={`text-2xl font-bold font-mono mt-1 ${avgReturn >= 0 ? 'text-primary' : 'text-red-400'}`}>
                  {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(1)}%
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-1">
                <p className="text-xs text-muted-foreground">
                  Mean return across all 5-day swing trade signals.
                </p>
              </CardContent>
            </Card>

            {/* Metric 3: Risk to Reward Ratio */}
            <Card className="bg-card/50 border-border/40 shadow-xs">
              <CardHeader className="pb-1 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Risk-to-Reward Ratio</span>
                  <ShieldCheck className="h-4 w-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-foreground mt-1">
                  1 : {rrRatio.toFixed(1)}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-1">
                <p className="text-xs text-muted-foreground">
                  Average winning trade is {rrRatio.toFixed(1)}× larger than average losing trade.
                </p>
              </CardContent>
            </Card>

            {/* Metric 4: Annualized Return */}
            <Card className="bg-card/50 border-border/40 shadow-xs">
              <CardHeader className="pb-1 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Annualized Return</span>
                  <Zap className="h-4 w-4 text-amber-400" />
                </div>
                <div className={`text-2xl font-bold font-mono mt-1 ${annualReturn >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                  {annualReturn >= 0 ? '+' : ''}{annualReturn.toFixed(1)}%
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-1">
                <p className="text-xs text-muted-foreground">
                  Backtested vs {niftyReturn >= 0 ? '+' : ''}{niftyReturn.toFixed(1)}% NIFTY 50 buy & hold.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ── Timeframe Accuracy Breakdown ── */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Accuracy Across Trading Timeframes
        </h2>

        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {isLoading ? (
            <>
              <TimeframeSkeleton />
              <TimeframeSkeleton />
              <TimeframeSkeleton />
            </>
          ) : (
            <>
              {/* 1-Day */}
              <Card className="bg-card/50 border-border/40 shadow-xs">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold text-foreground">1-Day (Intraday)</CardTitle>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium">Fast Move</span>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground">
                    {h1d?.tradesCount?.toLocaleString() || 0} trades evaluated
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 pt-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Win Rate:</span>
                    <span className={`font-bold font-mono ${(h1d?.winRate ?? 0) * 100 >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {((h1d?.winRate ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Avg Return:</span>
                    <span className={`font-bold font-mono ${(h1d?.realizedReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {((h1d?.realizedReturn ?? 0) * 100) >= 0 ? '+' : ''}{((h1d?.realizedReturn ?? 0) * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="w-full bg-muted/40 h-1.5 rounded-full overflow-hidden mt-2">
                    <div className="bg-primary h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (h1d?.winRate ?? 0) * 100)}%` }} />
                  </div>
                </CardContent>
              </Card>

              {/* 5-Day (Recommended) */}
              <Card className="bg-card/60 border-primary/40 ring-1 ring-primary/30 shadow-xs">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold text-primary">5-Day (Swing Trade)</CardTitle>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">RECOMMENDED</span>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground">
                    {h5d?.tradesCount?.toLocaleString() || 0} trades evaluated
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 pt-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Win Rate:</span>
                    <span className={`font-bold font-mono ${(h5d?.winRate ?? 0) * 100 >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {((h5d?.winRate ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Avg Return:</span>
                    <span className={`font-bold font-mono ${(h5d?.realizedReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {((h5d?.realizedReturn ?? 0) * 100) >= 0 ? '+' : ''}{((h5d?.realizedReturn ?? 0) * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="w-full bg-muted/40 h-1.5 rounded-full overflow-hidden mt-2">
                    <div className="bg-emerald-400 h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (h5d?.winRate ?? 0) * 100)}%` }} />
                  </div>
                </CardContent>
              </Card>

              {/* 20-Day */}
              <Card className="bg-card/50 border-border/40 shadow-xs">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold text-foreground">20-Day (Monthly Trend)</CardTitle>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium">Position</span>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground">
                    {h20d?.tradesCount?.toLocaleString() || 0} trades evaluated
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 pt-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Win Rate:</span>
                    <span className={`font-bold font-mono ${(h20d?.winRate ?? 0) * 100 >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {((h20d?.winRate ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Avg Return:</span>
                    <span className={`font-bold font-mono ${(h20d?.realizedReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {((h20d?.realizedReturn ?? 0) * 100) >= 0 ? '+' : ''}{((h20d?.realizedReturn ?? 0) * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="w-full bg-muted/40 h-1.5 rounded-full overflow-hidden mt-2">
                    <div className="bg-emerald-400 h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (h20d?.winRate ?? 0) * 100)}%` }} />
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* ── Annual Return Comparison ── */}
      {!isLoading && perf?.baselineComparisons && (
        <Card className="bg-card/50 border-border/40 shadow-xs">
          <CardHeader className="pb-3 px-4 pt-4">
            <CardTitle className="text-sm font-semibold text-foreground">
              Annual Return Comparison vs Benchmark
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              How QuantX AI compares to NIFTY 50 index investing over {datasetPeriod} of backtested data
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {perf.baselineComparisons.map((comp, idx) => {
              const returnPct = (comp.annualReturn * 100);
              const maxBarWidth = Math.max(...perf.baselineComparisons.map(c => Math.abs(c.annualReturn * 100)));
              const barWidth = maxBarWidth > 0 ? Math.min(95, (Math.abs(returnPct) / maxBarWidth) * 85) : 0;
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className={comp.isPrimary ? 'text-primary font-bold' : 'text-muted-foreground'}>
                      {comp.name}
                    </span>
                    <span className={`font-mono font-bold ${returnPct >= 0 ? (comp.isPrimary ? 'text-emerald-400' : 'text-foreground') : 'text-red-400'}`}>
                      {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(1)}% / yr
                    </span>
                  </div>
                  <div className="w-full bg-muted/40 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${comp.isPrimary ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Backtest Methodology & Disclosures ── */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-primary" />
          Backtest Methodology
        </h2>

        <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
          <Card className="bg-card/40 border-border/30 p-4 space-y-1.5 shadow-xs">
            <h3 className="text-xs font-bold text-foreground">Walk-Forward Testing</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The model is evaluated on each historical day using ONLY data available up to that point. No future data is ever used — eliminating look-ahead bias entirely.
            </p>
          </Card>

          <Card className="bg-card/40 border-border/30 p-4 space-y-1.5 shadow-xs">
            <h3 className="text-xs font-bold text-foreground">What &quot;Win Rate&quot; Means</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              If the model predicted &quot;price will go UP&quot; and the price actually went up after the specified timeframe (1d/5d/20d), the trade is counted as a win. Simple directional accuracy.
            </p>
          </Card>

          <Card className="bg-card/40 border-border/30 p-4 space-y-1.5 shadow-xs">
            <h3 className="text-xs font-bold text-foreground">Limitations & Disclosures</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {perf?.disclosures?.dataLimitations || 'Backtest uses historical OHLCV data. News sentiment is set to neutral during backtesting. No transaction costs modeled. Past performance does not guarantee future results.'}
            </p>
          </Card>
        </div>
      </div>

      {/* ── Backtest Metadata ── */}
      {!isLoading && perf && (
        <div className="text-[10px] text-muted-foreground/60 text-center pt-2 border-t border-border/20">
          Model {perf.modelVersion} • Backtested {perf.lastTrained ? new Date(perf.lastTrained).toLocaleDateString() : 'recently'} • {totalTrades.toLocaleString()} trades across {stocksEvaluated} stocks • {datasetPeriod} dataset
        </div>
      )}
    </div>
  );
}
