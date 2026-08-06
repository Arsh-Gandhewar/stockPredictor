'use client';

import { ArrowUpRight, ArrowDownRight, Activity, TrendingUp, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMarketSummary, useTopPicks } from '@/hooks/use-stock';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const router = useRouter();
  const { data: marketSummary, isLoading: isLoadingSummary } = useMarketSummary();
  const { data: aiPicks, isLoading: isLoadingPicks } = useTopPicks();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Market Overview</h1>
        <p className="text-muted-foreground">
          AI-driven insights and real-time market data.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoadingSummary ? (
          <div className="col-span-4 flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          marketSummary?.map((index: any) => (
            <Card key={index.name} className="overflow-hidden relative bg-gradient-to-br from-card to-card/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{index.name}</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{index.value}</div>
                <p className={`text-xs flex items-center mt-1 \${index.up ? 'text-green-500' : 'text-red-500'}`}>
                  {index.up ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
                  {index.change}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 shadow-sm border-border">
          <CardHeader>
            <CardTitle>Market Trend (NIFTY 50)</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px] w-full flex items-center justify-center border-dashed border-2 border-muted rounded-md text-muted-foreground">
              [TradingView Lightweight Chart Component]
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-3 shadow-sm border-border">
          <CardHeader>
            <CardTitle>Top AI Picks</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingPicks ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-4">
                {aiPicks?.map((pick: any) => (
                  <div 
                    key={pick.ticker} 
                    onClick={() => router.push(`/stock/${pick.ticker}`)}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent transition-colors cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="font-bold">{pick.ticker}</span>
                      <span className="text-xs text-muted-foreground">{pick.name}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="font-medium">₹{pick.price}</span>
                      <span className="text-xs font-bold text-primary flex items-center">
                        <TrendingUp className="h-3 w-3 mr-1" /> {pick.recommendation} ({pick.confidence}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
