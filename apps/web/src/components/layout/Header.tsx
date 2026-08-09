'use client';

import { UserButton } from '@clerk/nextjs';
import { Search, Bell, Loader2, ArrowUpRight } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStockSearch } from '@/hooks/use-stock';

export function Header() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: searchResults, isLoading } = useStockSearch(searchQuery);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (ticker: string) => {
    setSearchQuery('');
    setIsOpen(false);
    router.push(`/stock/${ticker}`);
  };

  return (
    <header className="flex h-16 items-center gap-4 border-b border-border/50 bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-40 sticky top-0">
      <div className="flex flex-1 items-center gap-4 md:w-auto md:flex-none">
        <div ref={containerRef} className="relative w-full max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="Search stock, ticker, sector (e.g. RELIANCE, TCS)..."
            className="flex h-9 w-full rounded-lg border border-input bg-muted/40 px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary pl-9 text-foreground"
          />

          {/* Search Dropdown */}
          {isOpen && searchQuery.trim().length > 0 && (
            <div className="absolute top-11 left-0 right-0 rounded-xl border border-border/60 bg-card/95 backdrop-blur shadow-2xl p-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-200 divide-y divide-border/20">
              {isLoading ? (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary mr-2" /> Searching universe...
                </div>
              ) : !searchResults || searchResults.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No stocks found for "{searchQuery}"
                </div>
              ) : (
                searchResults.map((stock) => (
                  <div
                    key={stock.ticker}
                    onClick={() => handleSelect(stock.ticker)}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/60 transition-colors cursor-pointer group"
                  >
                    <div>
                      <div className="font-bold text-xs text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                        <span>{stock.ticker.replace('.NS', '')}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-muted/80 text-muted-foreground">
                          {stock.exchange}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1">{stock.name}</div>
                    </div>
                    {stock.sector && (
                      <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                        {stock.sector} <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center space-x-4">
        <button
          onClick={() => router.push('/alerts')}
          className="relative inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-primary" />
        </button>
        <UserButton />
      </div>
    </header>
  );
}
