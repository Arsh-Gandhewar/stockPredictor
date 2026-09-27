'use client';

import { UserButton } from '@clerk/nextjs';
import { Bell, Menu, X, Activity } from 'lucide-react';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { routes } from './Sidebar';
import { cn } from '@/lib/utils';

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="glass-header flex h-16 items-center justify-between px-4 md:px-6 z-40 sticky top-0 border-b border-white/5">
        {/* Mobile menu trigger & Brand logo */}
        <div className="flex items-center gap-3 md:hidden">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors border border-white/5"
            aria-label="Toggle navigation"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex items-center gap-2 font-extrabold text-sm text-gradient-brand">
            <Activity className="h-4 w-4 text-primary animate-pulse" />
            <span>QuantX</span>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="ml-auto flex items-center space-x-2.5">
          <button
            onClick={() => router.push('/alerts')}
            className="relative inline-flex items-center justify-center rounded-xl p-2.5 text-muted-foreground hover:text-foreground border border-white/5 hover:border-white/15 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-200 cursor-pointer"
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
