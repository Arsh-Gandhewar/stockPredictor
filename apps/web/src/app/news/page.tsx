'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Newspaper, Rss, Clock, ExternalLink, TrendingUp, TrendingDown, Tag, Search, ArrowRight, X, Loader2, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMarketNews, MarketNewsItem } from '@/hooks/use-stock';

export default function NewsPage() {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeArticle, setActiveArticle] = useState<MarketNewsItem | null>(null);

  const categories = ['ALL', 'Markets', 'Corporate', 'Results', 'Macro'];
  const { data: newsItems, isLoading, isError, refetch } = useMarketNews(selectedCategory, searchQuery);

  const getSentimentBadge = (sentiment: string) => {
    switch (sentiment) {
      case 'POSITIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
            <TrendingUp className="h-3 w-3" /> Bullish Impact
          </span>
        );
      case 'NEGATIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
            <TrendingDown className="h-3 w-3" /> Bearish Headwind
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground border border-border/40">
            Neutral Horizon
          </span>
        );
    }
  };

  const getImpactBadge = (impact: string) => {
    switch (impact) {
      case 'HIGH':
        return <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-extrabold">High Impact</span>;
      case 'MEDIUM':
        return <span className="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground text-[10px] font-semibold">Medium Impact</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground/80 text-[10px] font-normal">Low Impact</span>;
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              Live Indian Market News & Catalysts
            </h1>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE STREAM
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time financial reporting, RBI macroeconomic developments, and corporate announcements analyzed for equity impact.
          </p>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                selectedCategory === cat
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground border border-border/40'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search news or stock..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-muted/40 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* News Feed Grid */}
      {isError ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <div className="p-3 rounded-full bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="text-center">
            <h3 className="font-bold text-foreground">Failed to load news</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-4">Please try again or check your connection.</p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold shadow-sm hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
          <span className="text-xs text-muted-foreground">Streaming live market news feed...</span>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(newsItems || []).map((item) => (
            <Card
              key={item.id}
              onClick={() => setActiveArticle(item)}
              className="bg-card/70 border-border/50 hover:border-primary/40 hover:bg-card transition-all cursor-pointer shadow-sm flex flex-col justify-between group"
            >
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-semibold">
                    <Rss className="h-3 w-3 text-primary" />
                    <span>{item.source}</span>
                    <span>•</span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" /> {item.timeAgo}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {getImpactBadge(item.impact)}
                    {getSentimentBadge(item.sentiment)}
                  </div>
                </div>

                <CardTitle className="text-sm font-bold leading-snug group-hover:text-primary transition-colors line-clamp-2">
                  {item.title}
                </CardTitle>
              </CardHeader>

              <CardContent className="p-4 pt-0 space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>

                <div className="pt-2 border-t border-border/30 flex items-center justify-between text-xs">
                  {item.affectedStock ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/stock/${item.affectedStock}`);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 font-bold text-[10px] border border-primary/20 transition-colors"
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {item.affectedStock.replace('.NS', '')}
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/60 italic">Macro Market</span>
                  )}

                  <span className="text-[10px] text-primary flex items-center gap-1 font-semibold group-hover:underline">
                    Read Analysis <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Article Detail Modal */}
      {activeArticle && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border/60 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-bold text-xs border border-primary/20">
                  {activeArticle.source}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {activeArticle.timeAgo}
                </span>
              </div>
              <button
                onClick={() => setActiveArticle(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-extrabold leading-snug">{activeArticle.title}</h2>
              <div className="flex items-center gap-2">
                {getSentimentBadge(activeArticle.sentiment)}
                {getImpactBadge(activeArticle.impact)}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/40 space-y-2">
              <div className="text-[11px] font-bold text-primary uppercase tracking-wider">
                💡 Why It Matters For Indian Equities
              </div>
              <p className="text-xs text-foreground/90 leading-relaxed font-medium">
                {activeArticle.whyItMatters}
              </p>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>{activeArticle.fullBody || activeArticle.summary}</p>
            </div>

            <div className="pt-3 border-t border-border/40 flex items-center justify-between gap-3">
              {activeArticle.affectedStock && (
                <button
                  onClick={() => {
                    const t = activeArticle.affectedStock;
                    setActiveArticle(null);
                    router.push(`/stock/${t}`);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-sm"
                >
                  Analyze {activeArticle.affectedStock.replace('.NS', '')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
              <a
                href={activeArticle.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 underline ml-auto"
              >
                View Original Story <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
