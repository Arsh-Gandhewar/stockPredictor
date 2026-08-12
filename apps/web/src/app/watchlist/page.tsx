'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Star, Plus, Trash2, ArrowUpRight, ArrowDownRight, Search, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist, useAllStocks, StockQuote } from '@/hooks/use-stock';

export default function WatchlistPage() {
  const router = useRouter();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');

  const { data: quotes, isLoading } = useWatchlist();
  const { data: allStocks } = useAllStocks();
  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();

  const handleAdd = (ticker: string) => {
    addMutation.mutate(ticker);
    setIsAddOpen(false);
    setAddSearch('');
  };

  const filteredSearch = (allStocks || []).filter(
    (s: any) =>
      s.ticker.toLowerCase().includes(addSearch.toLowerCase()) ||
      s.name.toLowerCase().includes(addSearch.toLowerCase())
  ).slice(0, 8);

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              Personal Watchlist
            </h1>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> 5S SYNC
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time monitored Indian equities with live price quotes, percentage moves, and instant research shortcuts.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-sm self-start md:self-auto"
        >
          <Plus className="h-4 w-4" /> Add Stock to Watchlist
        </button>
      </div>

      {/* Watchlist Table */}
      <Card className="border-border/50 bg-card/60 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
              <span className="text-xs text-muted-foreground">Streaming live watchlist quotes...</span>
            </div>
          ) : quotes?.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground space-y-2">
              <Star className="h-8 w-8 mx-auto opacity-30 text-amber-400" />
              <p>Your watchlist is empty. Click "Add Stock to Watchlist" to start tracking equities.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/30 text-muted-foreground border-b border-border/40 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-4">Stock</th>
                    <th className="py-3 px-4">Exchange</th>
                    <th className="py-3 px-4 text-right">LTP (₹)</th>
                    <th className="py-3 px-4 text-right">Day Move</th>
                    <th className="py-3 px-4 text-right">Day Range</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {quotes?.map((quote: StockQuote) => {
                    const isPositive = quote.changePercent >= 0;
                    return (
                      <tr
                        key={quote.ticker}
                        onClick={() => router.push(`/stock/${quote.ticker}`)}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <td className="py-3.5 px-4 font-bold text-foreground">
                          <div className="flex items-center gap-2">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />
                            <span className="font-mono">{quote.ticker.replace('.NS', '')}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground font-normal line-clamp-1 ml-5.5">
                            {quote.name}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-muted-foreground">
                          <span className="px-2 py-0.5 rounded bg-muted/60 text-[10px] font-semibold">
                            {quote.exchange || 'NSE'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold">
                          ₹{quote.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span
                            className={`inline-flex items-center font-bold px-2 py-0.5 rounded text-[11px] ${
                              isPositive
                                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}
                          >
                            {isPositive ? (
                              <ArrowUpRight className="h-3 w-3 mr-0.5" />
                            ) : (
                              <ArrowDownRight className="h-3 w-3 mr-0.5" />
                            )}
                            {isPositive ? '+' : ''}
                            {quote.changePercent.toFixed(2)}%
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right text-[11px] text-muted-foreground font-mono">
                          ₹{quote.dayLow?.toFixed(1)} - ₹{quote.dayHigh?.toFixed(1)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeMutation.mutate(quote.ticker);
                            }}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Remove from watchlist"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Stock Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-sm">Add Stock to Watchlist</h3>
              <button
                onClick={() => setIsAddOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search ticker (e.g. TATA, RELIANCE)..."
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                autoFocus
                className="w-full h-9 pl-8 pr-3 text-xs rounded-lg bg-muted/40 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1 max-h-60 overflow-y-auto">
              {filteredSearch.map((stock: any) => (
                <div
                  key={stock.ticker}
                  onClick={() => handleAdd(stock.ticker)}
                  className="p-2.5 rounded-lg hover:bg-muted/50 cursor-pointer flex items-center justify-between transition-colors"
                >
                  <div>
                    <div className="font-bold text-xs">{stock.ticker.replace('.NS', '')}</div>
                    <div className="text-[10px] text-muted-foreground">{stock.name}</div>
                  </div>
                  <span className="text-primary font-bold text-xs">+ Add</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
