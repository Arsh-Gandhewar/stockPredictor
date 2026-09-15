'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import {
  Bell,
  Plus,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Search,
  Activity,
  CheckCircle2,
  Clock,
  Sparkles,
  TrendingUp,
  TrendingDown,
  X,
  Radio,
  ExternalLink,
  Target,
  SlidersHorizontal,
  ChevronRight
} from 'lucide-react';
import { useAlerts, useCreateAlert, useDeleteAlert, useAllStocks, AlertItem } from '@/hooks/use-stock';

export default function AlertsPage() {
  const router = useRouter();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState('RELIANCE.NS');
  const [targetPrice, setTargetPrice] = useState('1450');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCondition, setFilterCondition] = useState<'ALL' | 'ABOVE' | 'BELOW'>('ALL');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: alerts, isLoading } = useAlerts();
  const { data: stocks } = useAllStocks();
  const createMutation = useCreateAlert();
  const deleteMutation = useDeleteAlert();

  // Stock lookup dictionary for fast name lookup
  const stockMap = useMemo(() => {
    const map = new Map<string, { name: string; exchange: string }>();
    if (stocks) {
      for (const s of stocks) {
        map.set(s.ticker, { name: s.name, exchange: s.exchange });
      }
    }
    return map;
  }, [stocks]);

  // Telemetry KPIs
  const totalAlerts = alerts?.length || 0;
  const aboveAlerts = alerts?.filter((a) => a.condition === 'ABOVE').length || 0;
  const belowAlerts = alerts?.filter((a) => a.condition === 'BELOW').length || 0;
  const uniqueTickers = alerts ? new Set(alerts.map((a) => a.ticker)).size : 0;

  // Filtered alerts
  const filteredAlerts = useMemo(() => {
    if (!alerts) return [];
    return alerts.filter((item) => {
      const matchesSearch =
        item.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (stockMap.get(item.ticker)?.name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCondition =
        filterCondition === 'ALL' || item.condition === filterCondition;
      return matchesSearch && matchesCondition;
    });
  }, [alerts, searchQuery, filterCondition, stockMap]);

  const handleCreate = () => {
    const price = parseFloat(targetPrice);
    if (!targetPrice || isNaN(price) || price <= 0) return;
    createMutation.mutate(
      {
        ticker: selectedTicker,
        targetPrice: price,
        condition,
      },
      {
        onSuccess: () => {
          setIsCreateOpen(false);
        },
      }
    );
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    deleteMutation.mutate(id, {
      onSettled: () => setDeletingId(null),
    });
  };

  // Quick select ticker presets
  const popularTickers = [
    { ticker: 'RELIANCE.NS', label: 'RELIANCE' },
    { ticker: 'TCS.NS', label: 'TCS' },
    { ticker: 'HDFCBANK.NS', label: 'HDFCBANK' },
    { ticker: 'INFY.NS', label: 'INFY' },
    { ticker: 'ICICIBANK.NS', label: 'ICICIBANK' },
  ];

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* ── Institutional Header & Telemetry Beacon ── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-slate-900/80 via-slate-950/90 to-black p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-20 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="p-2 rounded-xl bg-primary/10 border border-primary/25 text-primary">
                <Bell className="h-5 w-5 animate-bounce duration-1000" />
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70">
                Real-Time Price & Breakout Alerts
              </h1>

              {/* Active Monitoring Beacon */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span>ACTIVE MONITOR BEACON</span>
                <span className="text-[9px] text-emerald-400/70 border-l border-emerald-500/30 pl-1.5 font-mono">
                  5S REFRESH
                </span>
              </div>
            </div>

            <p className="text-xs md:text-sm text-muted-foreground/80 max-w-2xl leading-relaxed">
              Automated high-frequency threshold triggers and technical breakout sentinels monitored continuously against National Stock Exchange (NSE) order flows.
            </p>
          </div>

          {/* Action Trigger */}
          <button
            onClick={() => setIsCreateOpen(true)}
            className="group relative inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-primary via-indigo-500 to-blue-600 text-white shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all self-start md:self-auto cursor-pointer"
          >
            <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
            <span>Create New Alert</span>
            <span className="h-1.5 w-1.5 rounded-full bg-white/80 animate-pulse" />
          </button>
        </div>

        {/* Telemetry Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/5">
          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase">Active Sentinels</span>
              <Activity className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="text-xl md:text-2xl font-black font-mono tracking-tight text-foreground tabular-nums">
              {totalAlerts}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">Live background polling</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase">Breakout Targets (↑)</span>
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="text-xl md:text-2xl font-black font-mono tracking-tight text-emerald-400 tabular-nums">
              {aboveAlerts}
            </div>
            <div className="text-[10px] text-emerald-400/60 mt-0.5">Resistance breaches</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase">Support Floors (↓)</span>
              <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
            </div>
            <div className="text-xl md:text-2xl font-black font-mono tracking-tight text-rose-400 tabular-nums">
              {belowAlerts}
            </div>
            <div className="text-[10px] text-rose-400/60 mt-0.5">Invalidation thresholds</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/40 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase">Monitored Equities</span>
              <Target className="h-3.5 w-3.5 text-indigo-400" />
            </div>
            <div className="text-xl md:text-2xl font-black font-mono tracking-tight text-indigo-400 tabular-nums">
              {uniqueTickers}
            </div>
            <div className="text-[10px] text-indigo-400/60 mt-0.5">Distinct NSE tickers</div>
          </div>
        </div>
      </div>

      {/* ── Table Filter & Search Controls ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Segmented Filter */}
        <div className="flex items-center p-1 rounded-xl bg-slate-900/60 border border-white/5 backdrop-blur-md self-start">
          <button
            onClick={() => setFilterCondition('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              filterCondition === 'ALL'
                ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All Triggers ({totalAlerts})
          </button>
          <button
            onClick={() => setFilterCondition('ABOVE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
              filterCondition === 'ABOVE'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ArrowUpRight className="h-3 w-3" />
            Above ({aboveAlerts})
          </button>
          <button
            onClick={() => setFilterCondition('BELOW')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
              filterCondition === 'BELOW'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ArrowDownRight className="h-3 w-3" />
            Below ({belowAlerts})
          </button>
        </div>

        {/* Search Filter */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by ticker or name..."
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

      {/* ── Active Alerts Terminal Table ── */}
      <Card className="border border-white/5 bg-slate-950/70 backdrop-blur-xl shadow-2xl overflow-hidden rounded-2xl">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-28 space-y-3">
              <div className="relative">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="absolute inset-0 blur-lg bg-primary/30 animate-pulse" />
              </div>
              <span className="text-xs text-muted-foreground font-mono tracking-wide">
                SYNCHRONIZING ORDERBOOK SENTINELS...
              </span>
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="p-16 text-center space-y-4">
              <div className="h-16 w-16 mx-auto rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_20px_rgba(99,102,241,0.15)]">
                <Bell className="h-8 w-8 opacity-60" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-sm font-bold text-foreground">
                  {searchQuery || filterCondition !== 'ALL' ? 'No Matching Trigger Sentinels' : 'No Active Price Sentinels Configured'}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {searchQuery || filterCondition !== 'ALL'
                    ? 'Adjust your query criteria or filters to locate specific equity thresholds.'
                    : 'Activate real-time monitors to receive instantaneous notifications when price breaches key resistance or support levels.'}
                </p>
              </div>
              {(!searchQuery && filterCondition === 'ALL') && (
                <button
                  onClick={() => setIsCreateOpen(true)}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-all shadow-md inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" /> Initialize First Alert
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-900/60 text-muted-foreground/80 border-b border-white/5 uppercase tracking-wider font-mono text-[10px]">
                    <th className="py-3.5 px-5 font-semibold">Instrument</th>
                    <th className="py-3.5 px-5 font-semibold">Condition Sentinel</th>
                    <th className="py-3.5 px-5 font-semibold text-right">Target Price</th>
                    <th className="py-3.5 px-5 font-semibold">Creation Telemetry</th>
                    <th className="py-3.5 px-5 font-semibold">Engine State</th>
                    <th className="py-3.5 px-5 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredAlerts.map((item: AlertItem) => {
                    const cleanTicker = item.ticker.replace('.NS', '');
                    const stockInfo = stockMap.get(item.ticker);
                    const isDeleting = deletingId === item.id;

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-900/40 transition-colors group"
                      >
                        {/* Instrument */}
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => router.push(`/stock/${item.ticker}`)}
                              className="font-mono font-bold text-sm text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5 cursor-pointer text-left"
                            >
                              <span>{cleanTicker}</span>
                              <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                            </button>
                            {stockInfo?.exchange && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-white/5 text-muted-foreground border border-white/10">
                                {stockInfo.exchange}
                              </span>
                            )}
                          </div>
                          {stockInfo?.name && (
                            <div className="text-[11px] text-muted-foreground/70 truncate max-w-xs mt-0.5">
                              {stockInfo.name}
                            </div>
                          )}
                        </td>

                        {/* Condition Sentinel */}
                        <td className="py-4 px-5">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold text-[11px] tracking-wide border shadow-xs ${
                              item.condition === 'ABOVE'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/25 shadow-[0_0_12px_rgba(244,63,94,0.1)]'
                            }`}
                          >
                            {item.condition === 'ABOVE' ? (
                              <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />
                            )}
                            <span>CROSSES {item.condition}</span>
                          </span>
                        </td>

                        {/* Target Price */}
                        <td className="py-4 px-5 text-right">
                          <div className="font-mono font-black text-sm text-foreground tabular-nums tracking-tight">
                            ₹{item.targetPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <span className="text-[10px] text-muted-foreground/60 font-mono">
                            EXECUTION LIMIT
                          </span>
                        </td>

                        {/* Creation Telemetry */}
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-[11px]">
                            <Clock className="h-3 w-3 text-muted-foreground/60" />
                            <span>{item.createdAt}</span>
                          </div>
                        </td>

                        {/* Engine State */}
                        <td className="py-4 px-5">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold text-[10px] border border-emerald-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>MONITORING</span>
                          </span>
                        </td>

                        {/* Action */}
                        <td className="py-4 px-5 text-right">
                          <button
                            onClick={() => handleDelete(item.id)}
                            disabled={isDeleting}
                            className="p-2 rounded-xl text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all cursor-pointer disabled:opacity-50"
                            title="Disarm and delete sentinel"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Institutional Alert Creation Modal ── */}
      <AnimatePresence>
        {isCreateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCreateOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />

            {/* Modal Card */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-slate-950 p-6 md:p-7 shadow-2xl space-y-5"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
                    <Target className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-foreground">Configure Price Trigger Sentinel</h3>
                    <p className="text-[11px] text-muted-foreground">Orderbook streaming threshold</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsCreateOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form Body */}
              <div className="space-y-4 text-xs">
                {/* Stock Selector */}
                <div className="space-y-1.5">
                  <label className="block text-muted-foreground font-semibold">
                    Monitored Equity
                  </label>
                  <select
                    value={selectedTicker}
                    onChange={(e) => setSelectedTicker(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl bg-slate-900 border border-white/10 font-mono font-bold text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary cursor-pointer text-xs"
                  >
                    {(stocks || []).slice(0, 100).map((s: any) => (
                      <option key={s.ticker} value={s.ticker} className="bg-slate-900 text-foreground py-1">
                        {s.ticker.replace('.NS', '')} — {s.name} ({s.exchange || 'NSE'})
                      </option>
                    ))}
                  </select>

                  {/* Popular quick chips */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    <span className="text-[10px] text-muted-foreground/60 font-mono">QUICK:</span>
                    {popularTickers.map((pt) => (
                      <button
                        key={pt.ticker}
                        type="button"
                        onClick={() => setSelectedTicker(pt.ticker)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                          selectedTicker === pt.ticker
                            ? 'bg-primary/20 text-primary border border-primary/40'
                            : 'bg-white/5 text-muted-foreground hover:text-foreground border border-white/5'
                        }`}
                      >
                        {pt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Segmented Condition Toggle */}
                <div className="space-y-1.5">
                  <label className="block text-muted-foreground font-semibold">
                    Trigger Condition Logic
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setCondition('ABOVE')}
                      className={`p-3 rounded-xl font-bold text-xs border transition-all text-left flex flex-col gap-1 cursor-pointer ${
                        condition === 'ABOVE'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                          : 'bg-slate-900/60 text-muted-foreground border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                          <span>Crosses ABOVE</span>
                        </span>
                        {condition === 'ABOVE' && (
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-normal">
                        Resistance breakout & bullish momentum
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCondition('BELOW')}
                      className={`p-3 rounded-xl font-bold text-xs border transition-all text-left flex flex-col gap-1 cursor-pointer ${
                        condition === 'BELOW'
                          ? 'bg-rose-500/15 text-rose-400 border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.15)]'
                          : 'bg-slate-900/60 text-muted-foreground border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <ArrowDownRight className="h-4 w-4 text-rose-400" />
                          <span>Drops BELOW</span>
                        </span>
                        {condition === 'BELOW' && (
                          <span className="h-2 w-2 rounded-full bg-rose-400" />
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-normal">
                        Support breach & stop-loss trigger
                      </span>
                    </button>
                  </div>
                </div>

                {/* Target Price */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-muted-foreground font-semibold">
                      Target Execution Price
                    </label>
                    <span className="text-[10px] text-muted-foreground/70 font-mono">INR (₹)</span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-muted-foreground font-mono font-bold text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      step="0.05"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      placeholder="e.g. 1500.00"
                      className="w-full h-10 pl-8 pr-4 rounded-xl bg-slate-900 border border-white/10 font-mono font-bold text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Preset Steps */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-muted-foreground/60 font-mono">STEP:</span>
                    {[-10, -5, +5, +10, +50].map((step) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => {
                          const current = parseFloat(targetPrice) || 1000;
                          setTargetPrice(Math.max(1, current + step).toFixed(2));
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        {step > 0 ? `+${step}` : step}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submit button */}
                <div className="pt-3 border-t border-white/10 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCreateOpen(false)}
                    className="w-1/3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={createMutation.isPending || !targetPrice || parseFloat(targetPrice) <= 0}
                    className="w-2/3 py-2.5 rounded-xl bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 text-white font-bold text-xs shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Arming Sentinel...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Activate Trigger Sentinel</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
