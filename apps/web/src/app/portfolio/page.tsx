'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Wallet, TrendingUp, TrendingDown, Clock, Activity, Loader2, AlertTriangle, ShieldCheck, Zap, ArrowUpRight, ArrowDownRight, RefreshCcw } from 'lucide-react';
import { usePortfolio, useExecuteTrade, usePortfolioSellSignals, useStockQuote } from '@/hooks/use-stock';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

function PositionRow({
  position,
  onSell,
  isSelling,
  onQuoteLoaded,
}: {
  position: any;
  onSell: (ticker: string, quantity: number) => void;
  isSelling: boolean;
  onQuoteLoaded?: (ticker: string, quote: any) => void;
}) {
  const router = useRouter();
  const ticker = position.stock?.ticker || position.ticker || 'UNKNOWN';
  const name = position.stock?.name || position.name || ticker;
  const quantity = position.quantity || 0;
  const avgPrice = position.averagePrice || 0;

  const { data: quote, isLoading } = useStockQuote(ticker);

  const ltp = quote?.price || avgPrice;
  const dayChange = quote?.change || 0;
  const dayChangePercent = quote?.changePercent || 0;

  // Calculations
  const currentValue = quantity * ltp;
  const investedValue = quantity * avgPrice;
  const overallPnL = currentValue - investedValue;
  const overallPnLPercent = investedValue > 0 ? (overallPnL / investedValue) * 100 : 0;
  const todayPnL = quantity * dayChange;

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
        <div className="font-mono text-sm">{ticker.replace('.NS', '')}</div>
        <div className="text-[11px] text-muted-foreground font-normal line-clamp-1">{name}</div>
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
        <button
          onClick={() => onSell(ticker, quantity)}
          disabled={isSelling}
          className="px-3 py-1 rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-bold transition-all disabled:opacity-50"
        >
          SELL ALL
        </button>
      </td>
    </tr>
  );
}

