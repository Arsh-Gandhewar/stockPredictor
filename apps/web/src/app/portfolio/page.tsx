'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, TrendingUp, TrendingDown, Clock, Activity, Loader2 } from 'lucide-react';
import { usePortfolio, useExecuteTrade } from '@/hooks/use-stock';
import { useState } from 'react';

export default function PortfolioPage() {
  const { data: portfolio, isLoading, refetch } = usePortfolio();
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
