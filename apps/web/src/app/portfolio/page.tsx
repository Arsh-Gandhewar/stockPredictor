'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, TrendingDown, Clock, Activity } from 'lucide-react';

const positions = [
  { ticker: 'RELIANCE', name: 'Reliance Ind.', qty: 150, avgPrice: 2850.50, ltp: 2934.50 },
  { ticker: 'HDFCBANK', name: 'HDFC Bank', qty: 300, avgPrice: 1480.00, ltp: 1445.10 },
  { ticker: 'TCS', name: 'TCS Ltd.', qty: 50, avgPrice: 3890.00, ltp: 4012.30 },
];

const transactions = [
  { id: '1', date: '2026-08-04 10:15', ticker: 'RELIANCE', type: 'BUY', qty: 50, price: 2900.00 },
  { id: '2', date: '2026-08-03 14:30', ticker: 'INFY', type: 'SELL', qty: 100, price: 1640.20 },
  { id: '3', date: '2026-08-01 09:45', ticker: 'HDFCBANK', type: 'BUY', qty: 300, price: 1480.00 },
];

export default function PortfolioPage() {
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

  const calculateTotalValue = () => {
    return positions.reduce((acc, pos) => acc + (pos.qty * pos.ltp), 0);
  };

  const calculateTotalInvested = () => {
    return positions.reduce((acc, pos) => acc + (pos.qty * pos.avgPrice), 0);
  };

  const totalValue = calculateTotalValue();
  const totalInvested = calculateTotalInvested();
  const totalPnL = totalValue - totalInvested;
  const pnlPercent = (totalPnL / totalInvested) * 100;

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
            <div className="text-2xl font-bold">{formatCurrency(totalValue + 245000)}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Cash</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(245000)}</div>
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
            <div className={\`text-2xl font-bold \${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}\`}>
              {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
            </div>
            <p className={\`text-xs \${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}\`}>
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
                  {positions.map((pos) => {
                    const pnl = (pos.ltp - pos.avgPrice) * pos.qty;
                    const isProfit = pnl >= 0;
                    return (
                      <tr key={pos.ticker} className="border-b border-border hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {pos.ticker}
                          <div className="text-xs text-muted-foreground">{pos.name}</div>
                        </td>
                        <td className="px-4 py-3">{pos.qty}</td>
                        <td className="px-4 py-3">{formatCurrency(pos.avgPrice)}</td>
                        <td className="px-4 py-3">{formatCurrency(pos.ltp)}</td>
                        <td className={\`px-4 py-3 font-medium \${isProfit ? 'text-green-500' : 'text-red-500'}\`}>
                          {isProfit ? '+' : ''}{formatCurrency(pnl)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button className="text-xs font-bold text-destructive hover:underline">SELL</button>
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
              {transactions.map((tx) => (
                <div key={tx.id} className="flex justify-between items-center border-b border-border pb-3 last:border-0 last:pb-0">
                  <div>
                    <div className="font-bold">{tx.ticker}</div>
                    <div className="text-xs text-muted-foreground">{tx.date}</div>
                  </div>
                  <div className="text-right">
                    <div className={\`font-bold \${tx.type === 'BUY' ? 'text-blue-500' : 'text-orange-500'}\`}>
                      {tx.type}
                    </div>
                    <div className="text-xs font-medium text-foreground">
                      {tx.qty} @ {formatCurrency(tx.price)}
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