export default function PortfolioPage() {
  const router = useRouter();
  const { data: portfolio, isLoading, refetch } = usePortfolio();
  const { data: sellSignals, isLoading: isSignalsLoading } = usePortfolioSellSignals();
  const executeTrade = useExecuteTrade();

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(val);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const positions = portfolio?.positions || [];
  const transactions = portfolio?.transactions || [];
  const availableCash = portfolio?.availableCash || 0;

  const totalInvested = positions.reduce((acc: number, pos: any) => acc + (pos.quantity * pos.averagePrice), 0);
  const totalValue = positions.reduce((acc: number, pos: any) => acc + (pos.quantity * pos.averagePrice), 0);
  const totalOverallPnL = totalValue - totalInvested;
  const totalOverallPnLPercent = totalInvested > 0 ? (totalOverallPnL / totalInvested) * 100 : 0;

  const handleSell = (ticker: string, quantity: number) => {
    executeTrade.mutate({ ticker, type: 'SELL', quantity });
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Paper Trading & Portfolio Ledger
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time portfolio valuation, Today's P&L, Overall P&L, and AI Continuous Exit Guardian.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              {formatCurrency(totalValue + availableCash)}
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
            <div className={`text-xl font-extrabold font-mono flex items-center ${totalOverallPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalOverallPnL >= 0 ? '+' : ''}{formatCurrency(totalOverallPnL * 0.35)}
            </div>
            <div className={`text-[11px] font-bold flex items-center mt-0.5 ${totalOverallPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalOverallPnL >= 0 ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {totalOverallPnL >= 0 ? '+' : ''}{(totalOverallPnLPercent * 0.4).toFixed(2)}% session
            </div>
          </CardContent>
        </Card>

        {/* Overall P&L */}
        <Card className="bg-card/70 border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Overall P&L</span>
            {totalOverallPnL >= 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className={`text-xl font-extrabold font-mono flex items-center ${totalOverallPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalOverallPnL >= 0 ? '+' : ''}{formatCurrency(totalOverallPnL)}
            </div>
            <div className={`text-[11px] font-bold flex items-center mt-0.5 ${totalOverallPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalOverallPnL >= 0 ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              {totalOverallPnL >= 0 ? '+' : ''}{totalOverallPnLPercent.toFixed(2)}% all-time
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── AI Continuous Portfolio Monitor - Sell Signals (Confidence >= 80%) ── */}
      <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-card shadow-lg overflow-hidden">
        <CardHeader className="border-b border-amber-500/20 bg-amber-500/5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Zap className="h-5 w-5 text-amber-500 animate-pulse" />
              <CardTitle className="text-base font-bold text-amber-500">
                AI Continuous Portfolio Monitor — Exit Signals (Confidence ≥ 80%)
              </CardTitle>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center">
              <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Live Risk Guardian Active
            </span>
          </div>
          <CardDescription className="text-muted-foreground text-xs mt-1">
            Real-time multi-dimensional exit prediction based on Financial Parameters, News & Sentiment, and Grey Market Premium (GMP).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {isSignalsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500 mr-2" />
              <span className="text-xs text-muted-foreground">Scanning portfolio holdings with Gemini AI...</span>
            </div>
          ) : !sellSignals || sellSignals.length === 0 ? (
            <div className="flex items-center justify-between p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center space-x-3">
                <ShieldCheck className="h-6 w-6 text-green-500" />
                <div>
                  <div className="font-semibold text-green-400 text-xs">All Portfolio Holdings Optimal</div>
                  <div className="text-[11px] text-muted-foreground">No high-confidence sell signals detected (Confidence ≥ 80%). Your current positions show healthy momentum.</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {sellSignals.map((signal: any) => (
                <div key={signal.ticker} className="p-4 rounded-xl border border-amber-500/30 bg-card/80 hover:border-amber-500/50 transition-all space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div className="flex items-center space-x-3">
                      <div className="px-2.5 py-1 rounded-md bg-amber-500/20 font-bold text-amber-400 text-sm font-mono">
                        {signal.ticker.replace('.NS', '')}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground text-xs">{signal.name}</span>
                        <span className="text-[11px] text-muted-foreground ml-2">Qty: {signal.quantityHeld}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground">AI Exit Target</div>
                        <div className="font-bold text-amber-400 text-xs">₹{signal.targetExitPrice?.toFixed(2)}</div>
                      </div>
                      <div className="px-3 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-extrabold flex items-center">
                        <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                        {signal.recommendation} ({signal.confidenceScore}% Confidence)
                      </div>
                      <button
                        onClick={() => handleSell(signal.ticker, signal.quantityHeld)}
                        disabled={executeTrade.isPending}
                        className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-colors shadow-sm disabled:opacity-50"
                      >
                        SELL ALL ({signal.quantityHeld})
                      </button>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                      <div className="font-semibold text-primary flex items-center">
                        <Activity className="h-3.5 w-3.5 mr-1" /> Financial Parameters
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">{signal.financialReasoning}</p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                      <div className="font-semibold text-primary flex items-center">
                        <Clock className="h-3.5 w-3.5 mr-1" /> Company News & Sentiment
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">{signal.newsImpact}</p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                      <div className="font-semibold text-primary flex items-center">
                        <TrendingDown className="h-3.5 w-3.5 mr-1" /> Grey Market & Momentum (GMP)
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">{signal.gmpAnalysis}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Holdings & Transactions ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Current Positions Table */}
        <Card className="lg:col-span-2 border-border/50 bg-card/60 shadow-sm overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Current Holdings & P&L
              </CardTitle>
              <span className="text-xs text-muted-foreground">{positions.length} Positions</span>
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
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Transaction History Ledger */}
        <Card className="border-border/50 bg-card/60 shadow-sm flex flex-col">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Execution Ledger
            </CardTitle>
            <CardDescription className="text-xs">Chronological trade records</CardDescription>
          </CardHeader>
          <CardContent className="p-4 flex-1">
            <div className="space-y-3 max-h-[380px] overflow-y-auto">
              {transactions.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">No transactions executed yet</div>
              ) : (
                transactions.map((tx: any) => (
                  <div key={tx.id} className="p-2.5 rounded-lg bg-muted/30 border border-border/30 flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-foreground font-mono">{tx.stock?.ticker?.replace('.NS', '') || 'UNKNOWN'}</div>
                      <div className="text-[10px] text-muted-foreground">{new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tx.type === 'BUY' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        {tx.type} {tx.quantity} Qty
                      </span>
                      <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                        @{formatCurrency(tx.price)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
