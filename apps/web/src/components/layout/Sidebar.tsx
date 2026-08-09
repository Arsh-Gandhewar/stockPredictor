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
  Activity
} from 'lucide-react';

export const routes = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { label: 'Discover', icon: Compass, href: '/discover' },
  { label: 'Markets', icon: LineChart, href: '/markets' },
  { label: 'Watchlist', icon: Star, href: '/watchlist' },
  { label: 'Portfolio', icon: Wallet, href: '/portfolio' },
  { label: 'News', icon: Newspaper, href: '/news' },
  { label: 'Alerts', icon: BellRing, href: '/alerts' },
  { label: 'Settings', icon: Settings, href: '/settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="hidden md:flex h-full w-64 flex-col bg-card/95 backdrop-blur border-r border-border/50 shadow-sm shrink-0">
      <div className="flex h-16 items-center px-6 font-extrabold text-xl tracking-tight text-primary gap-2">
        <Activity className="h-6 w-6 text-primary animate-pulse" />
        <span>QuantX</span>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="grid gap-1 px-4">
          {routes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-all",
                pathname === route.href 
                  ? "bg-primary/10 text-primary border border-primary/20 shadow-sm" 
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <route.icon className="h-4 w-4 shrink-0" />
              {route.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
