'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Activity, BarChart4, TrendingUp, Compass } from 'lucide-react';

export default function MarketsPage() {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
          Global Markets
        </h1>
        <p className="text-muted-foreground text-lg">
          Explore global indices, sectors, and top movers across the world.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-primary/10 bg-gradient-to-br from-card to-primary/5 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center text-xl">
              <Activity className="h-5 w-5 mr-2 text-primary" />
              Indices Overview
            </CardTitle>
            <CardDescription>Major global market indices</CardDescription>
          </CardHeader>
          <CardContent className="h-[200px] flex items-center justify-center border-t border-border/50">
            <span className="text-muted-foreground flex flex-col items-center gap-2">
              <Compass className="h-8 w-8 opacity-50" />
              Data fetching module coming soon...
            </span>
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-gradient-to-br from-card to-primary/5 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center text-xl">
              <BarChart4 className="h-5 w-5 mr-2 text-primary" />
              Sector Performance
            </CardTitle>
            <CardDescription>Daily returns by sector</CardDescription>
          </CardHeader>
          <CardContent className="h-[200px] flex items-center justify-center border-t border-border/50">
            <span className="text-muted-foreground flex flex-col items-center gap-2">
              <Compass className="h-8 w-8 opacity-50" />
              Data fetching module coming soon...
            </span>
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-gradient-to-br from-card to-primary/5 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center text-xl">
              <TrendingUp className="h-5 w-5 mr-2 text-primary" />
              Top Movers
            </CardTitle>
            <CardDescription>Biggest gainers and losers</CardDescription>
          </CardHeader>
          <CardContent className="h-[200px] flex items-center justify-center border-t border-border/50">
             <span className="text-muted-foreground flex flex-col items-center gap-2">
              <Compass className="h-8 w-8 opacity-50" />
              Data fetching module coming soon...
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
