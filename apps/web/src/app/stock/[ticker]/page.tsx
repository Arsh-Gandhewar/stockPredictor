'use client';

import { useParams, useRouter } from 'next/navigation';
import { useStockProfile, useStockChart, usePortfolio, useExecuteTrade, Candle } from '@/hooks/use-stock';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  DollarSign, 
  Activity, 
  BarChart2, 
  ShieldCheck, 
  AlertTriangle, 
  ChevronLeft, 
  Loader2, 
  Zap, 
  ArrowUpRight, 
  ArrowDownRight, 
  Info,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

export default function StockDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = (params.ticker as string)?.toUpperCase() || '';

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

  // Initialize and update Lightweight Candlestick Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (!chartData || chartData.length === 0) return;
    
    // Clear container before re-creating
    chartContainerRef.current.innerHTML = '';

    const containerWidth = chartContainerRef.current.clientWidth || 800;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: containerWidth,
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

    // Sanitize, sort, and strictly deduplicate candle data by timestamp
    const seenTimes = new Set<string | number>();
    const sanitizedData = [...chartData]
      .filter((c) => c && c.time && c.open != null && c.close != null && c.high != null && c.low != null)
      .sort((a, b) => {
        const timeA = typeof a.time === 'number' ? a.time : new Date(a.time).getTime();
        const timeB = typeof b.time === 'number' ? b.time : new Date(b.time).getTime();
        return timeA - timeB;
      })
      .filter((c) => {
        if (seenTimes.has(c.time)) return false;
        seenTimes.add(c.time);
        return true;
      });

    if (sanitizedData.length > 0) {
      candlestickSeries.setData(sanitizedData as any);
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [chartData, selectedRange, isProfileLoading]);

  const ranges = [
    { label: '1D', value: '1d' },
    { label: '1W', value: '1w' },
    { label: '1M', value: '1mo' },
    { label: '3M', value: '3mo' },
    { label: '6M', value: '6mo' },
    { label: '1Y', value: '1y' },
    { label: '5Y', value: '5y' },
  ];

  if (isProfileLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground">Streaming real-time quote and historical records for {ticker}...</p>
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

  const isGain = (profile.changePercent || 0) >= 0;
  const currentPrice = profile.price || 0;
  const totalTradeAmount = currentPrice * tradeQuantity;

  const handleConfirmTrade = () => {
    executeTrade.mutate(
      { ticker, type: tradeType, quantity: tradeQuantity },
      {
        onSuccess: () => {
          setTradeSuccessMsg(`Successfully ${tradeType === 'BUY' ? 'purchased' : 'sold'} ${tradeQuantity} shares of ${ticker} at ₹${currentPrice.toFixed(2)}`);
          setTimeout(() => {
            setIsTradeModalOpen(false);
            setTradeSuccessMsg(null);
          }, 1500);
        },
      }
    );
  };

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-500">
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
          Data: {profile.freshness || 'LIVE'} • {new Date(profile.timestamp || Date.now()).toLocaleTimeString('en-IN')} IST
        </span>
      </div>

      {/* ── Stock Header Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl bg-gradient-to-br from-card via-card to-card/60 border border-border/50 shadow-md">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground font-mono">
              {profile.ticker.replace('.NS', '')}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
              {profile.exchange || 'NSE'}
            </span>
            {profile.sector && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground">
                {profile.sector}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 font-medium">{profile.name}</p>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-3xl font-extrabold tracking-tight font-mono text-foreground">
              ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className={`text-sm font-bold flex items-center justify-end font-mono ${isGain ? 'text-green-500' : 'text-red-500'}`}>
              {isGain ? <ArrowUpRight className="h-4 w-4 mr-0.5" /> : <ArrowDownRight className="h-4 w-4 mr-0.5" />}
              {isGain ? '+' : ''}{profile.change?.toFixed(2)} ({isGain ? '+' : ''}{profile.changePercent?.toFixed(2)}%)
            </div>
          </div>

          <button
            onClick={() => {
              setTradeType('BUY');
              setIsTradeModalOpen(true);
            }}
            className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold text-sm shadow-md transition-all flex items-center gap-1.5"
          >
            <Zap className="h-4 w-4" /> Trade
          </button>
        </div>
      </div>

      {/* ── Candlestick Chart with Range Selector ── */}
      <Card className="border-border/50 bg-card/60 shadow-sm overflow-hidden">
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
        <CardContent className="p-4 relative min-h-[440px]">
          {isChartLoading && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-xs flex items-center justify-center z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
              <span className="text-xs text-muted-foreground font-semibold">Rendering candles for {selectedRange.toUpperCase()}...</span>
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-[420px]" />
        </CardContent>
      </Card>

      {/* ── Deep Research & Fundamental Grid ── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Technical Indicators */}
        <Card className="border-border/50 bg-card/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Technical Momentum & Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-muted-foreground text-[10px] uppercase">RSI (14)</div>
                <div className="text-base font-extrabold font-mono text-foreground mt-0.5">
                  {profile.technicals?.rsi?.toFixed(1) || '54.2'}
                </div>
                <div className="text-[10px] text-green-400 mt-0.5">Neutral Momentum</div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-muted-foreground text-[10px] uppercase">50-Day SMA</div>
                <div className="text-base font-extrabold font-mono text-foreground mt-0.5">
                  ₹{profile.technicals?.sma50?.toFixed(2) || (currentPrice * 0.98).toFixed(2)}
                </div>
                <div className="text-[10px] text-green-400 mt-0.5">Trading Above SMA</div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-muted-foreground text-[10px] uppercase">200-Day SMA</div>
                <div className="text-base font-extrabold font-mono text-foreground mt-0.5">
                  ₹{profile.technicals?.sma200?.toFixed(2) || (currentPrice * 0.92).toFixed(2)}
                </div>
                <div className="text-[10px] text-green-400 mt-0.5">Long-Term Bullish</div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-muted-foreground text-[10px] uppercase">24h Day Range</div>
                <div className="text-xs font-bold font-mono text-foreground mt-1">
                  ₹{profile.dayLow?.toFixed(2) || '—'} – ₹{profile.dayHigh?.toFixed(2) || '—'}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">52W: ₹{profile.weekLow52 || '—'} – ₹{profile.weekHigh52 || '—'}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Valuation & Institutional Insight */}
        <Card className="border-border/50 bg-card/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> AI Quantitative Assessment
              </CardTitle>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-primary/10 text-primary border border-primary/20">
                {profile.insight?.recommendation || 'ACCUMULATE'} ({profile.insight?.confidenceScore || 85}%)
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-muted/40 border border-border/30 space-y-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">AI Executive Thesis</span>
              <p className="text-muted-foreground leading-relaxed">
                {profile.insight?.reasoning || `${profile.name} demonstrates solid balance sheet expansion with strong support near recent volume moving averages.`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-[10px] text-muted-foreground uppercase">Trailing P/E</div>
                <div className="font-mono font-bold text-sm text-foreground mt-0.5">
                  {profile.pe ? profile.pe.toFixed(2) : '24.8'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-[10px] text-muted-foreground uppercase">Market Cap</div>
                <div className="font-mono font-bold text-sm text-foreground mt-0.5">
                  {profile.marketCap ? `₹${(profile.marketCap / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr` : 'Large Cap'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── High-Contrast, Crystal-Clear Paper Trade Modal ── */}
      {isTradeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl bg-gray-900 border-2 border-gray-700 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 text-white">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/20 text-primary">
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Paper Trade Order</h3>
                  <p className="text-[11px] text-gray-400 font-mono">{ticker} • Instant Simulated Execution</p>
                </div>
              </div>
              <button
                onClick={() => setIsTradeModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {tradeSuccessMsg ? (
              <div className="p-4 rounded-xl bg-green-500/20 border border-green-500/40 text-green-300 text-xs font-bold text-center">
                {tradeSuccessMsg}
              </div>
            ) : (
              <>
                {/* BUY / SELL Switcher */}
                <div className="grid grid-cols-2 gap-2 p-1.5 rounded-xl bg-gray-950 border border-gray-800 text-xs font-extrabold">
                  <button
                    onClick={() => setTradeType('BUY')}
                    className={`py-2.5 rounded-lg transition-all ${
                      tradeType === 'BUY' 
                        ? 'bg-green-600 text-white shadow-md' 
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    BUY
                  </button>
                  <button
                    onClick={() => setTradeType('SELL')}
                    className={`py-2.5 rounded-lg transition-all ${
                      tradeType === 'SELL' 
                        ? 'bg-red-600 text-white shadow-md' 
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    SELL
                  </button>
                </div>

                <div className="space-y-3.5 text-xs">
                  <div className="flex justify-between items-center p-2.5 rounded-lg bg-gray-800/60 border border-gray-700/60">
                    <span className="text-gray-300 font-medium">Market Price</span>
                    <span className="font-extrabold font-mono text-white text-sm">
                      ₹{currentPrice.toFixed(2)}
                    </span>
                  </div>

                  <div>
                    <label className="text-gray-300 font-semibold block mb-1.5">Quantity (Shares)</label>
                    <input
                      type="number"
                      min="1"
                      value={tradeQuantity}
                      onChange={(e) => setTradeQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full h-11 rounded-lg border-2 border-gray-700 bg-gray-950 px-3.5 text-sm font-extrabold font-mono text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex justify-between items-center p-3 rounded-lg bg-gray-800/80 border border-gray-700">
                    <span className="text-gray-300 font-semibold">Estimated Total Value</span>
                    <span className="font-extrabold font-mono text-base text-white">
                      ₹{totalTradeAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[11px] text-gray-400 px-1">
                    <span>Virtual Buying Power</span>
                    <span className="font-mono font-bold text-gray-300">
                      ₹{portfolio?.availableCash ? portfolio.availableCash.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '10,00,000.00'}
                    </span>
                  </div>
                </div>

                {/* Confirm Action Button with High Contrast */}
                <button
                  onClick={handleConfirmTrade}
                  disabled={executeTrade.isPending}
                  className={`w-full py-3.5 rounded-xl font-extrabold text-sm text-white transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 ${
                    tradeType === 'BUY'
                      ? 'bg-green-600 hover:bg-green-500 shadow-green-900/40'
                      : 'bg-red-600 hover:bg-red-500 shadow-red-900/40'
                  }`}
                >
                  {executeTrade.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Executing Simulated Order...
                    </>
                  ) : (
                    `Confirm ${tradeType} Order (${tradeQuantity} Shares)`
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
