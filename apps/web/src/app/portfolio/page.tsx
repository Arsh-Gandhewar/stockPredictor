'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Wallet, TrendingUp, TrendingDown, Clock, Activity, Loader2, AlertTriangle, ShieldCheck, Zap } from 'lucide-react';
import { usePortfolio, useExecuteTrade, usePortfolioSellSignals } from '@/hooks/use-stock';
import { useState } from 'react';

export default function PortfolioPage() {
  const { data: portfolio, isLoading, refetch } = usePortfolio();
  const { data: sellSignals, isLoading: isSignalsLoading } = usePortfolioSellSignals();
  const executeTrade = useExecuteTrade();
  
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

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

  // In a real app we'd fetch real-time LTP. For now, let's assume LTP is close to average for seeded data.
  // We'll just mock LTP as avgPrice * some random multiplier for the sake of the UI until real socket is attached
  const enrichedPositions = positions.map((p: any) => ({
    ...p,
    ltp: p.averagePrice * (1 + (Math.random() * 0.1 - 0.05)), // +/- 5%
    ticker: p.stock.ticker,
    name: p.stock.name,
  }));

  const calculateTotalValue = () => {
    return enrichedPositions.reduce((acc: number, pos: any) => acc + (pos.quantity * pos.ltp), 0);
  };

  const calculateTotalInvested = () => {
    return enrichedPositions.reduce((acc: number, pos: any) => acc + (pos.quantity * pos.averagePrice), 0);
  };

  const totalInvested = calculateTotalInvested();
  const totalValue = calculateTotalValue();
  const totalPnL = totalValue - totalInvested;
  const pnlPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const handleSell = (ticker: string, quantity: number) => {
    executeTrade.mutate({ ticker, type: 'SELL', quantity });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Paper Trading Portfolio</h1>
        <p className="text-muted-foreground">
          Manage your virtual investments and track performance.
        </p>
      </div>

      {/* Portfolio Overview Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Portfolio Value</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue + availableCash)}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Cash</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(availableCash)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invested</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalInvested)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unrealized P&L</CardTitle>
            {totalPnL >= 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold \${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
            </div>
            <p className={`text-xs \${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalPnL >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* AI Continuous Portfolio Monitor - High Confidence Exit Signals (Confidence >= 80%) */}
      <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-card shadow-lg overflow-hidden">
        <CardHeader className="border-b border-amber-500/20 bg-amber-500/5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Zap className="h-5 w-5 text-amber-500 animate-pulse" />
              <CardTitle className="text-lg font-bold text-amber-500">
                AI Continuous Portfolio Monitor — Sell Signals (Confidence ≥ 80%)
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
              <span className="text-sm text-muted-foreground">Scanning portfolio holdings with Gemini AI...</span>
            </div>
          ) : !sellSignals || sellSignals.length === 0 ? (
            <div className="flex items-center justify-between p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center space-x-3">
                <ShieldCheck className="h-6 w-6 text-green-500" />
                <div>
                  <div className="font-semibold text-green-400">All Portfolio Holdings Optimal</div>
                  <div className="text-xs text-muted-foreground">No high-confidence sell signals detected (Confidence ≥ 80%). Your current positions show healthy momentum.</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {sellSignals.map((signal: any) => (
                <div key={signal.ticker} className="p-4 rounded-xl border border-amber-500/30 bg-card/80 hover:border-amber-500/50 transition-all space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                    <div className="flex items-center space-x-3">
                      <div className="px-2.5 py-1 rounded-md bg-amber-500/20 font-bold text-amber-400 text-sm">
                        {signal.ticker}
                      </div>
                      <div>
                        <span className="font-semibold text-foreground">{signal.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">Qty: {signal.quantityHeld}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">AI Exit Target</div>
                        <div className="font-bold text-amber-400">₹{signal.targetExitPrice?.toFixed(2)}</div>
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
                      <p className="text-muted-foreground leading-relaxed">{signal.financialReasoning}</p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                      <div className="font-semibold text-primary flex items-center">
                        <Clock className="h-3.5 w-3.5 mr-1" /> Company News & Sentiment
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{signal.newsImpact}</p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                      <div className="font-semibold text-primary flex items-center">
                        <TrendingDown className="h-3.5 w-3.5 mr-1" /> Grey Market & Momentum (GMP)
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{signal.gmpAnalysis}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Current Positions */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Current Holdings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 rounded-md">
                  <tr>
                    <th className="px-4 py-3 rounded-l-md">Stock</th>
                    <th className="px-4 py-3">Qty</th>
                    <th className="px-4 py-3">Avg Price</th>
                    <th className="px-4 py-3">LTP</th>
                    <th className="px-4 py-3">P&L</th>
                    <th className="px-4 py-3 rounded-r-md text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {enrichedPositions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        No holdings yet. Search for a stock to buy!
                      </td>
                    </tr>
                  ) : enrichedPositions.map((pos: any) => {
                    const pnl = (pos.ltp - pos.averagePrice) * pos.quantity;
                    const isProfit = pnl >= 0;
                    return (
                      <tr key={pos.ticker} className="border-b border-border hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {pos.ticker}
                          <div className="text-xs text-muted-foreground">{pos.name}</div>
                        </td>
                        <td className="px-4 py-3">{pos.quantity}</td>
                        <td className="px-4 py-3">{formatCurrency(pos.averagePrice)}</td>
                        <td className="px-4 py-3">{formatCurrency(pos.ltp)}</td>
                        <td className={`px-4 py-3 font-medium \${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                          {isProfit ? '+' : ''}{formatCurrency(pnl)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button 
                            onClick={() => handleSell(pos.ticker, pos.quantity)}
                            disabled={executeTrade.isPending}
                            className="text-xs font-bold text-destructive hover:underline disabled:opacity-50"
                          >
                            SELL ALL
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Transaction History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Clock className="h-4 w-4 mr-2" /> Recent Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {transactions.length === 0 ? (
                <div className="text-center text-muted-foreground py-4">No recent transactions</div>
              ) : transactions.map((tx: any) => (
                <div key={tx.id} className="flex justify-between items-center border-b border-border pb-3 last:border-0 last:pb-0">
                  <div>
                    <div className="font-bold">{tx.stock?.ticker || 'UNKNOWN'}</div>
                    <div className="text-xs text-muted-foreground">{new Date(tx.timestamp).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold \${tx.type === 'BUY' ? 'text-blue-500' : 'text-orange-500'}`}>
                      {tx.type}
                    </div>
                    <div className="text-xs font-medium text-foreground">
                      {tx.quantity} @ {formatCurrency(tx.price)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
