'use client';

import { UserButton } from '@clerk/nextjs';
import { Search, Bell, Loader2, ArrowUpRight, Menu, X, Activity } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useStockSearch } from '@/hooks/use-stock';
import { routes } from './Sidebar';
import { cn } from '@/lib/utils';

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: searchResults, isLoading } = useStockSearch(searchQuery);

  // Close search on click outside
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
    setIsMobileMenuOpen(false);
    router.push(`/stock/${ticker}`);
  };

  return (
    <>
      <header className="flex h-16 items-center gap-3 border-b border-border/50 bg-background/95 px-4 md:px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-40 sticky top-0">
        {/* Mobile menu trigger */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-muted/60"
          aria-label="Toggle navigation"
        >
          {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        {/* Brand logo for mobile */}
        <div className="md:hidden flex items-center gap-1.5 font-extrabold text-sm text-primary">
          <Activity className="h-4 w-4" />
          <span>QuantX</span>
        </div>

        {/* Global Search Bar */}
        <div className="flex flex-1 items-center gap-4 md:w-auto md:flex-none">
          <div ref={containerRef} className="relative w-full max-w-xs sm:max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              placeholder="Search stocks..."
              className="flex h-9 w-full rounded-lg border border-input bg-muted/40 px-3 py-1 text-xs md:text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary pl-9 text-foreground"
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
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground">
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

        <div className="ml-auto flex items-center space-x-3">
          <button
            onClick={() => router.push('/alerts')}
            className="relative inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Alerts"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-primary" />
          </button>
          <UserButton />
        </div>
      </header>

      {/* Mobile Drawer Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-x-0 top-16 bottom-0 bg-background/95 backdrop-blur-md z-50 p-4 border-b border-border animate-in slide-in-from-top-2 duration-200">
          <nav className="grid gap-1">
            {routes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all",
                  pathname === route.href
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-sm"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <route.icon className="h-4 w-4" />
                {route.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
