'use client';

import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUpRight, ArrowDownRight, TrendingUp, Info } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

export default function StockDetailsPage() {
  const params = useParams();
  const ticker = params.ticker as string;
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Mock data for the chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#d1d5db', // text-muted-foreground
      },
      grid: {
        vertLines: { color: '#1f2937' }, // border
        horzLines: { color: '#1f2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', // green-500
      downColor: '#ef4444', // red-500
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Generate some mock candlestick data
    const data = [];
    let basePrice = 2800;
    for (let i = 0; i < 100; i++) {
      const open = basePrice + (Math.random() - 0.5) * 50;
      const close = open + (Math.random() - 0.5) * 50;
      const high = Math.max(open, close) + Math.random() * 20;
      const low = Math.min(open, close) - Math.random() * 20;
      data.push({
        time: \`2026-04-\${(i % 30 + 1).toString().padStart(2, '0')}\`,
        open, high, low, close
      });
      basePrice = close;
    }

    candlestickSeries.setData(data);

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
  }, []);

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">{ticker}</h1>
          <p className="text-xl text-muted-foreground">Reliance Industries Ltd</p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold">₹2,934.50</div>
          <div className="text-lg font-medium text-green-500 flex items-center justify-end">
            <ArrowUpRight className="h-5 w-5 mr-1" />
            +45.20 (1.56%)
          </div>
        </div>
      </div>

      {/* Chart */}
      <Card className="border-border shadow-sm">
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span>Price Chart (1D)</span>
            <div className="flex gap-2 text-xs">
              <button className="px-2 py-1 rounded bg-accent">1D</button>
              <button className="px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground">1W</button>
              <button className="px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground">1M</button>
              <button className="px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground">1Y</button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={chartContainerRef} className="w-full" />
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
              <p className="text-sm text-muted-foreground leading-relaxed">
                Reliance Industries Limited is an Indian multinational conglomerate company, headquartered in Mumbai, India. It has diverse businesses including energy, petrochemicals, natural gas, retail, telecommunications, mass media, and textiles.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Sector:</span> Energy
                </div>
                <div>
                  <span className="text-muted-foreground">Industry:</span> Oil & Gas
                </div>
                <div>
                  <span className="text-muted-foreground">Market Cap:</span> ₹19.8T
                </div>
                <div>
                  <span className="text-muted-foreground">P/E Ratio:</span> 28.5
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
              <div className="flex items-center justify-between">
                <span className="font-medium text-muted-foreground">Action</span>
                <span className="font-bold text-green-500 text-lg">STRONG BUY</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-muted-foreground">Confidence</span>
                <span className="font-bold text-primary">92%</span>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  The stock has broken out of a 6-month consolidation zone with high volume. MACD shows a bullish crossover and RSI is trending up but not overbought. Expected short-term target is ₹3,200.
                </p>
              </div>
              <button className="w-full mt-4 bg-primary text-primary-foreground font-medium py-2 rounded-md hover:bg-primary/90 transition-colors">
                Trade Now
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
