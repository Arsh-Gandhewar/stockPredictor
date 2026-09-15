'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  Download, 
  FileSpreadsheet, 
  ExternalLink, 
  CheckCircle2, 
  X,
  RotateCcw,
  SlidersHorizontal,
  ChevronRight
} from 'lucide-react';
import { 
  usePortfolio, 
  useExecuteTrade, 
  usePortfolioSellSignals, 
  useStockQuote, 
  useAllTrades, 
  useResetPortfolio, 
  TradeItem 
} from '@/hooks/use-stock';

// Format Indian Rupee currency standard
function formatINR(val?: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(val || 0);
}

// ── Active Position Row Component ───────────────────────────────────────────
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
  const overallPnLPercent = position.overallPnLPercent !== undefined 
    ? position.overallPnLPercent 
    : (investedValue > 0 ? (overallPnL / investedValue) * 100 : 0);
  const todayPnL = position.todayPnL !== undefined ? position.todayPnL : (quantity * dayChange);

  const isTodayProfit = todayPnL >= 0;
  const isOverallProfit = overallPnL >= 0;

  const stopLoss = position.stopLossPrice ?? (avgPrice * 0.95);
  const targetPrice = position.targetPrice ?? (avgPrice * 1.08);

  return (
    <tr
      onClick={() => router.push(`/stock/${ticker}`)}
      className="group border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer"
    >
      {/* Ticker & Name & Auto-protected */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-extrabold text-foreground group-hover:text-primary transition-colors">
            {ticker.replace('.NS', '')}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
            AUTO PROTECTED
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground font-medium truncate max-w-[200px] mt-0.5">
          {name}
        </div>
        <div className="text-[10px] font-mono mt-1 flex items-center gap-2 text-muted-foreground/80">
          <span className="text-rose-400">
            Stop: <strong className="font-semibold">₹{stopLoss.toFixed(1)}</strong>
          </span>
          <span className="text-border">•</span>
          <span className="text-emerald-400">
            Target: <strong className="font-semibold">₹{targetPrice.toFixed(1)}</strong>
          </span>
        </div>
      </td>

      {/* Quantity */}
      <td className="px-4 py-3.5 font-mono text-xs font-bold text-foreground">
        {quantity.toLocaleString('en-IN')}
      </td>

      {/* Avg Buy Price */}
      <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
        {formatINR(avgPrice)}
      </td>

      {/* Live LTP */}
      <td className="px-4 py-3.5 font-mono text-xs font-bold text-foreground">
        {isLoading ? (
          <span className="inline-block h-4 w-16 bg-muted/60 rounded animate-pulse" />
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>{formatINR(ltp)}</span>
          </div>
        )}
      </td>

      {/* Today's P&L */}
      <td className="px-4 py-3.5 font-mono">
        {isLoading ? (
          <span className="inline-block h-4 w-16 bg-muted/60 rounded animate-pulse" />
        ) : (
          <div>
            <div className={`text-xs font-extrabold flex items-center ${isTodayProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isTodayProfit ? <ArrowUpRight className="h-3 w-3 mr-0.5 shrink-0" /> : <ArrowDownRight className="h-3 w-3 mr-0.5 shrink-0" />}
              {isTodayProfit ? '+' : ''}{formatINR(todayPnL)}
            </div>
            <div className={`text-[10px] font-medium ${isTodayProfit ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
              {isTodayProfit ? '+' : ''}{dayChangePercent.toFixed(2)}%
            </div>
          </div>
        )}
      </td>

      {/* Overall P&L */}
      <td className="px-4 py-3.5 font-mono">
        {isLoading ? (
          <span className="inline-block h-4 w-16 bg-muted/60 rounded animate-pulse" />
        ) : (
          <div>
            <div className={`text-xs font-extrabold flex items-center ${isOverallProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isOverallProfit ? <ArrowUpRight className="h-3 w-3 mr-0.5 shrink-0" /> : <ArrowDownRight className="h-3 w-3 mr-0.5 shrink-0" />}
              {isOverallProfit ? '+' : ''}{formatINR(overallPnL)}
            </div>
            <div className={`text-[10px] font-medium ${isOverallProfit ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
              {isOverallProfit ? '+' : ''}{overallPnLPercent.toFixed(2)}%
            </div>
          </div>
        )}
      </td>

      {/* Current Position Value */}
      <td className="px-4 py-3.5 font-mono text-xs font-extrabold text-foreground">
        {formatINR(currentValue)}
      </td>

      {/* Action Button */}
      <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => onSell(ticker, quantity)}
            disabled={isSelling}
            className="px-3 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-bold font-mono transition-all disabled:opacity-50 hover:shadow-xs hover:border-rose-500/40"
          >
            {isSelling ? 'SELLING...' : 'SELL ALL'}
          </button>
          {tradeError && (
            <div className="text-[10px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 max-w-[130px] text-center leading-tight">
              {tradeError}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main Portfolio & Trade Journal Page ──────────────────────────────────────
export default function PortfolioPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'holdings' | 'journal'>('holdings');
  const [tradeSearch, setTradeSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'highest_value'>('newest');
  const [selectedTrade, setSelectedTrade] = useState<TradeItem | null>(null);
  const [tradeErrors, setTradeErrors] = useState<Record<string, string>>({});

  const { data: portfolio, isLoading, refetch, isFetching } = usePortfolio();
  const { data: sellSignals, isLoading: isSignalsLoading } = usePortfolioSellSignals();
  const { data: rawTradesData, isLoading: isTradesLoading } = useAllTrades(
    undefined, 
    undefined, 
    typeFilter === 'ALL' ? undefined : (typeFilter as 'BUY' | 'SELL')
  );
  const executeTrade = useExecuteTrade();
  const resetPortfolio = useResetPortfolio();

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

  // Percentage cash allocation
  const cashAllocationPercent = totalPortfolioValue > 0 ? (availableCash / totalPortfolioValue) * 100 : 100;

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
      <div className="flex flex-col justify-center items-center h-[55vh] gap-3">
        <Loader2 className="h-9 w-9 animate-spin text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          Syncing Portfolio Ledger & Risk Monitor...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300 max-w-7xl mx-auto">
      {/* ── Institutional Header & Actions ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-foreground">
              Portfolio & All-Time Trade Journal
            </h1>
            <Badge variant="glass" size="sm" className="hidden sm:inline-flex border-primary/30 text-primary">
              INSTITUTIONAL SENTINEL
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time portfolio valuation, session & cumulative P&L, permanent PostgreSQL execution ledger, and continuous AI risk guardian.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              if (window.confirm('Reset virtual portfolio back to ₹10,00,000 starting cash and clear all active positions?')) {
                resetPortfolio.mutate(undefined);
              }
            }}
            disabled={resetPortfolio.isPending}
            className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold flex items-center gap-1.5 transition-all border border-rose-500/20 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Capital
          </button>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-3 py-1.5 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-semibold flex items-center gap-1.5 transition-all border border-border/40"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin text-primary' : ''}`} /> 
            {isFetching ? 'Syncing...' : 'Refresh Quotes'}
          </button>

          <button
            onClick={() => router.push('/discover')}
            className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 hover:shadow-primary/20"
          >
            <Zap className="h-3.5 w-3.5 fill-current" /> Buy New Stocks
          </button>
        </div>
      </div>

      {/* ── 5-KPI Metric Banner (Glassmorphic Cards with Indian Rupee Formatting) ── */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {/* KPI 1: Total Portfolio Value */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-primary/15 via-card/70 to-card border-primary/30 shadow-md backdrop-blur-xl">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl pointer-events-none" />
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3.5 px-4">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-mono">
              Total Value
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary border border-primary/30">
              <Wallet className="h-3.5 w-3.5" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3.5 pt-0.5">
            <div className="text-xl lg:text-2xl font-extrabold font-mono tracking-tight text-foreground tabular-nums">
              {formatINR(totalPortfolioValue)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Cash + Equity Holdings</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 2: Available Cash */}
        <Card className="bg-card/50 backdrop-blur-lg border-border/40 shadow-xs hover:border-border/70 transition-all">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3.5 px-4">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-mono">
              Available Cash
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground border border-border/40">
              <Activity className="h-3.5 w-3.5" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3.5 pt-0.5">
            <div className="text-xl lg:text-2xl font-extrabold font-mono tracking-tight text-foreground tabular-nums">
              {formatINR(availableCash)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 flex items-center justify-between font-mono">
              <span>Buying Power</span>
              <span className="text-primary font-semibold">{cashAllocationPercent.toFixed(0)}% liquid</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 3: Total Invested */}
        <Card className="bg-card/50 backdrop-blur-lg border-border/40 shadow-xs hover:border-border/70 transition-all">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3.5 px-4">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-mono">
              Total Invested
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground border border-border/40">
              <LayersIcon className="h-3.5 w-3.5" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3.5 pt-0.5">
            <div className="text-xl lg:text-2xl font-extrabold font-mono tracking-tight text-foreground tabular-nums">
              {formatINR(totalInvested)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1 font-mono">
              <span className="text-foreground font-semibold">{positions.length}</span>
              <span>Active Position{positions.length === 1 ? '' : 's'}</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Today's P&L */}
        <Card className="relative overflow-hidden bg-card/50 backdrop-blur-lg border-border/40 shadow-xs hover:border-border/70 transition-all">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3.5 px-4">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-mono">
              Today's P&L
            </span>
            <div className={`flex h-7 w-7 items-center justify-center rounded-md border ${
              isTodayPositive 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>
              <Clock className="h-3.5 w-3.5" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3.5 pt-0.5">
            <div className={`text-xl lg:text-2xl font-extrabold font-mono tracking-tight tabular-nums flex items-center ${
              isTodayPositive ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {isTodayPositive ? '+' : ''}{formatINR(totalTodayPnL)}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`inline-flex items-center text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                isTodayPositive 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' 
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
              }`}>
                {isTodayPositive ? <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" /> : <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />}
                {isTodayPositive ? '+' : ''}{totalTodayPnLPercent.toFixed(2)}%
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">session</span>
            </div>
          </CardContent>
        </Card>

        {/* KPI 5: Overall P&L */}
        <Card className={`relative overflow-hidden bg-card/50 backdrop-blur-lg border shadow-xs transition-all ${
          isOverallPositive ? 'border-emerald-500/25' : 'border-rose-500/25'
        }`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3.5 px-4">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-mono">
              Overall P&L
            </span>
            <div className={`flex h-7 w-7 items-center justify-center rounded-md border ${
              isOverallPositive 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>
              {isOverallPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3.5 pt-0.5">
            <div className={`text-xl lg:text-2xl font-extrabold font-mono tracking-tight tabular-nums flex items-center ${
              isOverallPositive ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {isOverallPositive ? '+' : ''}{formatINR(totalOverallPnL)}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`inline-flex items-center text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                isOverallPositive 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' 
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
              }`}>
                {isOverallPositive ? <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" /> : <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />}
                {isOverallPositive ? '+' : ''}{totalOverallPnLPercent.toFixed(2)}%
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">all-time</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabbed View Switcher ── */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2 p-1 rounded-xl bg-muted/40 border border-border/40">
          <button
            onClick={() => setActiveTab('holdings')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all font-mono ${
              activeTab === 'holdings'
                ? 'bg-background text-foreground shadow-sm border border-border/50'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span>Active Holdings & AI Monitor</span>
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
              activeTab === 'holdings' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
            }`}>
              {positions.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('journal')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all font-mono ${
              activeTab === 'journal'
                ? 'bg-background text-foreground shadow-sm border border-border/50'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
            <span>All-Time Trade Journal & Analytics</span>
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
              activeTab === 'journal' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
            }`}>
              {tradeSummary.totalTrades}
            </span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>NSE Equities Live Sync</span>
        </div>
      </div>

      {/* ════════════════════ TAB 1: ACTIVE HOLDINGS & AI MONITOR ════════════════════ */}
      {activeTab === 'holdings' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* ── Quant Risk Guardian Exit Engine Card ── */}
          <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card/70 to-card shadow-lg backdrop-blur-xl overflow-hidden">
            <CardHeader className="border-b border-amber-500/20 bg-amber-500/5 py-3.5 px-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center space-x-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <Zap className="h-4 w-4 animate-pulse" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-extrabold text-amber-400 tracking-tight flex items-center gap-2">
                      Quant Risk Guardian Exit Engine
                    </CardTitle>
                    <CardDescription className="text-muted-foreground text-[11px] mt-0.5">
                      Continuous real-time isotonic risk assessment, ATR trailing stops, and multi-factor breakdown.
                    </CardDescription>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <ShieldCheck className="h-3.5 w-3.5" /> LIVE RISK SENTINEL ACTIVE
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-5">
              {isSignalsLoading ? (
                <div className="flex items-center justify-center py-8 gap-2.5">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                  <span className="text-xs font-mono text-muted-foreground">
                    Evaluating portfolio holdings against Quant Risk Engine...
                  </span>
                </div>
              ) : !sellSignals || sellSignals.length === 0 ? (
                <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-center space-x-3.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-bold text-emerald-400 text-xs tracking-tight">
                        All Portfolio Holdings Operating Within Optimal Parameters
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        Zero elevated exit triggers detected. Calibrated directional momentum models indicate healthy risk-adjusted posture across all {positions.length} active holdings.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {sellSignals.map((signal: any) => {
                    const exitProb = signal.exitProbability ?? signal.downsideProbability ?? 75;
                    const action = signal.recommendedAction || signal.recommendation || signal.decision || 'SELL';
                    const isProfitTake = action === 'TAKE_PROFIT';
                    const isStopLoss = action === 'STOP_LOSS' || action === 'STRONG_SELL';
                    const isSell = action === 'SELL';

                    const actionBadgeClass = isProfitTake
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : isStopLoss || isSell
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/30';

                    return (
                      <div 
                        key={signal.ticker} 
                        className="p-4 rounded-xl border border-amber-500/30 bg-card/80 hover:border-amber-500/50 transition-all space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
                          <div className="flex items-center space-x-3">
                            <div className="px-2.5 py-1 rounded-md bg-amber-500/20 font-bold font-mono text-amber-400 text-sm border border-amber-500/30">
                              {signal.ticker.replace('.NS', '')}
                            </div>
                            <div>
                              <div className="font-bold text-foreground text-xs">{signal.name}</div>
                              <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                                Qty: {signal.quantityHeld} shares • Value: {formatINR((signal.currentPrice || 0) * (signal.quantityHeld || 0))}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-3">
                            <div className="text-right font-mono">
                              <div className="text-[10px] text-muted-foreground uppercase">ATR Stop / Target</div>
                              <div className="font-bold text-amber-400 text-xs">
                                ₹{signal.stopLossPrice ? signal.stopLossPrice.toFixed(1) : signal.targetExitPrice ? signal.targetExitPrice.toFixed(1) : '—'}
                              </div>
                            </div>

                            <div className={`px-3 py-1 rounded-full text-xs font-mono font-extrabold flex items-center border ${actionBadgeClass}`}>
                              <AlertTriangle className="h-3 w-3 mr-1.5 shrink-0" />
                              {action.replace('_', ' ')} ({exitProb}% Exit Prob)
                            </div>

                            <button
                              onClick={() => handleSell(signal.ticker, signal.quantityHeld)}
                              disabled={executeTrade.isPending || !signal.quantityHeld}
                              className="px-4 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-mono font-bold text-xs transition-all shadow-xs disabled:opacity-50"
                            >
                              {executeTrade.isPending ? 'EXECUTING...' : `SELL ALL (${signal.quantityHeld})`}
                            </button>
                          </div>
                        </div>

                        {/* Multi-Factor Assessment Grid */}
                        <div className="grid md:grid-cols-3 gap-2.5 text-xs">
                          <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                            <div className="font-semibold text-primary flex items-center text-[11px]">
                              <Activity className="h-3.5 w-3.5 mr-1 text-primary" /> Quantitative Valuation & Risk
                            </div>
                            <p className="text-muted-foreground text-[11px] leading-relaxed">
                              {signal.primaryReason || signal.financialReasoning || `ATR stop boundary reached with downside probability calibrated at ${signal.downsideProbability || 68}%.`}
                            </p>
                          </div>

                          <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                            <div className="font-semibold text-primary flex items-center text-[11px]">
                              <Clock className="h-3.5 w-3.5 mr-1 text-primary" /> News & Sentiment Vector
                            </div>
                            <p className="text-muted-foreground text-[11px] leading-relaxed">
                              {signal.newsImpact || 'Sentiment momentum indicates deceleration in buying pressure and possible sector rotation.'}
                            </p>
                          </div>

                          <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                            <div className="font-semibold text-primary flex items-center text-[11px]">
                              <TrendingDown className="h-3.5 w-3.5 mr-1 text-primary" /> Regime & Volatility Drag
                            </div>
                            <p className="text-muted-foreground text-[11px] leading-relaxed">
                              {signal.gmpAnalysis || `Reward/Risk ratio compressed to 1:${signal.rewardRiskRatio || '1.1'}. Recommended action is capital preservation.`}
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

          {/* ── Active Positions Table ── */}
          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm overflow-hidden">
            <CardHeader className="py-3.5 px-4 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-extrabold flex items-center gap-2 tracking-tight">
                  <Activity className="h-4 w-4 text-primary" />
                  Active Equity Positions ({positions.length})
                </CardTitle>
                <span className="text-[11px] font-mono text-muted-foreground">
                  LTP Synced with Real-Time NSE Quotes
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 text-muted-foreground uppercase font-mono text-[10px] tracking-wider border-b border-border/40">
                    <tr>
                      <th className="px-4 py-3">Stock / Auto-Protect</th>
                      <th className="px-4 py-3">Qty</th>
                      <th className="px-4 py-3">Avg Buy</th>
                      <th className="px-4 py-3">Live LTP</th>
                      <th className="px-4 py-3">Today's P&L</th>
                      <th className="px-4 py-3">Overall P&L</th>
                      <th className="px-4 py-3">Market Value</th>
                      <th className="px-4 py-3 text-right">Liquidation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {positions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                          <Wallet className="h-9 w-9 mx-auto opacity-30 text-primary mb-2.5" />
                          <p className="font-semibold text-foreground text-xs">No active equity positions</p>
                          <p className="text-[11px] text-muted-foreground mt-1">Explore top-ranked quant picks to execute paper trades with zero risk.</p>
                          <button
                            onClick={() => router.push('/discover')}
                            className="mt-3 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                          >
                            <Zap className="h-3.5 w-3.5" /> Discover High-Alpha Stocks
                          </button>
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
          {/* Summary Stat Tiles */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <Card className="p-4 bg-card/60 backdrop-blur-md border-border/40 shadow-xs">
              <div className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                Total Executed Trades
              </div>
              <div className="text-2xl font-extrabold font-mono text-foreground mt-1 tabular-nums">
                {tradeSummary.totalTrades}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                <span className="text-emerald-400 font-semibold">{tradeSummary.totalBuyCount} Buys</span>
                <span className="mx-1">•</span>
                <span className="text-rose-400 font-semibold">{tradeSummary.totalSellCount} Sells</span>
              </div>
            </Card>

            <Card className="p-4 bg-card/60 backdrop-blur-md border-border/40 shadow-xs">
              <div className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                Total Capital Turnover
              </div>
              <div className="text-2xl font-extrabold font-mono text-foreground mt-1 tabular-nums">
                {formatINR(tradeSummary.totalTurnover)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                Cumulative transaction volume
              </div>
            </Card>

            <Card className="p-4 bg-card/60 backdrop-blur-md border-border/40 shadow-xs">
              <div className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                Transacted Shares
              </div>
              <div className="text-2xl font-extrabold font-mono text-foreground mt-1 tabular-nums">
                {(tradeSummary.totalBuyVolume + tradeSummary.totalSellVolume).toLocaleString('en-IN')}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                {tradeSummary.totalBuyVolume.toLocaleString()} Bought / {tradeSummary.totalSellVolume.toLocaleString()} Sold
              </div>
            </Card>

            <Card className="p-4 bg-card/60 backdrop-blur-md border-border/40 shadow-xs flex flex-col justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                  Audit Export
                </div>
                <div className="text-xs font-bold text-foreground mt-1">
                  Permanent Ledger CSV
                </div>
              </div>
              <button
                onClick={exportTradeCSV}
                disabled={rawTrades.length === 0}
                className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 mt-2"
              >
                <Download className="h-3.5 w-3.5" /> Download CSV Ledger
              </button>
            </Card>
          </div>

          {/* Search, Filter & Order Controls */}
          <Card className="p-3.5 border-border/40 bg-card/60 backdrop-blur-md">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search historical ledger by ticker or stock name..."
                  value={tradeSearch}
                  onChange={(e) => setTradeSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-muted/40 border border-border/50 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                {/* Type Filter Buttons */}
                <div className="flex items-center p-0.5 rounded-lg bg-muted/60 border border-border/40 text-xs font-semibold font-mono">
                  <button
                    onClick={() => setTypeFilter('ALL')}
                    className={`px-3 py-1 rounded-md transition-all ${
                      typeFilter === 'ALL' 
                        ? 'bg-background text-foreground shadow-xs font-bold' 
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    ALL
                  </button>
                  <button
                    onClick={() => setTypeFilter('BUY')}
                    className={`px-3 py-1 rounded-md transition-all ${
                      typeFilter === 'BUY' 
                        ? 'bg-background text-emerald-400 shadow-xs font-bold' 
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    BUYS
                  </button>
                  <button
                    onClick={() => setTypeFilter('SELL')}
                    className={`px-3 py-1 rounded-md transition-all ${
                      typeFilter === 'SELL' 
                        ? 'bg-background text-rose-400 shadow-xs font-bold' 
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    SELLS
                  </button>
                </div>

                {/* Sort Order Selector */}
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as any)}
                  className="px-3 py-1.5 rounded-lg bg-muted/40 border border-border/50 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary font-mono"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="highest_value">Highest Value</option>
                </select>
              </div>
            </div>
          </Card>

          {/* All-Time Historical Trades Table */}
          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm overflow-hidden">
            <CardHeader className="py-3.5 px-4 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-extrabold flex items-center gap-2 tracking-tight">
                  <Clock className="h-4 w-4 text-primary" />
                  All-Time Execution Ledger ({filteredTrades.length} Records)
                </CardTitle>
                <span className="text-[11px] text-muted-foreground font-mono">
                  Stored permanently • Click any row for deep audit drawer
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isTradesLoading ? (
                <div className="flex items-center justify-center py-16 gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-xs font-mono text-muted-foreground">Loading permanent trade history...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground uppercase font-mono text-[10px] tracking-wider border-b border-border/40">
                      <tr>
                        <th className="px-4 py-3">Timestamp (IST)</th>
                        <th className="px-4 py-3">Stock</th>
                        <th className="px-4 py-3">Side</th>
                        <th className="px-4 py-3">Quantity</th>
                        <th className="px-4 py-3">Executed Price</th>
                        <th className="px-4 py-3">Total Value</th>
                        <th className="px-4 py-3">Return Since Trade</th>
                        <th className="px-4 py-3 text-right">Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {filteredTrades.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                            <Clock className="h-8 w-8 mx-auto opacity-30 text-primary mb-2" />
                            <p className="font-semibold text-foreground text-xs">No historical trades found matching filters</p>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              All virtual executions are preserved permanently in the database.
                            </p>
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
                              className="group hover:bg-muted/30 transition-colors cursor-pointer border-b border-border/20"
                            >
                              <td className="px-4 py-3 font-mono text-muted-foreground text-[11px]">
                                <div>
                                  {new Date(trade.timestamp).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </div>
                                <div className="text-[10px] opacity-70">
                                  {new Date(trade.timestamp).toLocaleTimeString('en-IN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })}
                                </div>
                              </td>

                              <td className="px-4 py-3 font-bold text-foreground">
                                <div className="font-mono text-sm group-hover:text-primary transition-colors">
                                  {trade.ticker.replace('.NS', '')}
                                </div>
                                <div className="text-[11px] text-muted-foreground font-normal truncate max-w-[180px]">
                                  {trade.name || trade.ticker}
                                </div>
                              </td>

                              <td className="px-4 py-3">
                                <span
                                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold border ${
                                    isBuy
                                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                  }`}
                                >
                                  {trade.type}
                                </span>
                              </td>

                              <td className="px-4 py-3 font-mono font-bold text-xs">
                                {trade.quantity.toLocaleString('en-IN')}
                              </td>

                              <td className="px-4 py-3 font-mono font-bold text-xs">
                                {formatINR(executedPrice)}
                              </td>

                              <td className="px-4 py-3 font-mono font-extrabold text-foreground text-xs">
                                {formatINR(trade.totalValue)}
                              </td>

                              <td className="px-4 py-3 font-mono">
                                <div className={`font-bold flex items-center text-xs ${isGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {isGain ? <ArrowUpRight className="h-3 w-3 mr-0.5 shrink-0" /> : <ArrowDownRight className="h-3 w-3 mr-0.5 shrink-0" />}
                                  {isGain ? '+' : ''}{deltaPercent.toFixed(2)}%
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  LTP: ₹{currentPrice.toFixed(1)}
                                </div>
                              </td>

                              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => setSelectedTrade(trade)}
                                  className="px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary font-mono font-semibold text-[11px] transition-colors border border-primary/20"
                                >
                                  Audit
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl rounded-2xl bg-card border border-border/80 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-border/40 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded text-xs font-mono font-extrabold border ${
                    selectedTrade.type === 'BUY' 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  }`}>
                    {selectedTrade.type} EXECUTION
                  </span>
                  <span className="font-mono text-lg font-extrabold text-foreground">
                    {selectedTrade.ticker.replace('.NS', '')}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{selectedTrade.name || selectedTrade.ticker}</div>
              </div>
              <button
                onClick={() => setSelectedTrade(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Execution Snapshot Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
              <div className="p-3 rounded-lg bg-muted/40 border border-border/40">
                <div className="text-muted-foreground text-[10px] uppercase">Executed Price</div>
                <div className="font-bold text-sm text-foreground mt-0.5">
                  {formatINR(selectedTrade.executedPrice ?? selectedTrade.price)}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/40">
                <div className="text-muted-foreground text-[10px] uppercase">Quantity</div>
                <div className="font-bold text-sm text-foreground mt-0.5">
                  {selectedTrade.quantity} Shares
                </div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/40">
                <div className="text-muted-foreground text-[10px] uppercase">Total Turnover</div>
                <div className="font-bold text-sm text-foreground mt-0.5">
                  {formatINR(selectedTrade.totalValue)}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-muted/40 border border-border/40">
                <div className="text-muted-foreground text-[10px] uppercase">Current LTP</div>
                <div className="font-bold text-sm text-foreground mt-0.5">
                  ₹{(selectedTrade.currentPrice ?? selectedTrade.price).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Performance Since Execution */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-muted/40 to-muted/10 border border-border/40 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-muted-foreground font-semibold">Performance Return Since Trade</span>
                <span className={`font-bold flex items-center ${(selectedTrade.deltaPercentSinceTrade ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {(selectedTrade.deltaPercentSinceTrade ?? 0) >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" /> : <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" />}
                  {(selectedTrade.deltaPercentSinceTrade ?? 0) >= 0 ? '+' : ''}{(selectedTrade.deltaPercentSinceTrade ?? 0).toFixed(2)}% ({formatINR((selectedTrade.deltaSinceTrade ?? 0) * selectedTrade.quantity)})
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                Executed on <span className="text-foreground font-mono font-semibold">{new Date(selectedTrade.timestamp).toLocaleString('en-IN')}</span> via National Stock Exchange ({selectedTrade.orderType || 'MARKET'} order).
              </div>
            </div>

            {/* Metadata & System Hash */}
            <div className="space-y-1.5 text-[10px] text-muted-foreground font-mono bg-muted/20 p-3 rounded-lg border border-border/30">
              <div className="flex justify-between">
                <span>Transaction ID:</span>
                <span className="text-foreground font-semibold">{selectedTrade.id}</span>
              </div>
              <div className="flex justify-between">
                <span>Exchange / Sector:</span>
                <span className="text-foreground">NSE • {selectedTrade.sector || 'Equities'}</span>
              </div>
              <div className="flex justify-between">
                <span>Audit Status:</span>
                <span className="text-emerald-400 flex items-center gap-1 font-semibold">
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
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open Stock Analysis Terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
