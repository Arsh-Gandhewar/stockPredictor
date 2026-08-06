'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Newspaper, Rss, Clock } from 'lucide-react';

export default function NewsPage() {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
          Financial News
        </h1>
        <p className="text-muted-foreground text-lg">
          Latest updates, analysis, and breaking news from the global markets.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center text-xl">
                <Newspaper className="h-5 w-5 mr-2 text-primary" />
                Latest Headlines
              </CardTitle>
              <CardDescription>Top stories driving the markets today</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="group relative flex flex-col items-start justify-between rounded-lg border p-4 hover:bg-accent transition-colors cursor-pointer">
                  <div className="flex items-center text-sm text-muted-foreground mb-2">
                    <span className="font-semibold text-primary">Market Update</span>
                    <span className="mx-2">•</span>
                    <Clock className="h-3 w-3 mr-1" />
                    {i * 2} hours ago
                  </div>
                  <h3 className="text-lg font-semibold group-hover:text-primary transition-colors">
                    Global Markets Rally as Tech Sector Shows Unexpected Growth in Q3
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                    Investors are showing renewed optimism as major technology firms report earnings that exceed analyst expectations, suggesting the sector's growth is far from slowing down despite earlier macroeconomic headwinds.
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-primary/20 bg-primary/5 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center text-xl text-primary">
                <Rss className="h-5 w-5 mr-2" />
                Live Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[400px] flex items-center justify-center border-t border-primary/10">
              <span className="text-muted-foreground flex flex-col items-center gap-2">
                <Rss className="h-8 w-8 opacity-50" />
                Live news integration coming soon...
              </span>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
