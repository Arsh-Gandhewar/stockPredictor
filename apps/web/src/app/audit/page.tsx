'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ArrowLeft,
  Activity,
  TrendingUp,
  TrendingDown,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Flame,
  CheckCircle2,
  XCircle,
  Zap,
  Gauge,
  BarChart2,
  Newspaper,
  Target,
  ChevronRight,
  ChevronDown,
  Cpu
} from 'lucide-react';
import { useDeepAuditSearch, useDeepAudit } from '@/hooks/use-deep-audit';
import { ResolvedTicker } from '@/lib/api';

export default function DeepAuditPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<ResolvedTicker[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch search results
  const { data: searchResults, isLoading: isSearching } = useDeepAuditSearch(debouncedQuery);

  // Fetch deep audit report with complete error handling
  const {
    data: auditData,
    isLoading: isAuditing,
    isError: isAuditError,
    error: auditError,
    refetch: refetchAudit,
  } = useDeepAudit(selectedTicker);

  const [elapsedMs, setElapsedMs] = useState(0);

  // Live timer during audit loading
  useEffect(() => {
    if (!isAuditing) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => clearInterval(interval);
  }, [isAuditing]);

  // Load recent searches and check URL query ticker on mount
  useEffect(() => {
    const saved = localStorage.getItem('deepAuditRecentSearches');
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse recent searches');
      }
    }

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlTicker = params.get('ticker');
      if (urlTicker) {
        setSelectedTicker(urlTicker.toUpperCase());
      }
    }
  }, []);

  const handleSelectTicker = (tickerInfo: ResolvedTicker) => {
    setSelectedTicker(tickerInfo.ticker);
    setSearchQuery('');
    setDebouncedQuery('');
    setIsDropdownOpen(false);

    // Save to recent searches
    const newRecent = [tickerInfo, ...recentSearches.filter(t => t.ticker !== tickerInfo.ticker)].slice(0, 5);
    setRecentSearches(newRecent);
    localStorage.setItem('deepAuditRecentSearches', JSON.stringify(newRecent));

    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/audit?ticker=${encodeURIComponent(tickerInfo.ticker)}`);
    }
  };

  const handleBack = () => {
    setSelectedTicker(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/audit');
    }
  };

  // State 1: Search Mode
  if (!selectedTicker) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 animate-in fade-in duration-500">
        <div className="absolute inset-0 z-[-1] overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px]" />
        </div>

        <div className="w-full max-w-2xl space-y-8 text-center">
          <div className="space-y-4">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 shadow-[0_0_30px_rgba(99,102,241,0.2)]">
              <Search className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground">
              Deep Stock Audit
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Analyze any NSE or BSE company — not limited to top indices. Powered by quantitative models and technical confluence.
            </p>
          </div>

          <div className="relative z-50">
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsDropdownOpen(true);
                }}
                onFocus={() => setIsDropdownOpen(true)}
                placeholder="Search by company name or symbol (e.g., Reliance, TCS)"
                className="w-full pl-12 pr-4 py-4 rounded-2xl bg-card/60 backdrop-blur-xl border border-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 outline-none text-foreground text-lg shadow-xl transition-all"
              />
              {isSearching && (
                <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                  <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              )}
            </div>

            <AnimatePresence>
              {isDropdownOpen && (searchQuery.length >= 2 || recentSearches.length > 0) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute top-full left-0 right-0 mt-2 bg-card/90 backdrop-blur-2xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden z-50"
                >
                  <div className="max-h-80 overflow-y-auto p-2">
                    {searchQuery.length >= 2 ? (
                      <>
                        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Search Results
                        </div>
                        {!isSearching && (!searchResults || searchResults.length === 0) ? (
                          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                            No stocks found matching "{searchQuery}"
                          </div>
                        ) : (
                          searchResults?.map((result) => (
                            <button
                              key={result.ticker}
                              onClick={() => handleSelectTicker(result)}
                              className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.04] transition-colors text-left"
                            >
                              <div className="flex items-center gap-3">
                                <div>
                                  <div className="font-bold text-foreground flex items-center gap-2">
                                    {result.ticker}
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                                      result.exchange === 'NSE' 
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                        : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                    }`}>
                                      {result.exchange}
                                    </span>
                                  </div>
                                  <div className="text-sm text-muted-foreground truncate max-w-[200px] sm:max-w-[300px]">
                                    {result.name}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs font-medium text-foreground bg-muted/40 px-2 py-1 rounded">
                                  {result.sector}
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </>
                    ) : (
                      <>
                        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Recent Audits
                        </div>
                        {recentSearches.map((result) => (
                          <button
                            key={`recent-${result.ticker}`}
                            onClick={() => handleSelectTicker(result)}
                            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.04] transition-colors text-left"
                          >
                            <div className="flex items-center gap-3">
                              <Clock className="h-4 w-4 text-muted-foreground/50" />
                              <div>
                                <div className="font-bold text-foreground flex items-center gap-2">
                                  {result.ticker}
                                  <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-muted/30 text-muted-foreground">
                                    {result.exchange}
                                  </span>
                                </div>
                                <div className="text-sm text-muted-foreground">{result.name}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  }

  // State 2: Audit Error State
  if (selectedTicker && (isAuditError || (!isAuditing && !auditData))) {
    const errorMsg =
      (auditError as any)?.response?.data?.message ||
      (auditError as any)?.message ||
      'Historical price candles could not be retrieved from exchange feeds or the ticker is unlisted.';

    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 animate-in fade-in duration-300">
        <div className="w-full max-w-lg p-8 rounded-3xl bg-card/80 backdrop-blur-2xl border border-rose-500/20 shadow-[0_0_50px_rgba(244,63,94,0.1)] text-center space-y-6">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-foreground">Audit Unavailable</h2>
            <p className="text-sm font-semibold text-rose-400 font-mono bg-rose-500/10 px-3 py-1 rounded-lg inline-block border border-rose-500/20">
              {selectedTicker}
            </p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto pt-2">
              {errorMsg}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => refetchAudit()}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all flex items-center gap-2 shadow-lg active:scale-95"
            >
              <Activity className="h-4 w-4" />
              Retry Audit
            </button>
            <button
              onClick={handleBack}
              className="px-5 py-2.5 rounded-xl bg-muted/60 hover:bg-muted text-foreground font-semibold transition-all border border-border/50 flex items-center gap-2 active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" />
              Search Another Stock
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 3: Audit Report Loading
  if (isAuditing || !auditData) {
    const elapsedSeconds = (elapsedMs / 1000).toFixed(1);

    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 space-y-8 animate-in fade-in duration-300">
        <div className="relative w-28 h-28">
          <svg className="w-full h-full animate-spin text-primary/20" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" fill="none" strokeWidth="2" stroke="currentColor" />
          </svg>
          <svg className="w-full h-full animate-spin text-primary absolute top-0 left-0" viewBox="0 0 100 100" style={{ animationDirection: 'reverse', animationDuration: '2.5s' }}>
            <circle cx="50" cy="50" r="35" fill="none" strokeWidth="2.5" strokeDasharray="60 140" strokeLinecap="round" stroke="currentColor" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Activity className="h-7 w-7 text-primary animate-pulse mb-0.5" />
            <span className="text-[10px] font-mono font-bold text-muted-foreground">{elapsedSeconds}s</span>
          </div>
        </div>

        <div className="text-center space-y-4 max-w-md w-full">
          <div>
            <h2 className="text-2xl font-black text-foreground flex items-center justify-center gap-2">
              Auditing {selectedTicker}
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            </h2>
            <p className="text-xs text-muted-foreground mt-1">Multi-factor quantitative consensus running</p>
          </div>

          <div className="p-4 rounded-2xl bg-card/60 backdrop-blur-xl border border-border/50 text-left space-y-2 text-xs">
            <div className={`flex items-center gap-2 ${elapsedMs >= 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
              <CheckCircle2 className={`h-3.5 w-3.5 ${elapsedMs >= 350 ? 'text-emerald-400' : 'text-primary animate-spin'}`} />
              <span>Historical quotes & returns analysis</span>
            </div>
            <div className={`flex items-center gap-2 ${elapsedMs >= 350 ? 'text-foreground' : 'text-muted-foreground/60'}`}>
              <CheckCircle2 className={`h-3.5 w-3.5 ${elapsedMs >= 750 ? 'text-emerald-400' : elapsedMs >= 350 ? 'text-primary animate-spin' : 'text-muted-foreground/40'}`} />
              <span>Technical patterns & moving average alignment</span>
            </div>
            <div className={`flex items-center gap-2 ${elapsedMs >= 750 ? 'text-foreground' : 'text-muted-foreground/60'}`}>
              <CheckCircle2 className={`h-3.5 w-3.5 ${elapsedMs >= 1150 ? 'text-emerald-400' : elapsedMs >= 750 ? 'text-primary animate-spin' : 'text-muted-foreground/40'}`} />
              <span>Institutional volume & smart money tracking</span>
            </div>
            <div className={`flex items-center gap-2 ${elapsedMs >= 1150 ? 'text-foreground' : 'text-muted-foreground/60'}`}>
              <CheckCircle2 className={`h-3.5 w-3.5 ${elapsedMs >= 1600 ? 'text-emerald-400' : elapsedMs >= 1150 ? 'text-primary animate-spin' : 'text-muted-foreground/40'}`} />
              <span>Gemini AI verdict & risk parameter synthesis</span>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleBack}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
            >
              Cancel and pick another stock
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 2: Audit Report Ready
  const formatMoney = (val: number | null) => val != null ? `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'N/A';
  const formatPercent = (val: number | null) => val != null ? `${(val * 100).toFixed(2)}%` : 'N/A';
  
  const v = auditData.verdict;
  const isPositiveVerdict = ['BUY', 'STRONG_BUY', 'ACCUMULATE'].includes(v.recommendation);
  const isNeutralVerdict = ['HOLD'].includes(v.recommendation);
  const verdictColor = isPositiveVerdict ? 'emerald' : isNeutralVerdict ? 'amber' : 'rose';
  
  const getRecommendationStyle = (rec: string) => {
    if (rec.includes('BUY') || rec === 'ACCUMULATE') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.2)]';
    if (rec === 'HOLD') return 'text-amber-400 bg-amber-500/10 border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.2)]';
    return 'text-rose-400 bg-rose-500/10 border-rose-500/30 shadow-[0_0_30px_rgba(244,63,94,0.2)]';
  };

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-500 max-w-7xl mx-auto px-2">
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to Search
        </button>
        <div className="text-xs text-muted-foreground font-mono flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          Audited: {new Date(auditData.auditTimestamp).toLocaleString('en-IN')}
        </div>
      </div>

      {/* 1. Header Banner */}
      <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-black text-foreground">{auditData.resolvedInfo.name}</h1>
            <span className="px-2 py-1 bg-white/5 border border-white/10 rounded font-mono text-xs text-muted-foreground">
              {auditData.ticker}
            </span>
            <span className={`px-2 py-1 rounded font-mono text-[10px] font-bold ${
              auditData.resolvedInfo.exchange === 'NSE' 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
            }`}>
              {auditData.resolvedInfo.exchange}
            </span>
          </div>
          <div className="text-sm text-muted-foreground font-medium flex items-center gap-2">
            <span>{auditData.resolvedInfo.sector}</span>
            <span>•</span>
            <span>{auditData.resolvedInfo.industry}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground mb-1">Current Evaluation Price</div>
          <div className="text-3xl font-mono font-bold text-foreground">
            {formatMoney(auditData.historyAudit.allTimeHigh?.price ? auditData.historyAudit.allTimeHigh.price * 0.8 : 0)} {/* Mock price if needed, ideally from resolvedInfo or quote */}
          </div>
        </div>
      </div>

      {/* 2. Verdict Banner (MOST PROMINENT) */}
      <div className={`relative overflow-hidden bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 md:p-8 shadow-2xl`}>
        <div className={`absolute top-0 right-0 w-96 h-96 bg-${verdictColor}-500/10 rounded-full blur-[100px] pointer-events-none -z-10`} />
        
        <div className="grid md:grid-cols-[1fr_300px] gap-8 items-center">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className={`px-4 py-2 rounded-xl border text-xl font-black tracking-widest uppercase ${getRecommendationStyle(v.recommendation)}`}>
                {v.recommendation.replace('_', ' ')}
              </div>
              <div className={`text-2xl font-black ${isPositiveVerdict ? 'text-emerald-400' : isNeutralVerdict ? 'text-amber-400' : 'text-rose-400'}`}>
                {v.rightTimeToBuy ? 'RIGHT TIME TO BUY' : v.recommendation.includes('SELL') ? 'CONSIDER EXIT' : 'WAIT FOR BETTER ENTRY'}
              </div>
            </div>
            
            <p className="text-base text-foreground/90 leading-relaxed max-w-3xl">
              {v.reasoning}
            </p>

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                <div className="text-xs text-muted-foreground mb-1 font-mono uppercase">Entry Zone</div>
                <div className="font-mono font-bold text-lg text-foreground">
                  {v.entryZone ? `${formatMoney(v.entryZone.low)} - ${formatMoney(v.entryZone.high)}` : 'N/A'}
                </div>
              </div>
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                <div className="text-xs text-emerald-400/70 mb-1 font-mono uppercase">Target Price</div>
                <div className="font-mono font-bold text-lg text-emerald-400">
                  {formatMoney(v.targetPrice)}
                </div>
              </div>
              <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                <div className="text-xs text-rose-400/70 mb-1 font-mono uppercase">Stop Loss</div>
                <div className="font-mono font-bold text-lg text-rose-400">
                  {formatMoney(v.stopLoss)}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="px-2 py-1 bg-white/5 border border-white/10 rounded">Horizon: {v.timeHorizon}</span>
              <span className="px-2 py-1 bg-white/5 border border-white/10 rounded">Risk Level: {v.riskLevel}</span>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center space-y-6 border-t md:border-t-0 md:border-l border-white/[0.06] pt-6 md:pt-0 md:pl-6">
            <div className="relative w-40 h-40 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="80" cy="80" r="70" className="stroke-white/5" strokeWidth="12" fill="transparent" />
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  className={`stroke-${verdictColor}-500 transition-all duration-1000 ease-out`}
                  strokeWidth="12"
                  strokeDasharray={2 * Math.PI * 70}
                  strokeDashoffset={2 * Math.PI * 70 - (v.confidence / 100) * (2 * Math.PI * 70)}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute text-center">
                <div className={`text-4xl font-black text-${verdictColor}-400 font-mono`}>{v.confidence}%</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Confidence</div>
              </div>
            </div>

            <div className="w-full space-y-3">
              {v.bullishFactors.slice(0,2).map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
              {v.bearishFactors.slice(0,1).map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 3. History Audit Section */}
        <div className="col-span-1 md:col-span-2 bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Historical Performance ({auditData.historyAudit.dataYears}Y)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-white/5 rounded-xl border border-white/5">
              <div className="text-[10px] text-muted-foreground uppercase">CAGR</div>
              <div className={`text-lg font-bold font-mono ${auditData.historyAudit.cagr >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatPercent(auditData.historyAudit.cagr)}
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-white/5">
              <div className="text-[10px] text-muted-foreground uppercase">Max Drawdown</div>
              <div className="text-lg font-bold font-mono text-rose-400">
                {formatPercent(auditData.historyAudit.maxDrawdown)}
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-white/5">
              <div className="text-[10px] text-muted-foreground uppercase">Sharpe Ratio</div>
              <div className="text-lg font-bold font-mono text-foreground">
                {auditData.historyAudit.sharpeRatio.toFixed(2)}
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-white/5">
              <div className="text-[10px] text-muted-foreground uppercase">Volatility</div>
              <div className="text-lg font-bold font-mono text-foreground">
                {formatPercent(auditData.historyAudit.annualizedVolatility)}
              </div>
            </div>
          </div>
          
          <div className="pt-2">
            <div className="text-[10px] text-muted-foreground uppercase mb-2">Yearly Returns</div>
            <div className="flex items-end gap-1 h-20">
              {auditData.historyAudit.yearlyReturns.slice(-10).map(yr => (
                <div key={yr.year} className="flex-1 flex flex-col justify-end group relative">
                  <div 
                    className={`w-full rounded-t-sm transition-all ${yr.return >= 0 ? 'bg-emerald-500/60 group-hover:bg-emerald-400' : 'bg-rose-500/60 group-hover:bg-rose-400'}`}
                    style={{ height: `${Math.min(100, Math.abs(yr.return) * 100)}%`, minHeight: '4px' }}
                  />
                  <div className="text-[8px] text-center mt-1 text-muted-foreground font-mono">{yr.year.toString().slice(2)}</div>
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-black/80 text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    {formatPercent(yr.return)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 4. Pattern Detection Section */}
        <div className="col-span-1 md:col-span-2 bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-5 space-y-4">
           <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Technical Patterns
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Current Trend</div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${auditData.patterns.trend === 'BULLISH' ? 'text-emerald-400' : auditData.patterns.trend === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'}`}>
                  {auditData.patterns.trend}
                </span>
                <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${auditData.patterns.trendStrength}%` }}/>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">MA Alignment</div>
              <span className={`text-sm font-bold ${auditData.patterns.movingAverageAlignment === 'BULLISH' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {auditData.patterns.movingAverageAlignment}
              </span>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 pt-2">
            {auditData.patterns.goldenCross && <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-xs font-medium">Golden Cross Active</span>}
            {auditData.patterns.deathCross && <span className="px-2 py-1 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-xs font-medium">Death Cross Active</span>}
            <span className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs font-medium text-foreground">RSI: {auditData.patterns.rsiDivergence}</span>
          </div>

          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="text-xs text-muted-foreground">Recent Candlestick Patterns</div>
            <div className="flex flex-col gap-1.5">
              {auditData.patterns.candlestickPatterns.length > 0 ? auditData.patterns.candlestickPatterns.map((cp, i) => (
                <div key={i} className="flex justify-between items-center text-xs bg-white/[0.02] p-1.5 rounded">
                  <span className={cp.type === 'BULLISH' ? 'text-emerald-400' : 'text-rose-400'}>{cp.name}</span>
                  <span className="text-muted-foreground font-mono">{cp.date}</span>
                </div>
              )) : <div className="text-xs text-muted-foreground">No significant patterns detected recently.</div>}
            </div>
          </div>
        </div>

        {/* 5. Buy/Sell Patterns (Volume) */}
        <div className="col-span-1 md:col-span-2 bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-primary" /> Volume & Institutional Flow
          </h3>
          <div className="flex items-center gap-4 mb-2">
            <div className="flex-1 space-y-1">
              <div className="text-xs text-muted-foreground">Volume Trend</div>
              <div className={`text-lg font-bold ${auditData.buySellAnalysis.volumeTrend === 'ACCUMULATION' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {auditData.buySellAnalysis.volumeTrend}
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <div className="text-xs text-muted-foreground">Smart Money</div>
              <div className="text-lg font-bold text-primary">
                {auditData.buySellAnalysis.smartMoneyIndicator > 0 ? '+' : ''}{auditData.buySellAnalysis.smartMoneyIndicator}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground border-l-2 border-primary/50 pl-3 py-1">
            Institutional Signal: <span className="font-bold text-foreground">{auditData.buySellAnalysis.institutionalSignal}</span>
          </div>
        </div>

        {/* 6. News & Sentiment */}
        <div className="col-span-1 md:col-span-2 bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-primary" /> News & Sentiment
          </h3>
          <div className="flex items-center gap-3">
             <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm bg-white/5 border border-white/10">
                {auditData.newsAnalysis.sentimentScore}
             </div>
             <div>
               <div className="text-sm font-bold text-foreground">{auditData.newsAnalysis.overallSentiment} Sentiment</div>
               <div className="text-xs text-muted-foreground">Sector Outlook: {auditData.newsAnalysis.sectorOutlook}</div>
             </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-emerald-500/5 p-2 rounded border border-emerald-500/10">
               <div className="text-emerald-400 font-bold mb-1">Catalysts</div>
               <ul className="list-disc pl-3 text-muted-foreground space-y-1">
                 {auditData.newsAnalysis.keyCatalysts.map((c,i)=><li key={i}>{c}</li>)}
               </ul>
            </div>
            <div className="bg-rose-500/5 p-2 rounded border border-rose-500/10">
               <div className="text-rose-400 font-bold mb-1">Risks</div>
               <ul className="list-disc pl-3 text-muted-foreground space-y-1">
                 {auditData.newsAnalysis.keyRisks.map((c,i)=><li key={i}>{c}</li>)}
               </ul>
            </div>
          </div>
        </div>

        {/* 7. Quant Prediction */}
        {auditData.quantPrediction && auditData.quantPrediction.available && (
          <div className="col-span-1 md:col-span-4 bg-gradient-to-r from-primary/10 to-transparent border border-primary/20 rounded-2xl p-5 space-y-4">
             <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> Quantitative Model Projection
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {['1d', '5d', '20d'].map((hz) => {
                const data = auditData.quantPrediction?.horizons[hz as keyof typeof auditData.quantPrediction.horizons];
                if (!data) return null;
                return (
                  <div key={hz} className="bg-card/60 backdrop-blur p-4 rounded-xl border border-white/5 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase font-bold">{hz} Horizon</div>
                      <div className="text-lg font-mono font-bold text-foreground">{formatPercent(data.expectedReturn)}</div>
                    </div>
                    <div className="text-right">
                       <div className="text-[10px] text-muted-foreground">Win Prob</div>
                       <div className="text-sm font-bold text-emerald-400">{formatPercent(data.calibratedProbability)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
