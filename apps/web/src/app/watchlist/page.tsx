'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Star, Plus, Trash2, ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAllStocks, useStockQuote } from '@/hooks/use-stock';

function WatchlistRow({
  ticker,
  stockInfo,
  onRemove,
  onClick,
}: {
  ticker: string;
  stockInfo?: { name: string; sector: string | null };
  onRemove: () => void;
  onClick: () => void;
}) {
  const { data: quote, isLoading } = useStockQuote(ticker);
  const isPositive = (quote?.changePercent || 0) >= 0;

  return (
    <tr
      className="hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <td className="py-3.5 px-4 font-bold text-foreground">
        <div className="flex items-center gap-2">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />
          <span className="font-mono">{ticker.replace('.NS', '')}</span>
        </div>
        <div className="text-[11px] text-muted-foreground font-normal line-clamp-1 ml-5.5">
          {stockInfo?.name || ticker}
        </div>
      </td>
      <td className="py-3.5 px-4 text-muted-foreground">
        <span className="px-2 py-0.5 rounded bg-muted/60 text-[10px] font-medium">
          {stockInfo?.sector || 'NSE'}
        </span>
      </td>
      <td className="py-3.5 px-4 text-right font-mono font-bold">
        {isLoading ? (
          <span className="text-muted-foreground animate-pulse">...</span>
        ) : (
          `₹${(quote?.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
        )}
      </td>
      <td className="py-3.5 px-4 text-right">
        {isLoading ? (
          <span className="text-muted-foreground animate-pulse">...</span>
        ) : (
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
            {(quote?.changePercent || 0).toFixed(2)}%
          </span>
        )}
      </td>
      <td className="py-3.5 px-4 text-right">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Remove from watchlist"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

export default function WatchlistPage() {
  const router = useRouter();
  const [watchlist, setWatchlist] = useState<string[]>(['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS']);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');

  const { data: allStocks } = useAllStocks();

  useEffect(() => {
    const saved = localStorage.getItem('user_watchlist');
    if (saved) {
      try {
        setWatchlist(JSON.parse(saved));
      } catch {}
    }
  }, []);

  const saveWatchlist = (newList: string[]) => {
    setWatchlist(newList);
    localStorage.setItem('user_watchlist', JSON.stringify(newList));
  };

  const removeStock = (ticker: string) => {
    saveWatchlist(watchlist.filter((t) => t !== ticker));
  };

  const addStock = (ticker: string) => {
    if (!watchlist.includes(ticker)) {
      saveWatchlist([...watchlist, ticker]);
    }
    setIsAddOpen(false);
    setAddSearch('');
  };

  const availableToAdd = (allStocks || []).filter(
    (s) =>
      !watchlist.includes(s.ticker) &&
      (s.ticker.toLowerCase().includes(addSearch.toLowerCase()) || s.name.toLowerCase().includes(addSearch.toLowerCase()))
  );

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Personal Watchlist
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Pin and stream real-time price action across your highest-conviction Indian market equities.
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
          {watchlist.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground space-y-2">
              <Star className="h-8 w-8 mx-auto opacity-30 text-primary" />
              <p>Your watchlist is empty. Add your favorite stocks to track them here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/30 text-muted-foreground border-b border-border/40 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-4">Stock</th>
                    <th className="py-3 px-4">Sector</th>
                    <th className="py-3 px-4 text-right">Live Price</th>
                    <th className="py-3 px-4 text-right">Day Change</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {watchlist.map((ticker) => {
                    const stockInfo = (allStocks || []).find((s) => s.ticker === ticker);
                    return (
                      <WatchlistRow
                        key={ticker}
                        ticker={ticker}
                        stockInfo={stockInfo}
                        onRemove={() => removeStock(ticker)}
                        onClick={() => router.push(`/stock/${ticker}`)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border/60 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b border-border/40 pb-3">
              <h3 className="font-extrabold text-base">Add Stock to Watchlist</h3>
              <button onClick={() => setIsAddOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by symbol or company name..."
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 text-xs rounded-lg bg-muted/40 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              />
            </div>

            <div className="max-h-60 overflow-y-auto divide-y divide-border/20">
              {availableToAdd.slice(0, 10).map((stock) => (
                <div
                  key={stock.ticker}
                  onClick={() => addStock(stock.ticker)}
                  className="p-2.5 hover:bg-muted/40 rounded-lg cursor-pointer flex justify-between items-center text-xs group"
                >
                  <div>
                    <span className="font-bold text-foreground group-hover:text-primary transition-colors">
                      {stock.ticker.replace('.NS', '')}
                    </span>
                    <div className="text-[10px] text-muted-foreground">{stock.name}</div>
                  </div>
                  <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
