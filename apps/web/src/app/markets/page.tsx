'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Activity, BarChart4, TrendingUp, TrendingDown, Clock, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { useMarketSummary, useMarketStatus, useMarketMovers, MarketIndex } from '@/hooks/use-stock';
import { useRouter } from 'next/navigation';

export default function MarketsPage() {
  const router = useRouter();
  const { data: indices, isLoading: isLoadingIndices } = useMarketSummary();
  const { data: marketStatus } = useMarketStatus();
  const { data: movers, isLoading: isLoadingMovers } = useMarketMovers();

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Global & Indian Markets
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time multi-index tracking, market breadth, and sector momentum.
          </p>
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-muted/60 text-muted-foreground border border-border/40 flex items-center gap-1.5 self-start md:self-auto">
          <Clock className="h-3 w-3" /> Status: {marketStatus?.status || 'REGULAR'}
        </span>
      </div>

      {/* Indices Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoadingIndices ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse bg-muted/20 border-border/40 h-28" />
          ))
        ) : (
          indices?.map((index: MarketIndex) => {
            const isPositive = index.changePercent >= 0;
            return (
              <Card key={index.symbol} className="bg-card/70 border-border/50 shadow-sm p-4 space-y-2">
                <div className="flex justify-between items-center text-xs font-bold text-muted-foreground">
                  <span>{index.name}</span>
                  <Activity className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="text-2xl font-extrabold text-foreground">
                  {index.value > 0 ? index.value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                </div>
                <div className={`text-xs font-bold flex items-center ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                  {isPositive ? <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" /> : <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" />}
                  {isPositive ? '+' : ''}{index.change.toFixed(2)} ({isPositive ? '+' : ''}{index.changePercent.toFixed(2)}%)
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Market Breadth & Movers */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/50 bg-card/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-border/30">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" /> Leading Gainers Today
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/20">
            {isLoadingMovers ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              (movers?.gainers || []).map((stock) => (
                <div
                  key={stock.ticker}
                  onClick={() => router.push(`/stock/${stock.ticker}`)}
                  className="flex items-center justify-between p-3.5 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <div>
                    <span className="font-bold text-xs text-foreground">{stock.ticker.replace('.NS', '')}</span>
                    <div className="text-[11px] text-muted-foreground line-clamp-1">{stock.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-extrabold text-xs">₹{stock.price.toFixed(2)}</div>
                    <div className="text-[11px] font-bold text-green-500">+{stock.changePercent.toFixed(2)}%</div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-border/30">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" /> Leading Decliners Today
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/20">
            {isLoadingMovers ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              (movers?.losers || []).map((stock) => (
                <div
                  key={stock.ticker}
                  onClick={() => router.push(`/stock/${stock.ticker}`)}
                  className="flex items-center justify-between p-3.5 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <div>
                    <span className="font-bold text-xs text-foreground">{stock.ticker.replace('.NS', '')}</span>
                    <div className="text-[11px] text-muted-foreground line-clamp-1">{stock.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-extrabold text-xs">₹{stock.price.toFixed(2)}</div>
                    <div className="text-[11px] font-bold text-red-500">{stock.changePercent.toFixed(2)}%</div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
