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
  Star
} from 'lucide-react';

const routes = [
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
    <div className="flex h-full w-64 flex-col bg-card border-r border-border">
      <div className="flex h-16 items-center px-6 font-bold text-xl text-primary tracking-tight">
        QuantX
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="grid gap-1 px-4">
          {routes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === route.href 
                  ? "bg-primary/10 text-primary" 
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <route.icon className="h-4 w-4" />
              {route.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
