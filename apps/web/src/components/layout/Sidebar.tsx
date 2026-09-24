'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { 
  LayoutDashboard, 
  LineChart, 
  Newspaper, 
  Wallet, 
  Settings, 
  BellRing,
  Compass,
  Star,
  Activity,
  Cpu,
  Search
} from 'lucide-react';

export const routes = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { label: 'Discover', icon: Compass, href: '/discover' },
  { label: 'Deep Audit', icon: Search, href: '/audit' },
  { label: 'Markets', icon: LineChart, href: '/markets' },
  { label: 'Model Performance', icon: Cpu, href: '/model-performance' },
  { label: 'Watchlist', icon: Star, href: '/watchlist' },
  { label: 'Portfolio', icon: Wallet, href: '/portfolio' },
  { label: 'News', icon: Newspaper, href: '/news' },
  { label: 'Alerts', icon: BellRing, href: '/alerts' },
  { label: 'Settings', icon: Settings, href: '/settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex h-full w-64 flex-col bg-card/70 backdrop-blur-xl border-r border-white/5 shadow-[4px_0_24px_-2px_rgba(0,0,0,0.3)] shrink-0 z-20 select-none">
      {/* Premium Institutional Brand Header */}
      <div className="flex h-16 items-center justify-between px-5 border-b border-white/5">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="relative flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 border border-primary/30 group-hover:border-primary/50 group-hover:shadow-[0_0_15px_rgba(99,102,241,0.35)] transition-all duration-300">
            <Activity className="h-4 w-4 text-primary animate-pulse" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-lg tracking-tight text-gradient-brand">
              QuantX
            </span>
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              INSTITUTIONAL
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation Routes */}
      <div className="flex-1 overflow-y-auto py-5 px-3">
        <div className="px-3 pb-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 font-semibold">
          Terminal Navigation
        </div>
        <nav className="space-y-1">
          {routes.map((route) => {
            const isActive = pathname === route.href;
            const Icon = route.icon;
            return (
              <Link
                key={route.href}
                href={route.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-200",
                  isActive
                    ? "bg-gradient-to-r from-primary/15 via-primary/8 to-transparent text-foreground border border-primary/25 shadow-[0_0_16px_-3px_rgba(99,102,241,0.25)] font-bold"
                    : "text-muted-foreground/80 hover:text-foreground hover:bg-white/[0.04] border border-transparent"
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-gradient-to-b from-indigo-400 to-purple-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                )}
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
                    isActive ? "text-primary drop-shadow-[0_0_8px_rgba(99,102,241,0.6)]" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                <span className="truncate">{route.label}</span>
                {isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom Live System Status Section */}
      <div className="p-3 border-t border-white/5 bg-slate-950/40">
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 backdrop-blur-md">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[11px] font-semibold text-foreground">Quant Core v5.1</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
              ONLINE
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
            <span>Latency: ~18ms</span>
            <span className="text-muted-foreground/70">NSE Feed: LIVE</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

