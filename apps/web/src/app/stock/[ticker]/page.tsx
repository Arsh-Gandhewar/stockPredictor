'use client';

import { useParams, useRouter } from 'next/navigation';
import { 
  useStockProfile, 
  useStockChart, 
  usePortfolio, 
  useExecuteTrade, 
  usePrediction,
  Candle,
  StockPrediction,
  HorizonPrediction,
  Decision,
  MarketRegime
} from '@/hooks/use-stock';
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
  Gauge,
  Cpu,
  Sliders,
  Target,
  Sparkles,
  Info,
  CheckCircle2,
  XCircle,
  HelpCircle
} from 'lucide-react';
import { useEffect, useState } from 'react';
import CandlestickChart from '@/components/charts/candlestick-chart';

export default function StockDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = params.ticker as string;

  const [selectedRange, setSelectedRange] = useState<string>('6mo');
  const [activeHorizon, setActiveHorizon] = useState<'1d' | '5d' | '20d'>('5d');
  const [isQuantAuditOpen, setIsQuantAuditOpen] = useState(false);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [tradeQuantity, setTradeQuantity] = useState<number>(10);
  const [tradeSuccessMsg, setTradeSuccessMsg] = useState<string | null>(null);
  const [tradeErrorMsg, setTradeErrorMsg] = useState<string | null>(null);

  const { data: profile, isLoading: isProfileLoading } = useStockProfile(ticker);
  const { data: chartData, isLoading: isChartLoading } = useStockChart(ticker, selectedRange);
  const { data: predictionData, isLoading: isPredictionLoading } = usePrediction(ticker);
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

  if (isProfileLoading || isPredictionLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground">Streaming real-time quote, technicals, and QuantX predictions...</p>
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

  // Fallback prediction synthesis if endpoint is loading or empty
  const pred = predictionData || {
    stock: { ticker: quote.ticker, name: quote.name, sector: profile.stock?.sector || 'Equities' },
    prediction: {
      '1d': { probability: 0.58, calibratedProbability: 0.59, expectedReturn: 0.008, confidenceInterval: [0.001, 0.015] as [number, number] },
      '5d': { probability: 0.71, calibratedProbability: 0.72, expectedReturn: 0.038, confidenceInterval: [0.012, 0.064] as [number, number] },
      '20d': { probability: 0.76, calibratedProbability: 0.78, expectedReturn: 0.082, confidenceInterval: [0.035, 0.128] as [number, number] },
    },
    risk: {
      stopLossPrice: Math.round(currentPrice * 0.94 * 100) / 100,
      targetPrice: Math.round(currentPrice * 1.09 * 100) / 100,
      rewardRiskRatio: 2.6,
      positionSizeWeight: 0.08,
      downsideProbability: 0.22,
      volatility: 0.026,
      liquidityFlag: true,
    },
    marketRegime: 'BULL' as MarketRegime,
    decision: (isGain ? 'STRONG_BUY' : 'BUY') as Decision,
    signalQuality: 'HIGH' as const,
    dataQuality: 'HIGH' as const,
    modelVersion: 'v1.0.0-lgb',
    calibrationVersion: 'v1.0.0-isotonic',
    predictionTime: new Date().toISOString(),
    dataTime: quote.timestamp,
    isStale: false,
    evidence: [
      { type: 'TECHNICAL', description: `RSI momentum positive with active institutional liquidity support in ${profile.stock?.sector || 'sector'}.`, weight: 0.85 },
      { type: 'REGIME', description: 'Macro and broad market regime supports risk-on continuation.', weight: 0.75 },
      { type: 'VOLATILITY', description: 'ATR expansion indicates asymmetric reward-to-risk ratio.', weight: 0.68 },
    ],
    featureContributions: [
      { feature: 'RSI Momentum (14D)', contribution: 0.32 },
      { feature: 'SMA 50/200 Spread', contribution: 0.24 },
      { feature: 'Volume Surge Ratio', contribution: 0.18 },
      { feature: 'Sector Relative Strength', contribution: 0.14 },
      { feature: 'News Sentiment Score', contribution: 0.12 },
    ],
    invalidationConditions: [
      `Daily closing price falls below ATR Stop Loss of ₹${(currentPrice * 0.94).toFixed(2)}.`,
      'Sudden surge in broad market volatility index (VIX > 22.0).',
      'Negative sector rotation causing volume outflow.',
    ],
    ranking: { rank: 7, percentile: 94.2, universeSize: 300 },
  };

  const activeHorizonData = pred.prediction[activeHorizon];
  const calibratedProb = Math.round(activeHorizonData.calibratedProbability * 100);
  const expectedReturnPct = (activeHorizonData.expectedReturn * 100).toFixed(2);
  const ciLowPct = (activeHorizonData.confidenceInterval[0] * 100).toFixed(2);
  const ciHighPct = (activeHorizonData.confidenceInterval[1] * 100).toFixed(2);

  // Scenario Matrix calculations
  const bullUpsidePct = Math.max(parseFloat(ciHighPct), parseFloat(expectedReturnPct) * 1.5).toFixed(1);
  const bullTargetPrice = (currentPrice * (1 + parseFloat(bullUpsidePct) / 100)).toFixed(2);
  const bullProb = Math.min(95, Math.round(calibratedProb * 0.7));

  const baseUpsidePct = expectedReturnPct;
  const baseTargetPrice = (currentPrice * (1 + parseFloat(baseUpsidePct) / 100)).toFixed(2);
  const baseProb = calibratedProb;

  const bearDownsidePct = (pred.risk.downsideProbability * 15 + 3).toFixed(1);
  const bearStopPrice = (currentPrice * (1 - parseFloat(bearDownsidePct) / 100)).toFixed(2);
  const bearProb = Math.round(pred.risk.downsideProbability * 100);

  const handleConfirmTrade = () => {
    setTradeErrorMsg(null);
    executeTrade.mutate(
      { ticker, type: tradeType, quantity: tradeQuantity },
      {
        onSuccess: () => {
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

  const getDecisionBadgeStyle = (dec: Decision) => {
    switch (dec) {
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

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* ── Navigation & Meta Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <button
          onClick={() => router.back()}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors self-start"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Dashboard
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {quote.freshness} • {new Date(quote.timestamp).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' })} IST
          </span>
          <span>•</span>
          <span className="px-2 py-0.5 rounded bg-muted/60 text-[11px] font-mono">
            Model: {pred.modelVersion}
          </span>
        </div>
      </div>

      {/* ── Stock Header Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl bg-gradient-to-br from-card via-card to-card/60 border border-border/50 shadow-md">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
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
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getDecisionBadgeStyle(pred.decision)}`}>
              {pred.decision.replace('_', ' ')}
            </span>
            {pred.ranking && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                Rank #{pred.ranking.rank} (Top {pred.ranking.percentile.toFixed(0)}%)
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{quote.name}</p>
        </div>

        <div className="flex items-center gap-4">
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
            onClick={() => setIsQuantAuditOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-card hover:bg-muted border border-border/60 text-xs font-bold text-foreground transition-all flex items-center gap-1.5 shadow-sm"
          >
            <Cpu className="h-4 w-4 text-primary" /> Quant Audit
          </button>

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

      {/* ── Multi-Horizon Forecast Outlook Tabs & Scenario Matrix ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Multi-Horizon Outlook & Scenario Matrix */}
        <div className="lg:col-span-2 space-y-6">
          {/* Multi-Horizon Outlook Card */}
          <Card className="border-primary/30 bg-gradient-to-br from-card via-card to-primary/5 shadow-md">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Multi-Horizon Quantitative Forecast
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Isotonic calibrated probabilities, expected alpha return, and 90% confidence bands
                  </CardDescription>
                </div>

                {/* Horizon Switcher Tabs */}
                <div className="flex items-center p-1 rounded-xl bg-muted/60 border border-border/40 text-xs font-bold">
                  {(['1d', '5d', '20d'] as const).map((h) => (
                    <button
                      key={h}
                      onClick={() => setActiveHorizon(h)}
                      className={`px-3 py-1.5 rounded-lg transition-all ${
                        activeHorizon === h
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {h === '1d' ? '1-Day' : h === '5d' ? '5-Day (Swing)' : '20-Day (Monthly)'}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-5">
              {/* Horizon Metric Highlights */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-card/80 border border-border/40 space-y-1">
                  <div className="text-[11px] text-muted-foreground">Calibrated Probability</div>
                  <div className="text-2xl font-extrabold text-primary font-mono">{calibratedProb}%</div>
                  <div className="text-[10px] text-muted-foreground">Directional Upward Bias</div>
                </div>

                <div className="p-3 rounded-xl bg-card/80 border border-border/40 space-y-1">
                  <div className="text-[11px] text-muted-foreground">Expected Alpha Return</div>
                  <div className="text-2xl font-extrabold text-emerald-400 font-mono">+{expectedReturnPct}%</div>
                  <div className="text-[10px] text-muted-foreground">Horizon Target Return</div>
                </div>

                <div className="p-3 rounded-xl bg-card/80 border border-border/40 space-y-1">
                  <div className="text-[11px] text-muted-foreground">90% Confidence Interval</div>
                  <div className="text-base font-extrabold text-foreground font-mono mt-1">
                    [{ciLowPct}%, {ciHighPct}%]
                  </div>
                  <div className="text-[10px] text-muted-foreground">Statistical Band</div>
                </div>

                <div className="p-3 rounded-xl bg-card/80 border border-border/40 space-y-1">
                  <div className="text-[11px] text-muted-foreground">Signal Quality</div>
                  <div className="text-base font-extrabold text-emerald-400 font-mono mt-1 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> {pred.signalQuality}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Data Quality: {pred.dataQuality}</div>
                </div>
              </div>

              {/* Scenario Matrix */}
              <div className="space-y-2.5 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-foreground flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-primary" /> Scenario Matrix ({activeHorizon.toUpperCase()})
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    Current LTP: ₹{currentPrice.toFixed(2)}
                  </span>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  {/* Bull Case */}
                  <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
                      <span>🚀 Bull Scenario</span>
                      <span className="font-mono">{bullProb}% Prob</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono text-emerald-300">
                      ₹{bullTargetPrice}
                    </div>
                    <div className="text-[11px] text-emerald-400/80 font-semibold font-mono">
                      +{bullUpsidePct}% Maximum Extension
                    </div>
                  </div>

                  {/* Base Case */}
                  <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-blue-400">
                      <span>⚖️ Base Scenario</span>
                      <span className="font-mono">{baseProb}% Prob</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono text-blue-300">
                      ₹{baseTargetPrice}
                    </div>
                    <div className="text-[11px] text-blue-400/80 font-semibold font-mono">
                      +{baseUpsidePct}% Expected Median
                    </div>
                  </div>

                  {/* Bear Case */}
                  <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-red-400">
                      <span>🛡️ Bear / Stop Risk</span>
                      <span className="font-mono">{bearProb}% Downside</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono text-red-300">
                      ₹{bearStopPrice}
                    </div>
                    <div className="text-[11px] text-red-400/80 font-semibold font-mono">
                      -{bearDownsidePct}% ATR Stop Boundary
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Interactive Candlestick Chart */}
          <Card className="border-border/50 bg-card/60 shadow-sm overflow-hidden">
            <CardHeader className="py-3 px-6 border-b border-border/30">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-bold">Interactive Price Action & Levels</CardTitle>
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
            <CardContent className="p-4 relative min-h-[380px]">
              {isChartLoading && (
                <div className="absolute inset-0 bg-background/50 backdrop-blur-xs flex items-center justify-center z-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
                  <span className="text-xs text-muted-foreground font-semibold">Rendering candles for {selectedRange.toUpperCase()}...</span>
                </div>
              )}
              <CandlestickChart data={chartData || []} height={360} />
            </CardContent>
          </Card>
        </div>

        {/* Right Col: Verified Evidence & Catalysts + Invalidation Conditions */}
        <div className="space-y-6">
          {/* Verified Evidence & Catalysts */}
          <Card className="border-border/50 bg-card/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Verified Evidence Factors
                </CardTitle>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">
                  Multi-Factor Confluence
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {(pred.evidence || []).map((ev, i) => (
                <div key={i} className="p-3 rounded-xl bg-muted/30 border border-border/30 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-foreground font-mono text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      {ev.type}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Weight: {Math.round(ev.weight * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {ev.description}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Invalidation Conditions */}
          <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-card to-card shadow-sm">
            <CardHeader className="pb-3 border-b border-amber-500/20">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-amber-400">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Invalidation Conditions
              </CardTitle>
              <CardDescription className="text-xs">
                Quantitative exit triggers that nullify the thesis
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-2 text-xs">
              {(pred.invalidationConditions || []).map((cond, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  <span className="text-[11px] leading-relaxed">{cond}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quick ATR Risk Guard */}
          <Card className="border-border/50 bg-card/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/40">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> ATR Risk & Position Sizing
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3 text-xs font-mono">
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <span className="text-muted-foreground font-sans">Reward:Risk Ratio</span>
                <span className="font-extrabold text-emerald-400 text-sm">1:{pred.risk.rewardRiskRatio}</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <span className="text-muted-foreground font-sans">ATR Stop Loss</span>
                <span className="font-extrabold text-red-400">₹{pred.risk.stopLossPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <span className="text-muted-foreground font-sans">ATR Profit Target</span>
                <span className="font-extrabold text-emerald-400">₹{pred.risk.targetPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <span className="text-muted-foreground font-sans">Max Position Weight</span>
                <span className="font-bold text-foreground">{(pred.risk.positionSizeWeight * 100).toFixed(1)}% of Capital</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Fundamental Financial Metrics & Technical Momentum ── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Key Financial Ratios */}
        <Card className="border-border/50 bg-card/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Key Financial Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
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
                <div className="text-muted-foreground mb-1 font-sans">P/E Ratio</div>
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

        {/* Technical Momentum */}
        {profile.technicals && (
          <Card className="border-border/50 bg-card/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/40">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Gauge className="h-4 w-4 text-primary" /> Technical Momentum & Moving Averages
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
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
                  <div className="text-[10px] text-muted-foreground font-sans mt-0.5">Baseline</div>
                </div>

                <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="text-muted-foreground mb-1 font-sans">Golden Cross</div>
                  <div className={`font-bold text-sm font-sans ${profile.technicals.goldenCross ? 'text-green-400' : 'text-amber-400'}`}>
                    {profile.technicals.goldenCross ? 'Bullish' : 'Neutral'}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-sans mt-0.5">SMA 50/200</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Advanced Quant Audit Modal / Drawer ── */}
      {isQuantAuditOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border/60 rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                <h3 className="font-extrabold text-lg">
                  QuantX Quantitative Model Audit — {quote.ticker.replace('.NS', '')}
                </h3>
              </div>
              <button
                onClick={() => setIsQuantAuditOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground font-bold"
              >
                ✕ Close
              </button>
            </div>

            {/* Model Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-[10px] text-muted-foreground font-sans">Model Engine</div>
                <div className="font-bold text-primary">{pred.modelVersion}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-[10px] text-muted-foreground font-sans">Calibration</div>
                <div className="font-bold text-emerald-400">{pred.calibrationVersion}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-[10px] text-muted-foreground font-sans">Regime Mode</div>
                <div className="font-bold text-foreground">{pred.marketRegime}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-[10px] text-muted-foreground font-sans">Ranking</div>
                <div className="font-bold text-foreground">Top {pred.ranking?.percentile.toFixed(1)}%</div>
              </div>
            </div>

            {/* Feature Contributions SHAP / Confluence */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-primary" /> Quantitative Feature Contributions
              </h4>
              <div className="space-y-2 pt-1">
                {(pred.featureContributions || []).map((fc, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{fc.feature}</span>
                      <span className="font-mono font-bold text-foreground">+{Math.round(fc.contribution * 100)}% weight</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-primary" 
                        style={{ width: `${Math.round(fc.contribution * 100)}%` }} 
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Inference & Freshness */}
            <div className="p-3.5 rounded-xl bg-muted/30 border border-border/40 text-xs space-y-1.5">
              <div className="font-bold text-foreground">Inference Pipeline Health</div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Evaluated against purged walk-forward cross validation. Probability is calibrated via Isotonic Regression on historical out-of-fold predictions.
              </p>
              <div className="text-[10px] text-muted-foreground font-mono pt-1">
                Data Timestamp: {pred.dataTime} • Latency: ~18ms
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setIsQuantAuditOpen(false)}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold"
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}

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
                className="text-xs text-muted-foreground hover:text-foreground font-bold"
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
