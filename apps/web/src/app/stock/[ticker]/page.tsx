'use client';

import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Info,
  Loader2,
  Clock,
  Activity,
  ShieldCheck,
  Zap,
  ChevronLeft,
  AlertTriangle,
  BarChart2,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { useStockProfile, useStockChart, useExecuteTrade, usePortfolio } from '@/hooks/use-stock';

export default function StockDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = params.ticker as string;

  const [selectedRange, setSelectedRange] = useState<string>('6mo');
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [tradeQuantity, setTradeQuantity] = useState<number>(10);
  const [tradeSuccessMsg, setTradeSuccessMsg] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  
  const { data: profile, isLoading: isProfileLoading } = useStockProfile(ticker);
  const { data: chartData, isLoading: isChartLoading } = useStockChart(ticker, selectedRange);
  const { data: portfolio } = usePortfolio();
  const executeTrade = useExecuteTrade();

  useEffect(() => {
    if (!chartContainerRef.current || !chartData || chartData.length === 0) return;
    
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
      height: 420,
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    candlestickSeries.setData(chartData as any);
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
  }, [chartData]);

  if (isProfileLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground">Streaming real-time quote and historical records...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-muted-foreground">Stock "{ticker}" not found in monitored universe.</p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const isGain = profile.changePercent >= 0;
  const currentPrice = profile.price || 0;
  const totalTradeAmount = currentPrice * tradeQuantity;

  const handleConfirmTrade = () => {
    executeTrade.mutate(
      { ticker, type: tradeType, quantity: tradeQuantity },
      {
        onSuccess: (res: any) => {
          setTradeSuccessMsg(`Successfully ${tradeType === 'BUY' ? 'purchased' : 'sold'} ${tradeQuantity} shares at ₹${currentPrice.toFixed(2)}`);
          setTimeout(() => {
            setIsTradeModalOpen(false);
            setTradeSuccessMsg(null);
          }, 1500);
        },
      }
    );
  };

  const ranges = [
    { label: '1D', value: '1d' },
    { label: '1W', value: '1w' },
    { label: '1M', value: '1mo' },
    { label: '3M', value: '3mo' },
    { label: '6M', value: '6mo' },
    { label: '1Y', value: '1y' },
    { label: '5Y', value: '5y' },
  ];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* ── Navigation Breadcrumb ── */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Data: {profile.freshness} • {new Date(profile.timestamp).toLocaleTimeString('en-IN')} IST
        </span>
      </div>

      {/* ── Stock Header Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl bg-gradient-to-br from-card via-card to-card/60 border border-border/50 shadow-md">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              {profile.ticker.replace('.NS', '')}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
              {profile.exchange}
            </span>
            {profile.sector && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground">
                {profile.sector}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{profile.name}</p>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-3xl font-extrabold tracking-tight">
              ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className={`text-sm font-bold flex items-center justify-end ${isGain ? 'text-green-500' : 'text-red-500'}`}>
              {isGain ? <ArrowUpRight className="h-4 w-4 mr-0.5" /> : <ArrowDownRight className="h-4 w-4 mr-0.5" />}
              {isGain ? '+' : ''}{profile.change?.toFixed(2)} ({isGain ? '+' : ''}{profile.changePercent?.toFixed(2)}%)
            </div>
          </div>

          <button
            onClick={() => {
              setTradeType('BUY');
              setIsTradeModalOpen(true);
            }}
            className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm shadow-md transition-all flex items-center gap-1.5"
          >
            <Zap className="h-4 w-4" /> Trade
          </button>
        </div>
      </div>

      {/* ── Candlestick Chart with Range Selector ── */}
      <Card className="border-border/50 bg-card/60 shadow-sm">
        <CardHeader className="py-3 px-6 border-b border-border/30">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-bold">Interactive Price Action</CardTitle>
            </div>

            {/* Timeframe selector */}
            <div className="flex items-center p-1 rounded-lg bg-muted/60 border border-border/40 text-xs font-semibold">
              {ranges.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setSelectedRange(r.value)}
                  className={`px-3 py-1 rounded-md transition-all ${
                    selectedRange === r.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {isChartLoading ? (
            <div className="h-[420px] flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
              <span className="text-xs text-muted-foreground">Rendering historical candles...</span>
            </div>
          ) : (
            <div ref={chartContainerRef} className="w-full h-[420px]" />
          )}
        </CardContent>
      </Card>

      {/* ── Key Metrics & Financial Parameters ── */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Left 2 Cols: Financial Parameters & Fundamentals */}
        <div className="md:col-span-2 space-y-6">
          <Card className="border-border/50 bg-card/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Key Financial Parameters & Range
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1">Day Range</div>
                  <div className="font-bold text-foreground">
                    ₹{profile.dayLow?.toFixed(2)} - ₹{profile.dayHigh?.toFixed(2)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1">52W Range</div>
                  <div className="font-bold text-foreground">
                    ₹{profile.weekLow52?.toFixed(2) || '—'} - ₹{profile.weekHigh52?.toFixed(2) || '—'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1">Volume</div>
                  <div className="font-bold text-foreground font-mono">
                    {profile.volume ? profile.volume.toLocaleString('en-IN') : '—'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1">Previous Close</div>
                  <div className="font-bold text-foreground">
                    ₹{profile.prevClose?.toFixed(2)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1">P/E Ratio</div>
                  <div className="font-bold text-foreground">
                    {profile.pe ? profile.pe.toFixed(2) : 'N/A'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1">Market Cap</div>
                  <div className="font-bold text-foreground">
                    {profile.marketCap ? `₹${(profile.marketCap / 1e7).toFixed(0)} Cr` : 'N/A'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1">Opening Price</div>
                  <div className="font-bold text-foreground">
                    ₹{profile.open?.toFixed(2)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1">Market State</div>
                  <div className="font-bold text-primary">
                    {profile.marketState}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Col: Structured AI Insight */}
        <div className="space-y-6">
          <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
            <CardHeader className="pb-3 border-b border-primary/10">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold text-primary flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> AI Research Thesis
                </CardTitle>
                {profile.insight && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                    {profile.insight.confidenceScore}% Confidence
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4 text-xs">
              {profile.insight ? (
                <>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-background/60 border border-border/40">
                    <span className="text-muted-foreground font-medium">Stance</span>
                    <span className="font-extrabold text-sm text-green-500">{profile.insight.recommendation}</span>
                  </div>

                  <div className="space-y-1.5">
                    <span className="font-semibold text-foreground">Thesis & Drivers:</span>
                    <p className="text-muted-foreground leading-relaxed bg-muted/30 p-3 rounded-lg border border-border/30">
                      {profile.insight.reasoning}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <span className="font-semibold text-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Invalidation Level:
                    </span>
                    <p className="text-muted-foreground bg-amber-500/5 border border-amber-500/20 p-2.5 rounded-lg">
                      Thesis is invalidated on high-volume close below 50-day moving average.
                    </p>
                  </div>
                </>
              ) : (
                <div className="py-6 text-center text-muted-foreground">
                  <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-40 text-primary" />
                  Generating quant research models...
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Interactive Order Ticket Modal ── */}
      {isTradeModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border/60 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-extrabold text-lg flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Paper Trade Order
              </h3>
              <button
                onClick={() => setIsTradeModalOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕ Close
              </button>
            </div>

            {tradeSuccessMsg ? (
              <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold text-center">
                {tradeSuccessMsg}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted/60 border border-border/40 text-xs font-bold">
                  <button
                    onClick={() => setTradeType('BUY')}
                    className={`py-2 rounded-md transition-all ${
                      tradeType === 'BUY' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    BUY
                  </button>
                  <button
                    onClick={() => setTradeType('SELL')}
                    className={`py-2 rounded-md transition-all ${
                      tradeType === 'SELL' ? 'bg-destructive text-destructive-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    SELL
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Market Price</span>
                    <span className="font-bold text-foreground">₹{currentPrice.toFixed(2)}</span>
                  </div>

                  <div>
                    <label className="text-muted-foreground block mb-1">Quantity (Shares)</label>
                    <input
                      type="number"
                      min="1"
                      value={tradeQuantity}
                      onChange={(e) => setTradeQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full h-10 rounded-lg border border-input bg-muted/40 px-3 text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    />
                  </div>

                  <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30 border border-border/30">
                    <span className="text-muted-foreground">Estimated Total</span>
                    <span className="font-extrabold text-sm text-foreground">
                      ₹{totalTradeAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                    <span>Virtual Cash Balance</span>
                    <span>₹{portfolio?.availableCash ? portfolio.availableCash.toLocaleString('en-IN') : '10,00,000'}</span>
                  </div>
                </div>

                <button
                  onClick={handleConfirmTrade}
                  disabled={executeTrade.isPending}
                  className={`w-full py-3 rounded-xl font-bold text-sm text-white transition-all shadow-md disabled:opacity-50 ${
                    tradeType === 'BUY' ? 'bg-primary hover:bg-primary/90' : 'bg-destructive hover:bg-destructive/90'
                  }`}
                >
                  {executeTrade.isPending ? 'Executing Virtual Order...' : `Confirm ${tradeType} Order`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
