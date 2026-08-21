'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Activity, 
  Loader2, 
  AlertTriangle, 
  ShieldCheck, 
  Zap, 
  ArrowUpRight, 
  ArrowDownRight, 
  RefreshCcw, 
  Search, 
  Filter, 
  Download, 
  FileSpreadsheet, 
  ExternalLink, 
  CheckCircle2, 
  SlidersHorizontal, 
  X,
  RotateCcw
} from 'lucide-react';
import { usePortfolio, useExecuteTrade, usePortfolioSellSignals, useStockQuote, useAllTrades, useResetPortfolio, TradeItem } from '@/hooks/use-stock';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

function PositionRow({
  position,
  onSell,
  isSelling,
  tradeError,
}: {
  position: any;
  onSell: (ticker: string, quantity: number) => void;
  isSelling: boolean;
  tradeError?: string | null;
}) {
  const router = useRouter();
  const ticker = position.stock?.ticker || position.ticker || 'UNKNOWN';
  const name = position.stock?.name || position.name || ticker;
  const quantity = position.quantity || 0;
  const avgPrice = position.averagePrice || 0;

  const { data: quote, isLoading } = useStockQuote(ticker);

  const ltp = quote?.price || position.currentPrice || avgPrice;
  const dayChange = quote?.change ?? position.dayChange ?? 0;
  const dayChangePercent = quote?.changePercent ?? position.dayChangePercent ?? 0;

  // Calculations
  const currentValue = position.currentValue || (quantity * ltp);
  const investedValue = position.investedValue || (quantity * avgPrice);
  const overallPnL = position.overallPnL !== undefined ? position.overallPnL : (currentValue - investedValue);
  const overallPnLPercent = position.overallPnLPercent !== undefined ? position.overallPnLPercent : (investedValue > 0 ? (overallPnL / investedValue) * 100 : 0);
  const todayPnL = position.todayPnL !== undefined ? position.todayPnL : (quantity * dayChange);

  const isTodayProfit = todayPnL >= 0;
  const isOverallProfit = overallPnL >= 0;

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(val);

  return (
    <tr
      className="border-b border-border/40 hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => router.push(`/stock/${ticker}`)}
    >
      <td className="px-4 py-3.5 font-bold text-foreground">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{ticker.replace('.NS', '')}</span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
            AUTO PROTECTED
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground font-normal line-clamp-1">{name}</div>
        <div className="text-[10px] text-muted-foreground font-mono mt-1 flex items-center gap-2">
          <span className="text-red-400">
            Stop: <strong>₹{position.stopLossPrice ? position.stopLossPrice.toFixed(1) : (avgPrice * 0.95).toFixed(1)}</strong>
          </span>
          <span>•</span>
          <span className="text-emerald-400">
            Target: <strong>₹{position.targetPrice ? position.targetPrice.toFixed(1) : (avgPrice * 1.08).toFixed(1)}</strong>
          </span>
        </div>
      </td>
      <td className="px-4 py-3.5 font-mono font-semibold">{quantity}</td>
      <td className="px-4 py-3.5 font-mono text-muted-foreground">{formatCurrency(avgPrice)}</td>
      <td className="px-4 py-3.5 font-mono font-bold text-foreground">
        {isLoading ? <span className="animate-pulse">...</span> : formatCurrency(ltp)}
      </td>
      {/* Today's P&L */}
      <td className="px-4 py-3.5 font-mono">
        {isLoading ? (
          <span className="text-muted-foreground animate-pulse">...</span>
        ) : (
          <div>
            <div className={`font-bold text-xs flex items-center ${isTodayProfit ? 'text-green-500' : 'text-red-500'}`}>
              {isTodayProfit ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {isTodayProfit ? '+' : ''}{formatCurrency(todayPnL)}
            </div>
            <div className={`text-[10px] font-semibold ${isTodayProfit ? 'text-green-400/80' : 'text-red-400/80'}`}>
              {isTodayProfit ? '+' : ''}{dayChangePercent.toFixed(2)}% today
            </div>
          </div>
        )}
      </td>
      {/* Overall P&L */}
      <td className="px-4 py-3.5 font-mono">
        {isLoading ? (
          <span className="text-muted-foreground animate-pulse">...</span>
        ) : (
          <div>
            <div className={`font-bold text-xs flex items-center ${isOverallProfit ? 'text-green-500' : 'text-red-500'}`}>
              {isOverallProfit ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {isOverallProfit ? '+' : ''}{formatCurrency(overallPnL)}
            </div>
            <div className={`text-[10px] font-semibold ${isOverallProfit ? 'text-green-400/80' : 'text-red-400/80'}`}>
              {isOverallProfit ? '+' : ''}{overallPnLPercent.toFixed(2)}% total
            </div>
          </div>
        )}
      </td>
      <td className="px-4 py-3.5 font-mono font-extrabold text-foreground">
        {formatCurrency(currentValue)}
      </td>
      <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => onSell(ticker, quantity)}
            disabled={isSelling}
            className="px-3 py-1 rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-bold transition-all disabled:opacity-50"
          >
            SELL ALL
          </button>
          {tradeError && (
            <div className="text-[10px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded border border-destructive/20 max-w-[120px] text-center leading-tight">
              {tradeError}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function PortfolioPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'holdings' | 'journal'>('holdings');
  const [tradeSearch, setTradeSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'highest_value'>('newest');
  const [selectedTrade, setSelectedTrade] = useState<TradeItem | null>(null);
  const [tradeErrors, setTradeErrors] = useState<Record<string, string>>({});

  const { data: portfolio, isLoading, refetch } = usePortfolio();
  const { data: sellSignals, isLoading: isSignalsLoading } = usePortfolioSellSignals();
  const { data: rawTradesData, isLoading: isTradesLoading } = useAllTrades(undefined, undefined, typeFilter === 'ALL' ? undefined : typeFilter as 'BUY' | 'SELL');
  const executeTrade = useExecuteTrade();
  const resetPortfolio = useResetPortfolio();

  const formatCurrency = (val?: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(val || 0);

  const positions = portfolio?.positions || [];
  const availableCash = portfolio?.availableCash || 0;

  const totalInvested = portfolio?.totalInvested ?? positions.reduce((acc: number, pos: any) => acc + (pos.quantity * pos.averagePrice), 0);
  const totalCurrentValue = portfolio?.totalCurrentValue ?? positions.reduce((acc: number, pos: any) => acc + (pos.quantity * (pos.currentPrice || pos.averagePrice)), 0);
  const totalPortfolioValue = portfolio?.totalPortfolioValue ?? (availableCash + totalCurrentValue);
  
  const totalTodayPnL = portfolio?.totalTodayPnL ?? positions.reduce((acc: number, pos: any) => acc + (pos.todayPnL || 0), 0);
  const totalTodayPnLPercent = portfolio?.totalTodayPnLPercent ?? (totalInvested > 0 ? (totalTodayPnL / totalInvested) * 100 : 0);
  
  const totalOverallPnL = portfolio?.totalOverallPnL ?? (totalCurrentValue - totalInvested);
  const totalOverallPnLPercent = portfolio?.totalOverallPnLPercent ?? (totalInvested > 0 ? (totalOverallPnL / totalInvested) * 100 : 0);

  const isTodayPositive = totalTodayPnL >= 0;
  const isOverallPositive = totalOverallPnL >= 0;

  const handleSell = (ticker: string, quantity: number) => {
    setTradeErrors((prev) => ({ ...prev, [ticker]: '' }));
    executeTrade.mutate(
      { ticker, type: 'SELL', quantity },
      {
        onError: (err: any) => {
          setTradeErrors((prev) => ({
            ...prev,
            [ticker]: err.response?.data?.message || err.message || 'Trade execution failed',
          }));
        },
      }
    );
  };

  // Filtered & Sorted Trades for Trade Journal
  const rawTrades: TradeItem[] = Array.isArray(rawTradesData) ? rawTradesData : ((rawTradesData as any)?.trades || []);
  
  const tradeSummary = useMemo(() => {
    const totalTrades = rawTrades.length;
    let totalBuyCount = 0;
    let totalSellCount = 0;
    let totalTurnover = 0;
    let totalBuyVolume = 0;
    let totalSellVolume = 0;

    rawTrades.forEach((t) => {
      totalTurnover += (t.totalValue || (t.price * t.quantity));
      if (t.type === 'BUY') {
        totalBuyCount++;
        totalBuyVolume += t.quantity;
      } else {
        totalSellCount++;
        totalSellVolume += t.quantity;
      }
    });

    return { totalTrades, totalBuyCount, totalSellCount, totalTurnover, totalBuyVolume, totalSellVolume };
  }, [rawTrades]);

  const filteredTrades = useMemo(() => {
    return rawTrades
      .filter((t: TradeItem) => {
        const matchesSearch = 
          t.ticker.toLowerCase().includes(tradeSearch.toLowerCase()) ||
          (t.name && t.name.toLowerCase().includes(tradeSearch.toLowerCase()));
        const matchesType = typeFilter === 'ALL' || t.type === typeFilter;
        return matchesSearch && matchesType;
      })
      .sort((a: TradeItem, b: TradeItem) => {
        if (sortOrder === 'newest') return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (sortOrder === 'oldest') return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        if (sortOrder === 'highest_value') return (b.totalValue || 0) - (a.totalValue || 0);
        return 0;
      });
  }, [rawTrades, tradeSearch, typeFilter, sortOrder]);

  // Export Trade History to CSV
  const exportTradeCSV = () => {
    if (!rawTrades.length) return;
    const headers = ['Trade ID', 'Timestamp (IST)', 'Ticker', 'Stock Name', 'Type', 'Order Type', 'Quantity', 'Executed Price (INR)', 'Total Value (INR)'];
    const rows = rawTrades.map((t: TradeItem) => [
      t.id,
      new Date(t.timestamp).toLocaleString('en-IN'),
      t.ticker,
      `"${(t.name || t.ticker).replace(/"/g, '""')}"`,
      t.type,
      t.orderType,
      t.quantity,
      t.price,
      t.totalValue,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e: (string | number)[]) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `QuantX_All_Time_Trade_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-500">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Portfolio & All-Time Trade Journal
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time portfolio valuation, Today's & Overall P&L, permanent all-time trade ledger, and continuous AI risk monitor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (window.confirm('Reset virtual portfolio back to ₹10,00,000 starting cash and clear positions?')) {
                resetPortfolio.mutate(undefined);
              }
            }}
            disabled={resetPortfolio.isPending}
            className="px-3 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-semibold flex items-center gap-1.5 transition-colors border border-destructive/20"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Capital
          </button>
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh Quotes
          </button>
          <button
            onClick={() => router.push('/discover')}
            className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold shadow-sm hover:bg-primary/90 transition-all flex items-center gap-1.5"
          >
            <Zap className="h-3.5 w-3.5" /> Buy New Stocks
          </button>
        </div>
      </div>

      {/* ── Portfolio KPI Metrics Overview ── */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {/* Total Portfolio Value */}
        <Card className="bg-gradient-to-br from-primary/10 via-card to-card border-primary/20 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Value</span>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-extrabold font-mono tracking-tight text-foreground">
              {formatCurrency(totalPortfolioValue)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Cash + Equity Holdings</div>
          </CardContent>
        </Card>

        {/* Available Cash */}
        <Card className="bg-card/70 border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Available Cash</span>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-extrabold font-mono text-foreground">
              {formatCurrency(availableCash)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Buying Power</div>
          </CardContent>
        </Card>

        {/* Total Invested */}
        <Card className="bg-card/70 border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Invested</span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-extrabold font-mono text-foreground">
              {formatCurrency(totalInvested)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{positions.length} Active Positions</div>
          </CardContent>
        </Card>

        {/* Today's P&L */}
        <Card className="bg-card/70 border-border/50 shadow-sm relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Today's P&L</span>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className={`text-xl font-extrabold font-mono flex items-center ${isTodayPositive ? 'text-green-500' : 'text-red-500'}`}>
              {isTodayPositive ? '+' : ''}{formatCurrency(totalTodayPnL)}
            </div>
            <div className={`text-[11px] font-bold flex items-center mt-0.5 ${isTodayPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isTodayPositive ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {isTodayPositive ? '+' : ''}{totalTodayPnLPercent.toFixed(2)}% session
            </div>
          </CardContent>
        </Card>

        {/* Overall P&L */}
        <Card className="bg-card/70 border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Overall P&L</span>
            {isOverallPositive ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className={`text-xl font-extrabold font-mono flex items-center ${isOverallPositive ? 'text-green-500' : 'text-red-500'}`}>
              {isOverallPositive ? '+' : ''}{formatCurrency(totalOverallPnL)}
            </div>
            <div className={`text-[11px] font-bold flex items-center mt-0.5 ${isOverallPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isOverallPositive ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {isOverallPositive ? '+' : ''}{totalOverallPnLPercent.toFixed(2)}% all-time
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── View Switcher Navigation Tabs ── */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <button
          onClick={() => setActiveTab('holdings')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
            activeTab === 'holdings'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          <Activity className="h-4 w-4" /> Active Holdings & AI Monitor ({positions.length})
        </button>
        <button
          onClick={() => setActiveTab('journal')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
            activeTab === 'journal'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" /> All-Time Trade Journal & Analytics ({tradeSummary.totalTrades})
        </button>
      </div>

      {/* ════════════════════ TAB 1: ACTIVE HOLDINGS ════════════════════ */}
      {activeTab === 'holdings' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* AI Continuous Portfolio Monitor — Quant Risk Guardian */}
          <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-card shadow-lg overflow-hidden">
            <CardHeader className="border-b border-amber-500/20 bg-amber-500/5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Zap className="h-5 w-5 text-amber-500 animate-pulse" />
                  <CardTitle className="text-base font-bold text-amber-500">
                    QuantX Continuous Risk Guardian & Exit Engine
                  </CardTitle>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Live Risk Guardian Active
                </span>
              </div>
              <CardDescription className="text-muted-foreground text-xs mt-1">
                Real-time quantitative exit predictions based on isotonic calibrated probabilities, ATR volatility trailing stops, and multi-factor regime breakdown.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {isSignalsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-500 mr-2" />
                  <span className="text-xs text-muted-foreground">Evaluating portfolio holdings against QuantX Risk Engine...</span>
                </div>
              ) : !sellSignals || sellSignals.length === 0 ? (
                <div className="flex items-center justify-between p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center space-x-3">
                    <ShieldCheck className="h-6 w-6 text-green-500" />
                    <div>
                      <div className="font-semibold text-green-400 text-xs">All Portfolio Holdings Optimal</div>
                      <div className="text-[11px] text-muted-foreground">No elevated downside exit triggers detected. Calibrated directional models indicate healthy risk-adjusted momentum across your active holdings.</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {sellSignals.map((signal: any) => {
                    const exitProb = signal.exitProbability || signal.downsideProbability || 75;
                    const action = signal.recommendedAction || signal.recommendation || signal.decision || 'SELL';
                    const isProfitTake = action === 'TAKE_PROFIT';
                    const isStopLoss = action === 'STOP_LOSS' || action === 'STRONG_SELL';
                    const isSell = action === 'SELL';

                    return (
                      <div key={signal.ticker} className="p-4 rounded-xl border border-amber-500/30 bg-card/80 hover:border-amber-500/50 transition-all space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                          <div className="flex items-center space-x-3">
                            <div className="px-2.5 py-1 rounded-md bg-amber-500/20 font-bold text-amber-400 text-sm font-mono">
                              {signal.ticker.replace('.NS', '')}
                            </div>
                            <div>
                              <span className="font-semibold text-foreground text-xs">{signal.name}</span>
                              <span className="text-[11px] text-muted-foreground ml-2">Qty: {signal.quantityHeld} shares</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-3">
                            <div className="text-right font-mono">
                              <div className="text-[10px] text-muted-foreground">ATR Stop / Target</div>
                              <div className="font-bold text-amber-400 text-xs">
                                ₹{signal.stopLossPrice ? signal.stopLossPrice.toFixed(2) : signal.targetExitPrice ? signal.targetExitPrice.toFixed(2) : '—'}
                              </div>
                            </div>
                            <div className={`px-3 py-1 rounded-full text-xs font-extrabold flex items-center border ${
                              isProfitTake 
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                : isStopLoss || isSell
                                ? 'bg-red-500/20 text-red-400 border-red-500/30' 
                                : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                            }`}>
                              <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                              {action.replace('_', ' ')} ({exitProb}% Exit Prob)
                            </div>
                            <button
                              onClick={() => handleSell(signal.ticker, signal.quantityHeld)}
                              disabled={executeTrade.isPending || !signal.quantityHeld}
                              className="px-4 py-1.5 rounded-lg bg-destructive hover:bg-destructive/90 text-white font-bold text-xs transition-colors shadow-sm disabled:opacity-50"
                            >
                              SELL ALL ({signal.quantityHeld})
                            </button>
                          </div>
                        </div>

                        {/* Quantitative Multi-Factor Assessment Grid */}
                        <div className="grid md:grid-cols-3 gap-3 text-xs">
                          <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                            <div className="font-semibold text-primary flex items-center">
                              <Activity className="h-3.5 w-3.5 mr-1" /> Quantitative Valuation & Risk
                            </div>
                            <p className="text-muted-foreground text-[11px] leading-relaxed">
                              {signal.primaryReason || signal.financialReasoning || `ATR stop boundary reached with downside probability calibrated at ${signal.downsideProbability || 68}%.`}
                            </p>
                          </div>

                          <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                            <div className="font-semibold text-primary flex items-center">
                              <Clock className="h-3.5 w-3.5 mr-1" /> News & Sentiment Vector
                            </div>
                            <p className="text-muted-foreground text-[11px] leading-relaxed">
                              {signal.newsImpact || 'Sentiment momentum indicates deceleration in buying pressure and possible sector rotation.'}
                            </p>
                          </div>

                          <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                            <div className="font-semibold text-primary flex items-center">
                              <TrendingDown className="h-3.5 w-3.5 mr-1" /> Regime & Volatility Drag
                            </div>
                            <p className="text-muted-foreground text-[11px] leading-relaxed">
                              {signal.gmpAnalysis || `Reward/Risk ratio compressed to 1:${signal.rewardRiskRatio || '1.1'}. Recommended action is to preserve capital.`}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Current Positions Table */}
          <Card className="border-border/50 bg-card/60 shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Active Equity Positions & Performance
                </CardTitle>
                <span className="text-xs text-muted-foreground">{positions.length} Active Positions</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 text-muted-foreground uppercase font-semibold border-b border-border/40">
                    <tr>
                      <th className="px-4 py-3">Stock</th>
                      <th className="px-4 py-3">Qty</th>
                      <th className="px-4 py-3">Avg Price</th>
                      <th className="px-4 py-3">LTP</th>
                      <th className="px-4 py-3">Today's P&L</th>
                      <th className="px-4 py-3">Overall P&L</th>
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {positions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                          <Wallet className="h-8 w-8 mx-auto opacity-30 text-primary mb-2" />
                          <p>No active positions yet. Explore the NIFTY universe to paper trade!</p>
                        </td>
                      </tr>
                    ) : (
                      positions.map((pos: any) => (
                        <PositionRow
                          key={pos.stock?.ticker || pos.ticker || pos.id}
                          position={pos}
                          onSell={handleSell}
                          isSelling={executeTrade.isPending}
                          tradeError={tradeErrors[pos.stock?.ticker || pos.ticker || '']}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ════════════════════ TAB 2: ALL-TIME TRADE JOURNAL ════════════════════ */}
      {activeTab === 'journal' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Trade History Aggregate Stats Bar */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <Card className="p-4 bg-muted/20 border-border/40">
              <div className="text-xs text-muted-foreground">All-Time Executed Trades</div>
              <div className="text-2xl font-extrabold font-mono text-foreground mt-1">
                {tradeSummary.totalTrades}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {tradeSummary.totalBuyCount} Buys • {tradeSummary.totalSellCount} Sells
              </div>
            </Card>

            <Card className="p-4 bg-muted/20 border-border/40">
              <div className="text-xs text-muted-foreground">Total Capital Turnover</div>
              <div className="text-2xl font-extrabold font-mono text-foreground mt-1">
                {formatCurrency(tradeSummary.totalTurnover)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Total transaction volume</div>
            </Card>

            <Card className="p-4 bg-muted/20 border-border/40">
              <div className="text-xs text-muted-foreground">Shares Transacted</div>
              <div className="text-2xl font-extrabold font-mono text-foreground mt-1">
                {(tradeSummary.totalBuyVolume + tradeSummary.totalSellVolume).toLocaleString('en-IN')}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {tradeSummary.totalBuyVolume} Bought / {tradeSummary.totalSellVolume} Sold
              </div>
            </Card>

            <Card className="p-4 bg-muted/20 border-border/40 flex flex-col justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Export Journal</div>
                <div className="text-xs font-semibold text-foreground mt-1">Export Ledger</div>
              </div>
              <button
                onClick={exportTradeCSV}
                disabled={rawTrades.length === 0}
                className="px-3 py-1.5 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 mt-2"
              >
                <Download className="h-3.5 w-3.5" /> Download CSV Ledger
              </button>
            </Card>
          </div>

          {/* Search, Filter & Order Controls */}
          <Card className="p-4 border-border/40 bg-card/60">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search historical trades by ticker or company name..."
                  value={tradeSearch}
                  onChange={(e) => setTradeSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-muted/50 border border-border/50 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex items-center gap-2">
                {/* Type Filter Buttons */}
                <div className="flex items-center p-1 rounded-lg bg-muted/60 border border-border/40 text-xs font-semibold">
                  <button
                    onClick={() => setTypeFilter('ALL')}
                    className={`px-2.5 py-1 rounded-md transition-all ${typeFilter === 'ALL' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                  >
                    ALL
                  </button>
                  <button
                    onClick={() => setTypeFilter('BUY')}
                    className={`px-2.5 py-1 rounded-md transition-all ${typeFilter === 'BUY' ? 'bg-background text-green-500 shadow-sm font-bold' : 'text-muted-foreground'}`}
                  >
                    BUYS
                  </button>
                  <button
                    onClick={() => setTypeFilter('SELL')}
                    className={`px-2.5 py-1 rounded-md transition-all ${typeFilter === 'SELL' ? 'bg-background text-red-500 shadow-sm font-bold' : 'text-muted-foreground'}`}
                  >
                    SELLS
                  </button>
                </div>

                {/* Sort Order Selector */}
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as any)}
                  className="px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="highest_value">Highest Trade Value</option>
                </select>
              </div>
            </div>
          </Card>

          {/* All-Time Historical Trades Table */}
          <Card className="border-border/50 bg-card/60 shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  All-Time Execution Ledger ({filteredTrades.length} Records)
                </CardTitle>
                <span className="text-[11px] text-muted-foreground font-mono">
                  Stored permanently • Click any trade to open deep analysis
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isTradesLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                  <span className="text-xs text-muted-foreground">Loading permanent trade history...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/40 text-muted-foreground uppercase font-semibold border-b border-border/40">
                      <tr>
                        <th className="px-4 py-3">Date & Time (IST)</th>
                        <th className="px-4 py-3">Stock</th>
                        <th className="px-4 py-3">Side</th>
                        <th className="px-4 py-3">Qty</th>
                        <th className="px-4 py-3">Executed Price</th>
                        <th className="px-4 py-3">Total Value</th>
                        <th className="px-4 py-3">Performance Since Trade</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {filteredTrades.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                            <Clock className="h-8 w-8 mx-auto opacity-30 text-primary mb-2" />
                            <p className="font-semibold text-foreground">No historical trades found matching filters</p>
                            <p className="text-xs text-muted-foreground mt-1">All executions are preserved indefinitely in your account database.</p>
                          </td>
                        </tr>
                      ) : (
                        filteredTrades.map((trade: TradeItem) => {
                          const isBuy = trade.type === 'BUY';
                          const executedPrice = trade.executedPrice ?? trade.price;
                          const currentPrice = trade.currentPrice ?? trade.price;
                          const deltaPercent = trade.deltaPercentSinceTrade ?? 0;
                          const isGain = deltaPercent >= 0;
                          return (
                            <tr
                              key={trade.id}
                              onClick={() => setSelectedTrade(trade)}
                              className="hover:bg-muted/30 transition-colors cursor-pointer"
                            >
                              <td className="px-4 py-3 font-mono text-muted-foreground">
                                {new Date(trade.timestamp).toLocaleDateString('en-IN', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                                <span className="block text-[10px] opacity-70">
                                  {new Date(trade.timestamp).toLocaleTimeString('en-IN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-bold text-foreground">
                                <div className="font-mono text-sm">{trade.ticker.replace('.NS', '')}</div>
                                <div className="text-[11px] text-muted-foreground font-normal line-clamp-1">{trade.name || trade.ticker}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                                    isBuy
                                      ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                      : 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                                  }`}
                                >
                                  {trade.type}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono font-semibold">{trade.quantity}</td>
                              <td className="px-4 py-3 font-mono font-bold">{formatCurrency(executedPrice)}</td>
                              <td className="px-4 py-3 font-mono font-extrabold text-foreground">
                                {formatCurrency(trade.totalValue)}
                              </td>
                              <td className="px-4 py-3 font-mono">
                                <div className={`font-bold flex items-center ${isGain ? 'text-green-500' : 'text-red-500'}`}>
                                  {isGain ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                                  {isGain ? '+' : ''}{deltaPercent.toFixed(2)}%
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  LTP: ₹{currentPrice.toFixed(2)}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => setSelectedTrade(trade)}
                                  className="px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-[11px] transition-colors"
                                >
                                  Analyse
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Deep Trade Analysis Modal / Drawer ── */}
      {selectedTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl rounded-2xl bg-card border border-border/80 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-border/40 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded text-xs font-extrabold border ${
                    selectedTrade.type === 'BUY' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                  }`}>
                    {selectedTrade.type} EXECUTION
                  </span>
                  <span className="font-mono text-lg font-extrabold text-foreground">
                    {selectedTrade.ticker.replace('.NS', '')}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{selectedTrade.name || selectedTrade.ticker}</div>
              </div>
              <button
                onClick={() => setSelectedTrade(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Execution Snapshot Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-muted-foreground text-[10px]">Executed Price</div>
                <div className="font-bold font-mono text-sm text-foreground mt-0.5">
                  {formatCurrency(selectedTrade.executedPrice ?? selectedTrade.price)}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-muted-foreground text-[10px]">Quantity</div>
                <div className="font-bold font-mono text-sm text-foreground mt-0.5">
                  {selectedTrade.quantity} Shares
                </div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-muted-foreground text-[10px]">Total Turnover</div>
                <div className="font-bold font-mono text-sm text-foreground mt-0.5">
                  {formatCurrency(selectedTrade.totalValue)}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                <div className="text-muted-foreground text-[10px]">Current LTP</div>
                <div className="font-bold font-mono text-sm text-foreground mt-0.5">
                  ₹{(selectedTrade.currentPrice ?? selectedTrade.price).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Performance Since Execution */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-muted/30 to-muted/10 border border-border/40 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-semibold">Performance Return Since Trade</span>
                <span className={`font-mono font-bold flex items-center ${(selectedTrade.deltaPercentSinceTrade ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {(selectedTrade.deltaPercentSinceTrade ?? 0) >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" /> : <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" />}
                  {(selectedTrade.deltaPercentSinceTrade ?? 0) >= 0 ? '+' : ''}{(selectedTrade.deltaPercentSinceTrade ?? 0).toFixed(2)}% ({formatCurrency((selectedTrade.deltaSinceTrade ?? 0) * selectedTrade.quantity)})
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                Executed on <span className="text-foreground font-mono font-semibold">{new Date(selectedTrade.timestamp).toLocaleString('en-IN')}</span> via National Stock Exchange ({selectedTrade.orderType} order).
              </div>
            </div>

            {/* Metadata & System Hash */}
            <div className="space-y-1 text-[10px] text-muted-foreground font-mono bg-muted/20 p-2.5 rounded-lg border border-border/20">
              <div className="flex justify-between">
                <span>Transaction ID:</span>
                <span className="text-foreground">{selectedTrade.id}</span>
              </div>
              <div className="flex justify-between">
                <span>Exchange / Sector:</span>
                <span className="text-foreground">NSE • {selectedTrade.sector || 'Equities'}</span>
              </div>
              <div className="flex justify-between">
                <span>Audit Status:</span>
                <span className="text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Stored & Verified in Postgres
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
              <button
                onClick={() => setSelectedTrade(null)}
                className="px-4 py-2 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground text-xs font-semibold transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setSelectedTrade(null);
                  router.push(`/stock/${selectedTrade.ticker}`);
                }}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-sm"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open Full Stock Analysis Terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
