'use client';

import { UserButton } from '@clerk/nextjs';
import { Search, Bell, Loader2, ArrowUpRight, Menu, X, Activity } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useStockSearch } from '@/hooks/use-stock';
import { routes } from './Sidebar';
import { cn } from '@/lib/utils';

function formatTier(tier?: string) {
  if (!tier) return null;
  const clean = tier.replace('_', ' ');
  return clean.charAt(0) + clean.slice(1).toLowerCase();
}

function getTierBadgeClass(tier?: string) {
  if (!tier) return 'bg-white/5 text-muted-foreground border-white/10';
  if (tier.includes('LARGE')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (tier.includes('MID')) return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
  return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data: searchResults, isLoading } = useStockSearch(searchQuery);

  // Keyboard shortcut for Cmd+K / Ctrl+K and Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
        searchInputRef.current?.blur();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
      <header className="glass-header flex h-16 items-center gap-3 px-4 md:px-6 z-40 sticky top-0 border-b border-white/5">
        {/* Mobile menu trigger */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors border border-white/5"
          aria-label="Toggle navigation"
        >
          {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        {/* Brand logo for mobile */}
        <div className="md:hidden flex items-center gap-2 font-extrabold text-sm text-gradient-brand">
          <Activity className="h-4 w-4 text-primary animate-pulse" />
          <span>QuantX</span>
        </div>

        {/* Global Institutional Search Bar */}
        <div className="flex flex-1 items-center gap-4 md:w-auto md:flex-none">
          <div ref={containerRef} className="relative w-full max-w-xs sm:max-w-md group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none transition-colors group-focus-within:text-primary" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              placeholder="Search ticker, company, or sector..."
              className="flex h-10 w-full rounded-xl border border-white/10 bg-slate-900/60 backdrop-blur-md px-3.5 pl-10 pr-16 text-xs md:text-sm shadow-inner transition-all duration-200 placeholder:text-muted-foreground/60 text-foreground focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20 focus:bg-slate-900/90 hover:border-white/20"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
              <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground">
                <span className="text-[11px]">⌘</span>K
              </kbd>
            </div>

            {/* Institutional Search Dropdown */}
            {isOpen && searchQuery.trim().length > 0 && (
              <div className="absolute top-12 left-0 right-0 rounded-2xl border border-white/10 bg-slate-950/90 backdrop-blur-2xl shadow-[0_16px_36px_-4px_rgba(0,0,0,0.6)] p-2 z-50 divide-y divide-white/5 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                  <span>Equities Universe</span>
                  <span>Esc to exit</span>
                </div>
                <div className="pt-1 max-h-[380px] overflow-y-auto space-y-1">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8 text-xs font-mono text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary mr-2.5" />
                      <span>Querying high-frequency universe...</span>
                    </div>
                  ) : !searchResults || searchResults.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      No institutional assets found matching "{searchQuery}"
                    </div>
                  ) : (
                    searchResults.map((stock) => {
                      const item = stock as {
                        ticker: string;
                        name: string;
                        sector: string | null;
                        exchange: string;
                        marketCapTier?: string;
                        price?: number;
                        changePercent?: number;
                      };
                      const tier = item.marketCapTier;
                      const price = item.price;
                      const changePercent = item.changePercent;

                      return (
                        <div
                          key={stock.ticker}
                          onClick={() => handleSelect(stock.ticker)}
                          className="flex items-center justify-between p-2.5 rounded-xl hover:bg-white/[0.06] hover:border-white/10 border border-transparent transition-all duration-150 cursor-pointer group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center font-mono font-bold text-xs text-primary group-hover:bg-primary/10 group-hover:border-primary/30 transition-colors shrink-0">
                              {stock.ticker.replace('.NS', '').slice(0, 3)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-xs text-foreground group-hover:text-primary transition-colors flex items-center gap-2">
                                <span className="font-mono tracking-tight">{stock.ticker.replace('.NS', '')}</span>
                                <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground border border-white/10">
                                  {stock.exchange || 'NSE'}
                                </span>
                                {tier && (
                                  <span className={cn("text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border", getTierBadgeClass(tier))}>
                                    {formatTier(tier)}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground/80 truncate max-w-[200px] sm:max-w-[260px]">
                                {stock.name}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0 ml-3">
                            {price != null && (
                              <div className="text-right font-mono">
                                <div className="text-xs font-semibold tabular-nums text-foreground">
                                  ₹{Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                                {changePercent != null && (
                                  <div className={cn("text-[10px] font-medium tabular-nums", changePercent >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                    {changePercent >= 0 ? '+' : ''}{Number(changePercent).toFixed(2)}%
                                  </div>
                                )}
                              </div>
                            )}
                            {stock.sector && price == null && (
                              <span className="hidden sm:inline-flex text-[10px] text-muted-foreground/80 font-medium px-2 py-0.5 rounded-full bg-white/5 border border-white/5">
                                {stock.sector}
                              </span>
                            )}
                            <div className="h-6 w-6 rounded-lg bg-white/5 flex items-center justify-center text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="ml-auto flex items-center space-x-2.5">
          <button
            onClick={() => router.push('/alerts')}
            className="relative inline-flex items-center justify-center rounded-xl p-2.5 text-muted-foreground hover:text-foreground border border-white/5 hover:border-white/15 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-200"
            aria-label="Alerts"
            title="Market Alerts"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-2 right-2 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
          </button>
          <div className="p-0.5 rounded-full ring-1 ring-white/10 hover:ring-primary/40 transition-all duration-200">
            <UserButton appearance={{ elements: { avatarBox: 'h-8 w-8' } }} />
          </div>
        </div>
      </header>

      {/* Mobile Drawer Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-x-0 top-16 bottom-0 bg-slate-950/95 backdrop-blur-2xl z-50 p-4 border-b border-white/10 animate-in slide-in-from-top-2 duration-200 overflow-y-auto">
          <div className="px-2 pb-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 font-semibold">
            Terminal Navigation
          </div>
          <nav className="grid gap-1">
            {routes.map((route) => {
              const isActive = pathname === route.href;
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                    isActive
                      ? "bg-gradient-to-r from-primary/20 via-primary/10 to-transparent text-primary border border-primary/25 shadow-sm font-bold"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  <route.icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                  {route.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}

