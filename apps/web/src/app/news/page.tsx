'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Newspaper,
  Rss,
  Clock,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Tag,
  Search,
  ArrowRight,
  X,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Globe2,
  Building2,
  BarChart3,
  Landmark,
  Layers,
  Sparkles,
  Flame,
  Minus,
  CheckCircle2,
  ChevronRight
} from 'lucide-react';
import { useMarketNews, MarketNewsItem } from '@/hooks/use-stock';

export default function NewsPage() {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [sentimentFilter, setSentimentFilter] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeArticle, setActiveArticle] = useState<MarketNewsItem | null>(null);

  const categories = [
    { id: 'ALL', label: 'All Wire', icon: Globe2 },
    { id: 'Markets', label: 'Markets', icon: TrendingUp },
    { id: 'Corporate', label: 'Corporate', icon: Building2 },
    { id: 'Results', label: 'Earnings & Results', icon: BarChart3 },
    { id: 'Macro', label: 'RBI & Macro', icon: Landmark },
  ];

  const { data: rawNewsItems, isLoading, isError, refetch, isRefetching } = useMarketNews(
    selectedCategory === 'ALL' ? undefined : selectedCategory,
    searchQuery || undefined
  );

  // Filter by sentiment if selected
  const newsItems = useMemo(() => {
    if (!rawNewsItems) return [];
    if (sentimentFilter === 'ALL') return rawNewsItems;
    return rawNewsItems.filter((item) => item.sentiment === sentimentFilter);
  }, [rawNewsItems, sentimentFilter]);

  // Sentiment distribution analytics
  const telemetry = useMemo(() => {
    if (!rawNewsItems || rawNewsItems.length === 0) {
      return { total: 0, positive: 0, negative: 0, neutral: 0, highImpact: 0, bullishPercent: 0 };
    }
    const total = rawNewsItems.length;
    const positive = rawNewsItems.filter((i) => i.sentiment === 'POSITIVE').length;
    const negative = rawNewsItems.filter((i) => i.sentiment === 'NEGATIVE').length;
    const neutral = rawNewsItems.filter((i) => i.sentiment === 'NEUTRAL').length;
    const highImpact = rawNewsItems.filter((i) => i.impact === 'HIGH').length;
    const bullishPercent = Math.round((positive / total) * 100);

    return { total, positive, negative, neutral, highImpact, bullishPercent };
  }, [rawNewsItems]);

  const getSentimentBadge = (sentiment: string) => {
    switch (sentiment) {
      case 'POSITIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]">
            <TrendingUp className="h-3 w-3 text-emerald-400" /> Bullish Impact
          </span>
        );
      case 'NEGATIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 shadow-[0_0_8px_rgba(244,63,94,0.15)]">
            <TrendingDown className="h-3 w-3 text-rose-400" /> Bearish Headwind
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
            <Minus className="h-3 w-3 text-slate-400" /> Neutral Horizon
          </span>
        );
    }
  };

  const getImpactBadge = (impact: string) => {
    switch (impact) {
      case 'HIGH':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-extrabold tracking-wide">
            <Flame className="h-3 w-3 text-amber-400" /> HIGH IMPACT
          </span>
        );
      case 'MEDIUM':
        return (
          <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-[10px] font-semibold">
            MEDIUM IMPACT
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-md bg-white/5 text-muted-foreground border border-white/10 text-[10px]">
            LOW IMPACT
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* ── Institutional Header & Telemetry Beacon ── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-slate-900/80 via-slate-950/90 to-black p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/4 -mb-20 w-72 h-72 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="p-2 rounded-xl bg-primary/10 border border-primary/25 text-primary">
                <Newspaper className="h-5 w-5" />
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70">
                Financial News & Sentiment Analysis
              </h1>

              {/* Active Wire Beacon */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span>LIVE WIRE CONNECTED</span>
                <span className="text-[9px] text-emerald-400/70 border-l border-emerald-500/30 pl-1.5 font-mono">
                  NSE / BSE
                </span>
              </div>
            </div>

            <p className="text-xs md:text-sm text-muted-foreground/80 max-w-2xl leading-relaxed">
              Real-time institutional newsfeed parsing corporate earnings, regulatory circulars, and macroeconomic catalysts with automated equity sentiment tagging.
            </p>
          </div>

          {/* Wire Refresh CTA */}
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="group relative inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900/80 hover:bg-slate-800 text-foreground border border-white/10 hover:border-white/20 shadow-lg transition-all self-start md:self-auto cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-primary ${isRefetching ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
            <span>{isRefetching ? 'Syncing Wire...' : 'Refresh Wire'}</span>
          </button>
        </div>

        {/* Telemetry Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/5">
          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase">Live Wire Headlines</span>
              <Rss className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="text-xl md:text-2xl font-black font-mono tracking-tight text-foreground tabular-nums">
              {telemetry.total}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">Dispatched past 24h</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase">Bullish Bias</span>
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="text-xl md:text-2xl font-black font-mono tracking-tight text-emerald-400 tabular-nums">
              {telemetry.bullishPercent}%
            </div>
            <div className="text-[10px] text-emerald-400/60 mt-0.5">
              {telemetry.positive} positive catalysts
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase">Bearish Headwinds</span>
              <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
            </div>
            <div className="text-xl md:text-2xl font-black font-mono tracking-tight text-rose-400 tabular-nums">
              {telemetry.negative}
            </div>
            <div className="text-[10px] text-rose-400/60 mt-0.5">Downside catalysts</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase">High Impact Alerts</span>
              <Flame className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="text-xl md:text-2xl font-black font-mono tracking-tight text-amber-400 tabular-nums">
              {telemetry.highImpact}
            </div>
            <div className="text-[10px] text-amber-400/60 mt-0.5">Material market drivers</div>
          </div>
        </div>
      </div>

      {/* ── Filter Tabs & Institutional Search Bar ── */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-slate-900/60 border border-white/5 backdrop-blur-md">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-primary to-indigo-600 text-white shadow-md shadow-primary/25'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search & Sentiment Quick Toggles */}
        <div className="flex items-center gap-2">
          {/* Sentiment Filter Toggle */}
          <div className="flex items-center p-1 rounded-xl bg-slate-900/60 border border-white/5">
            <button
              onClick={() => setSentimentFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                sentimentFilter === 'ALL'
                  ? 'bg-white/10 text-foreground font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSentimentFilter('POSITIVE')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                sentimentFilter === 'POSITIVE'
                  ? 'bg-emerald-500/20 text-emerald-400 font-bold'
                  : 'text-muted-foreground hover:text-emerald-400'
              }`}
            >
              <TrendingUp className="h-3 w-3" />
              Bullish
            </button>
            <button
              onClick={() => setSentimentFilter('NEGATIVE')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                sentimentFilter === 'NEGATIVE'
                  ? 'bg-rose-500/20 text-rose-400 font-bold'
                  : 'text-muted-foreground hover:text-rose-400'
              }`}
            >
              <TrendingDown className="h-3 w-3" />
              Bearish
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search wire or ticker..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-8 text-xs rounded-xl bg-slate-900/60 border border-white/10 focus:border-primary/60 focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60 transition-all font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── News Feed Grid ── */}
      {isError ? (
        <Card className="border-rose-500/20 bg-slate-950/70 p-12 text-center rounded-2xl shadow-xl">
          <div className="flex flex-col items-center justify-center space-y-4 max-w-sm mx-auto">
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.15)]">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <div>
              <h3 className="font-bold text-foreground text-sm">Failed to Ingest Wire Feed</h3>
              <p className="text-xs text-muted-foreground mt-1">
                The market news stream encountered a socket or network interruption.
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary/90 transition-colors cursor-pointer"
            >
              Retry Ingestion
            </button>
          </div>
        </Card>
      ) : isLoading ? (
        <div className="flex flex-col items-center justify-center py-28 space-y-3">
          <div className="relative">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="absolute inset-0 blur-lg bg-primary/30 animate-pulse" />
          </div>
          <span className="text-xs text-muted-foreground font-mono tracking-wide">
            STREAMING LIVE FINANCIAL NEWS FEED & SENTIMENT CLASSIFIER...
          </span>
        </div>
      ) : newsItems.length === 0 ? (
        <div className="p-16 text-center rounded-2xl border border-white/5 bg-slate-950/70 backdrop-blur-xl shadow-2xl space-y-3">
          <div className="h-16 w-16 mx-auto rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Newspaper className="h-8 w-8 opacity-60" />
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="text-sm font-bold text-foreground">No Wire Articles Found</h3>
            <p className="text-xs text-muted-foreground mt-1">
              No headlines matched the active filters for category or sentiment. Clear filters to resume live ingest.
            </p>
          </div>
          <button
            onClick={() => {
              setSelectedCategory('ALL');
              setSentimentFilter('ALL');
              setSearchQuery('');
            }}
            className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground text-xs font-semibold transition-colors cursor-pointer"
          >
            Reset All Filters
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {newsItems.map((item) => (
            <Card
              key={item.id}
              onClick={() => setActiveArticle(item)}
              className="group relative overflow-hidden bg-slate-950/70 border-white/5 hover:border-primary/40 hover:bg-slate-900/60 transition-all duration-300 cursor-pointer shadow-xl hover:shadow-2xl hover:translate-y-[-2px] flex flex-col justify-between rounded-2xl"
            >
              <div className="p-5 pb-3 space-y-3">
                {/* Meta Row: Source, Time, Badges */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                    <span className="px-2 py-0.5 rounded-md bg-white/5 text-foreground font-semibold border border-white/10">
                      {item.source}
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground/70">
                      <Clock className="h-3 w-3" /> {item.timeAgo}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {getImpactBadge(item.impact)}
                    {getSentimentBadge(item.sentiment)}
                  </div>
                </div>

                {/* Headline */}
                <h3 className="text-sm font-bold text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2">
                  {item.title}
                </h3>

                {/* Summary */}
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {item.summary}
                </p>

                {/* Mini Strategic Callout */}
                {item.whyItMatters && (
                  <div className="p-2.5 rounded-xl bg-slate-900/80 border border-white/5 text-[11px] text-muted-foreground/90 font-medium leading-relaxed">
                    <span className="text-primary font-bold mr-1">💡 Impact:</span>
                    <span className="line-clamp-2">{item.whyItMatters}</span>
                  </div>
                )}
              </div>

              {/* Footer Row */}
              <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] flex items-center justify-between text-xs mt-2">
                {item.affectedStock ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/stock/${item.affectedStock}`);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 font-bold font-mono text-[11px] border border-primary/20 transition-all cursor-pointer"
                  >
                    <Tag className="h-3 w-3" />
                    <span>{item.affectedStock.replace('.NS', '')}</span>
                    <ChevronRight className="h-3 w-3 opacity-60" />
                  </button>
                ) : (
                  <span className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider">
                    Macro Multi-Equity
                  </span>
                )}

                <span className="text-[11px] text-primary flex items-center gap-1 font-bold group-hover:translate-x-0.5 transition-transform">
                  <span>Read Wire Analysis</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Institutional Article Reader Modal ── */}
      <AnimatePresence>
        {activeArticle && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveArticle(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />

            {/* Modal Card */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-6 md:p-8 shadow-2xl space-y-6"
            >
              {/* Header Bar */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-lg bg-primary/15 text-primary font-bold text-xs border border-primary/30">
                    {activeArticle.source}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {activeArticle.timeAgo}
                  </span>
                  {activeArticle.category && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-muted-foreground border border-white/10">
                      {activeArticle.category}
                    </span>
                  )}
                </div>

                <button
                  onClick={() => setActiveArticle(null)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Title & Sentiments */}
              <div className="space-y-3">
                <h2 className="text-lg md:text-xl font-extrabold text-foreground leading-snug">
                  {activeArticle.title}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {getSentimentBadge(activeArticle.sentiment)}
                  {getImpactBadge(activeArticle.impact)}
                </div>
              </div>

              {/* Why It Matters Callout */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-primary/10 via-indigo-500/5 to-transparent border border-primary/20 space-y-2">
                <div className="text-[11px] font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>Strategic Indian Equities Impact</span>
                </div>
                <p className="text-xs text-foreground/90 leading-relaxed font-medium">
                  {activeArticle.whyItMatters}
                </p>
              </div>

              {/* Full Body / Summary Content */}
              <div className="space-y-3 text-xs text-muted-foreground/90 leading-relaxed font-normal">
                {activeArticle.fullBody ? (
                  activeArticle.fullBody.split('\n\n').map((paragraph, idx) => (
                    <p key={idx} className="leading-relaxed">
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <p className="leading-relaxed">{activeArticle.summary}</p>
                )}
              </div>

              {/* Action Footer */}
              <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-4 flex-wrap">
                {activeArticle.affectedStock && (
                  <button
                    onClick={() => {
                      const t = activeArticle.affectedStock;
                      setActiveArticle(null);
                      router.push(`/stock/${t}`);
                    }}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-indigo-600 text-white font-bold text-xs hover:from-primary/90 hover:to-indigo-600/90 transition-all flex items-center gap-1.5 shadow-lg shadow-primary/20 cursor-pointer"
                  >
                    <span>Launch Stock Terminal ({activeArticle.affectedStock.replace('.NS', '')})</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}

                <a
                  href={activeArticle.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 underline underline-offset-4 ml-auto transition-colors"
                >
                  <span>Read Primary Wire Article</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
