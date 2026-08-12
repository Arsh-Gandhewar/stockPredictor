'use client';

import { useParams, useRouter } from 'next/navigation';
import { useStockProfile, useStockChart, usePortfolio, useExecuteTrade, Candle } from '@/hooks/use-stock';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Activity, 
  BarChart2, 
  ShieldCheck, 
  AlertTriangle, 
  ChevronLeft, 
  Loader2, 
  Zap, 
  ArrowUpRight, 
  ArrowDownRight, 
  Flame,
  Layers,
  Gauge
} from 'lucide-react';
import { useEffect, useState } from 'react';
import CandlestickChart from '@/components/charts/candlestick-chart';

export default function StockDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = params.ticker as string;

  const [selectedRange, setSelectedRange] = useState<string>('6mo');
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [tradeQuantity, setTradeQuantity] = useState<number>(10);
  const [tradeSuccessMsg, setTradeSuccessMsg] = useState<string | null>(null);
  const [tradeErrorMsg, setTradeErrorMsg] = useState<string | null>(null);

  const { data: profile, isLoading: isProfileLoading } = useStockProfile(ticker);
  const { data: chartData, isLoading: isChartLoading } = useStockChart(ticker, selectedRange);
  const { data: portfolio } = usePortfolio();
  const executeTrade = useExecuteTrade();

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
        <p className="text-xs text-muted-foreground">Streaming real-time quote, technicals, and catalyst data...</p>
      </div>
    );
  }

  if (!profile || !profile.quote) {
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

  const quote = profile.quote;
  const isGain = quote.changePercent >= 0;
  const currentPrice = quote.price || 0;
  const totalTradeAmount = currentPrice * tradeQuantity;

  const handleConfirmTrade = () => {
    setTradeErrorMsg(null);
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
        onError: (err: any) => {
          setTradeErrorMsg(err.response?.data?.message || err.message || 'Trade execution failed');
        }
      }
    );
  };

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
          Data: {quote.freshness} • {new Date(quote.timestamp).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })} IST
        </span>
      </div>

      {/* ── Stock Header Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl bg-gradient-to-br from-card via-card to-card/60 border border-border/50 shadow-md">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground font-mono">
              {quote.ticker.replace('.NS', '')}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
              {quote.exchange || 'NSE'}
            </span>
            {profile.stock?.sector && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground">
                {profile.stock.sector}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{quote.name}</p>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-3xl font-extrabold tracking-tight font-mono">
              ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className={`text-sm font-bold flex items-center justify-end ${isGain ? 'text-green-500' : 'text-red-500'}`}>
              {isGain ? <ArrowUpRight className="h-4 w-4 mr-0.5" /> : <ArrowDownRight className="h-4 w-4 mr-0.5" />}
              {isGain ? '+' : ''}{quote.change?.toFixed(2)} ({isGain ? '+' : ''}{quote.changePercent?.toFixed(2)}%)
            </div>
          </div>

          <button
            onClick={() => {
              setTradeType('BUY');
              setIsTradeModalOpen(true);
            }}
            className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-black font-extrabold text-sm shadow-md transition-all flex items-center gap-1.5"
          >
            <Zap className="h-4 w-4" /> Paper Trade
          </button>
        </div>
      </div>

      {/* ── "Why is this Stock Moving Today?" Catalyst Engine ── */}
      {profile.catalyst && (
        <Card className="border-primary/30 bg-gradient-to-r from-primary/10 via-card to-card shadow-sm overflow-hidden">
          <CardHeader className="py-3 px-6 border-b border-primary/20 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-400 animate-pulse" />
              <CardTitle className="text-sm font-bold text-foreground">
                Why is {quote.ticker.replace('.NS', '')} Moving Today?
              </CardTitle>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
              {profile.catalyst.catalystType.replace(/_/g, ' ')}
            </span>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            <p className="text-xs font-semibold text-foreground leading-relaxed">
              {profile.catalyst.primaryDriver}
            </p>

            <div className="grid sm:grid-cols-2 gap-2 text-xs pt-1">
              {profile.catalyst.keyFactors?.map((f, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/30 text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span className="text-[11px]">{f}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Candlestick Chart with Range Selector ── */}
      <Card className="border-border/50 bg-card/60 shadow-sm overflow-hidden">
        <CardHeader className="py-3 px-6 border-b border-border/30">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-bold">Interactive Price Action</CardTitle>
            </div>

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
        <CardContent className="p-4 relative min-h-[440px]">
          {isChartLoading && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-xs flex items-center justify-center z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
              <span className="text-xs text-muted-foreground font-semibold">Rendering candles for {selectedRange.toUpperCase()}...</span>
            </div>
          )}
          <CandlestickChart data={chartData || []} height={420} />
        </CardContent>
      </Card>

      {/* ── Key Metrics, Technical Indicators & AI Thesis ── */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Left 2 Cols: Fundamental Ratios & Technicals */}
        <div className="md:col-span-2 space-y-6">
          {/* Key Financial Ratios */}
          <Card className="border-border/50 bg-card/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/40">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Key Financial Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs font-mono">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1 font-sans">52-Week High</div>
                  <div className="font-bold text-foreground">
                    ₹{quote.weekHigh52 ? quote.weekHigh52.toFixed(2) : 'N/A'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1 font-sans">52-Week Low</div>
                  <div className="font-bold text-foreground">
                    ₹{quote.weekLow52 ? quote.weekLow52.toFixed(2) : 'N/A'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1 font-sans">Price-to-Earnings (P/E)</div>
                  <div className="font-bold text-foreground">
                    {quote.pe ? quote.pe.toFixed(2) : 'N/A'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1 font-sans">Day High</div>
                  <div className="font-bold text-foreground">
                    ₹{quote.dayHigh?.toFixed(2)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1 font-sans">Day Low</div>
                  <div className="font-bold text-foreground">
                    ₹{quote.dayLow?.toFixed(2)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1 font-sans">Market State</div>
                  <div className="font-bold text-primary font-sans">
                    {quote.marketState}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Technical Indicators */}
          {profile.technicals && (
            <Card className="border-border/50 bg-card/60 shadow-sm">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-primary" /> Technical Momentum & Moving Averages
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                  <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="text-muted-foreground mb-1 font-sans">RSI (14)</div>
                    <div className="font-bold text-foreground text-sm">{profile.technicals.rsi}</div>
                    <div className="text-[10px] text-muted-foreground font-sans mt-0.5">{profile.technicals.rsiStance}</div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="text-muted-foreground mb-1 font-sans">MACD Trend</div>
                    <div className="font-bold text-foreground text-sm">{profile.technicals.macd?.trend}</div>
                    <div className="text-[10px] text-muted-foreground font-sans mt-0.5">Hist: {profile.technicals.macd?.histogram}</div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="text-muted-foreground mb-1 font-sans">50-Day SMA</div>
                    <div className="font-bold text-foreground text-sm">₹{profile.technicals.sma50?.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground font-sans mt-0.5">Medium Baseline</div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="text-muted-foreground mb-1 font-sans">Golden Cross</div>
                    <div className={`font-bold text-sm font-sans ${profile.technicals.goldenCross ? 'text-green-400' : 'text-amber-400'}`}>
                      {profile.technicals.goldenCross ? 'Bullish Alignment' : 'Neutral / Under'}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-sans mt-0.5">SMA 50 vs 200</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Col: Structured AI Insight */}
        <div className="space-y-6">
          <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
            <CardHeader className="pb-3 border-b border-primary/10">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold text-primary flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> AI Research Thesis
                </CardTitle>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                  QuantX Guardian
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4 text-xs">
              <div className="flex items-center justify-between p-3 rounded-lg bg-background/60 border border-border/40">
                <span className="text-muted-foreground font-medium">Stance</span>
                <span className={`font-extrabold text-sm ${isGain ? 'text-green-400' : 'text-amber-400'}`}>
                  {isGain ? 'BULLISH MOMENTUM' : 'CONSOLIDATION WATCH'}
                </span>
              </div>

              <div className="space-y-1.5">
                <span className="font-semibold text-foreground">Quantitative View:</span>
                <p className="text-muted-foreground leading-relaxed bg-muted/30 p-3 rounded-lg border border-border/30">
                  {profile.catalyst?.primaryDriver || `Trading actively with institutional liquidity support in ${profile.stock?.sector || 'equities'} sector.`}
                </p>
              </div>

              <div className="space-y-1.5">
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Invalidation Level:
                </span>
                <p className="text-muted-foreground bg-amber-500/5 border border-amber-500/20 p-2.5 rounded-lg font-mono">
                  Thesis is invalidated on high-volume close below ₹{profile.catalyst?.invalidationLevel?.toFixed(2) || (currentPrice * 0.95).toFixed(2)}.
                </p>
              </div>
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
                {tradeErrorMsg && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-bold mb-3 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{tradeErrorMsg}</span>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted/60 border border-border/40 text-xs font-bold">
                  <button
                    onClick={() => setTradeType('BUY')}
                    className={`py-2 rounded-md transition-all ${
                      tradeType === 'BUY' ? 'bg-white text-black font-extrabold shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    BUY
                  </button>
                  <button
                    onClick={() => setTradeType('SELL')}
                    className={`py-2 rounded-md transition-all ${
                      tradeType === 'SELL' ? 'bg-destructive text-destructive-foreground font-bold shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    SELL
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Market Price</span>
                    <span className="font-bold text-foreground font-mono">₹{currentPrice.toFixed(2)}</span>
                  </div>

                  <div>
                    <label className="text-muted-foreground block mb-1 font-semibold">Quantity (Shares)</label>
                    <input
                      type="number"
                      min="1"
                      value={tradeQuantity}
                      onChange={(e) => setTradeQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full h-10 rounded-lg border border-input bg-muted/40 px-3 text-sm font-bold text-foreground font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    />
                  </div>

                  <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30 border border-border/30">
                    <span className="text-muted-foreground">Estimated Total</span>
                    <span className="font-extrabold text-sm text-foreground font-mono">
                      ₹{totalTradeAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                    <span>Virtual Cash Balance</span>
                    <span className="font-mono">₹{portfolio?.availableCash ? portfolio.availableCash.toLocaleString('en-IN') : '10,00,000'}</span>
                  </div>
                </div>

                <button
                  onClick={handleConfirmTrade}
                  disabled={executeTrade.isPending}
                  className={`w-full py-3 rounded-xl font-extrabold text-sm transition-all shadow-md disabled:opacity-50 ${
                    tradeType === 'BUY' ? 'bg-white text-black font-extrabold hover:bg-neutral-200' : 'bg-destructive text-white font-bold hover:bg-destructive/90'
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
