'use client';

import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUpRight, ArrowDownRight, TrendingUp, Info, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { useStockProfile, useExecuteTrade, useStockChart } from '@/hooks/use-stock';

export default function StockDetailsPage() {
  const params = useParams();
  const ticker = params.ticker as string;
  const chartContainerRef = useRef<HTMLDivElement>(null);
  
  const { data: profile, isLoading: isProfileLoading } = useStockProfile(ticker);
  const { data: chartData, isLoading: isChartLoading } = useStockChart(ticker);
  const executeTrade = useExecuteTrade();

  useEffect(() => {
    if (!chartContainerRef.current || !chartData || chartData.length === 0) return;
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    candlestickSeries.setData(chartData);

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
  }, [chartData]);

  if (isProfileLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return <div>Stock not found</div>;
  }

  const handleBuy = () => {
    executeTrade.mutate({ ticker, type: 'BUY', quantity: 10 });
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">{profile.ticker}</h1>
          <p className="text-xl text-muted-foreground">{profile.name}</p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold">{formatCurrency(profile.price)}</div>
          <div className="text-lg font-medium text-green-500 flex items-center justify-end">
            <ArrowUpRight className="h-5 w-5 mr-1" />
            Active
          </div>
        </div>
      </div>

      {/* Chart */}
      <Card className="border-border shadow-sm">
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span>Price Chart (1D)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isChartLoading ? (
            <div className="h-[400px] flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div ref={chartContainerRef} className="w-full" />
          )}
        </CardContent>
      </Card>

      {/* Details Grid */}
      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Info className="h-4 w-4 mr-2" /> About Company
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Sector:</span> {profile.sector || 'N/A'}
                </div>
                <div>
                  <span className="text-muted-foreground">Exchange:</span> {profile.exchange}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* AI Recommendation Box */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center text-primary">
                <TrendingUp className="h-5 w-5 mr-2" /> AI Insight
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile.insight ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-muted-foreground">Action</span>
                    <span className="font-bold text-green-500 text-lg">{profile.insight.recommendation}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-muted-foreground">Confidence</span>
                    <span className="font-bold text-primary">{profile.insight.confidenceScore}%</span>
                  </div>
                  <div className="pt-2 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                      {profile.insight.reasoning}
                    </p>
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">No recent insights available.</div>
              )}
              <button 
                onClick={handleBuy}
                disabled={executeTrade.isPending}
                className="w-full mt-4 bg-primary text-primary-foreground font-medium py-2 rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {executeTrade.isPending ? 'Processing...' : 'Buy 10 Shares'}
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
