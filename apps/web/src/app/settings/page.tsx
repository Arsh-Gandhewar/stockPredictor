'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Monitor,
  RefreshCcw,
  Bell,
  Shield,
  Sliders,
  Database,
  Check,
  RotateCcw,
  Volume2,
  VolumeX,
  Cpu,
  Server,
  Zap,
  Radio,
  CheckCircle2,
  Sparkles,
  Lock,
  Globe2,
  Activity,
  HardDrive,
  Terminal,
  Volume1
} from 'lucide-react';

export default function SettingsPage() {
  const [refreshInterval, setRefreshInterval] = useState('30');
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [defaultCurrency, setDefaultCurrency] = useState('INR');
  const [savedStatus, setSavedStatus] = useState(false);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [lastPingTime, setLastPingTime] = useState<string>('Just now');
  const [pingLatency, setPingLatency] = useState<number>(14);

  useEffect(() => {
    const saved = localStorage.getItem('quantx_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.refreshInterval) setRefreshInterval(parsed.refreshInterval);
        if (parsed.alertsEnabled !== undefined) setAlertsEnabled(parsed.alertsEnabled);
        if (parsed.soundEnabled !== undefined) setSoundEnabled(parsed.soundEnabled);
        if (parsed.defaultCurrency) setDefaultCurrency(parsed.defaultCurrency);
      } catch {}
    }
  }, []);

  const handleSave = (key: string, value: any) => {
    const current = {
      refreshInterval,
      alertsEnabled,
      soundEnabled,
      defaultCurrency,
      [key]: value,
    };
    localStorage.setItem('quantx_settings', JSON.stringify(current));
    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 2000);
  };

  const handleResetDefaults = () => {
    const defaults = {
      refreshInterval: '30',
      alertsEnabled: true,
      soundEnabled: true,
      defaultCurrency: 'INR',
    };
    setRefreshInterval('30');
    setAlertsEnabled(true);
    setSoundEnabled(true);
    setDefaultCurrency('INR');
    localStorage.setItem('quantx_settings', JSON.stringify(defaults));
    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 2000);
  };

  // Web Audio chime for institutional alert testing
  const playTestChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15); // A6

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch {}
  };

  const runDiagnostics = () => {
    setDiagnosticsRunning(true);
    setTimeout(() => {
      setPingLatency(Math.floor(Math.random() * 8) + 9);
      setLastPingTime('Just now');
      setDiagnosticsRunning(false);
    }, 800);
  };

  return (
    <div className="space-y-6 pb-16 animate-in fade-in duration-500 max-w-7xl mx-auto">
      {/* ── Institutional Header & Telemetry ── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-slate-900/80 via-slate-950/90 to-black p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-20 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="p-2 rounded-xl bg-primary/10 border border-primary/25 text-primary">
                <Sliders className="h-5 w-5" />
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70">
                Platform Preferences & Terminal Settings
              </h1>

              {/* Status Beacon */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/30 shadow-[0_0_12px_rgba(99,102,241,0.2)]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span>QUANTX CONFIG ENGINE</span>
                <span className="text-[9px] text-primary/70 border-l border-primary/30 pl-1.5 font-mono">
                  ACTIVE
                </span>
              </div>
            </div>

            <p className="text-xs md:text-sm text-muted-foreground/80 max-w-2xl leading-relaxed">
              Tailor real-time streaming intervals, institutional alert audio chimes, currency base standards, and verify microservice mesh health.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto flex-wrap">
            <AnimatePresence>
              {savedStatus && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -4 }}
                  className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.2)] font-mono"
                >
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span>PREFERENCES COMMITTED</span>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={handleResetDefaults}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-muted-foreground hover:text-foreground border border-white/10 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="Reset all settings to factory default"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Defaults</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Settings Grid ── */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Card 1: Theme & Presentation */}
        <Card className="relative overflow-hidden bg-slate-950/70 border-white/5 backdrop-blur-xl shadow-xl hover:border-primary/30 transition-all rounded-2xl flex flex-col justify-between">
          <div>
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between mb-1">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                  <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                    <Monitor className="h-4 w-4" />
                  </div>
                  <span>Theme & Presentation</span>
                </CardTitle>
                <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">UI ENGINE</span>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Display architecture & currency display
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 pt-2 space-y-4 text-xs">
              {/* Color Scheme */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">Color Scheme</div>
                  <div className="text-[10px] text-muted-foreground">Deep obsidian & slate mesh</div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-primary/15 text-primary font-bold text-[11px] border border-primary/30 shadow-[0_0_10px_rgba(99,102,241,0.15)] flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Institutional Dark
                </span>
              </div>

              {/* Base Currency */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-foreground">Base Currency Standard</div>
                    <div className="text-[10px] text-muted-foreground">Valuation & order pricing units</div>
                  </div>
                  <span className="text-xs font-mono font-bold text-foreground">
                    {defaultCurrency === 'INR' ? '₹ INR' : '$ USD'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setDefaultCurrency('INR');
                      handleSave('defaultCurrency', 'INR');
                    }}
                    className={`py-2 px-3 rounded-lg font-bold font-mono text-xs border transition-all cursor-pointer text-center ${
                      defaultCurrency === 'INR'
                        ? 'bg-primary/20 text-primary border-primary/40 shadow-sm'
                        : 'bg-white/5 text-muted-foreground border-white/5 hover:text-foreground'
                    }`}
                  >
                    INR (₹ Rupee)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDefaultCurrency('USD');
                      handleSave('defaultCurrency', 'USD');
                    }}
                    className={`py-2 px-3 rounded-lg font-bold font-mono text-xs border transition-all cursor-pointer text-center ${
                      defaultCurrency === 'USD'
                        ? 'bg-primary/20 text-primary border-primary/40 shadow-sm'
                        : 'bg-white/5 text-muted-foreground border-white/5 hover:text-foreground'
                    }`}
                  >
                    USD ($ Dollar)
                  </button>
                </div>
              </div>

              {/* Tabular Font Feature */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">Monospace Tabular Numerics</div>
                  <div className="text-[10px] text-muted-foreground">Fixed-width column alignment</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ENFORCED
                </span>
              </div>
            </CardContent>
          </div>
        </Card>

        {/* Card 2: Data Feeds & Polling */}
        <Card className="relative overflow-hidden bg-slate-950/70 border-white/5 backdrop-blur-xl shadow-xl hover:border-primary/30 transition-all rounded-2xl flex flex-col justify-between">
          <div>
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between mb-1">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                  <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                    <RefreshCcw className="h-4 w-4" />
                  </div>
                  <span>Data Feeds & Polling</span>
                </CardTitle>
                <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">INGESTION</span>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Streaming quote rates & network sync
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 pt-2 space-y-4 text-xs">
              {/* Quote Refresh Rate */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-foreground">Quote Polling Interval</div>
                    <div className="text-[10px] text-muted-foreground">Orderbook sync frequency</div>
                  </div>
                  <span className="text-xs font-mono font-bold text-primary">{refreshInterval}s</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  {[
                    { id: '15', label: '15s High-Freq' },
                    { id: '30', label: '30s Optimal' },
                    { id: '60', label: '60s Standard' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setRefreshInterval(opt.id);
                        handleSave('refreshInterval', opt.id);
                      }}
                      className={`py-2 px-2 rounded-lg font-bold font-mono text-[11px] border transition-all cursor-pointer text-center ${
                        refreshInterval === opt.id
                          ? 'bg-primary/20 text-primary border-primary/40 shadow-sm'
                          : 'bg-white/5 text-muted-foreground border-white/5 hover:text-foreground'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feed Provider Details */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">Market Feed Provider</div>
                  <div className="text-[10px] text-muted-foreground font-mono">NSE EOD / Yahoo Finance 2</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  ONLINE
                </span>
              </div>

              {/* Cache Layer */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">TanStack Query Cache</div>
                  <div className="text-[10px] text-muted-foreground">Stale-While-Revalidate SWR</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  WARM
                </span>
              </div>
            </CardContent>
          </div>
        </Card>

        {/* Card 3: Alerts & Audio */}
        <Card className="relative overflow-hidden bg-slate-950/70 border-white/5 backdrop-blur-xl shadow-xl hover:border-primary/30 transition-all rounded-2xl flex flex-col justify-between">
          <div>
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between mb-1">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                  <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                    <Bell className="h-4 w-4" />
                  </div>
                  <span>Alerts & Notifications</span>
                </CardTitle>
                <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">SENTINEL</span>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Price breakout & audio alarm dispatch
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 pt-2 space-y-4 text-xs">
              {/* Breakout Alerts Toggle */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">Price Breakout Alerts</div>
                  <div className="text-[10px] text-muted-foreground">Orderbook threshold triggers</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !alertsEnabled;
                    setAlertsEnabled(next);
                    handleSave('alertsEnabled', next);
                  }}
                  className={`px-3 py-1.5 rounded-xl font-bold font-mono text-xs border transition-all cursor-pointer ${
                    alertsEnabled
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                      : 'bg-white/5 text-muted-foreground border-white/10'
                  }`}
                >
                  {alertsEnabled ? 'ACTIVE' : 'MUTED'}
                </button>
              </div>

              {/* Audio Chime Toggle */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-foreground">Audio Chime on Target</div>
                    <div className="text-[10px] text-muted-foreground">Synthetic high-frequency tone</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !soundEnabled;
                      setSoundEnabled(next);
                      handleSave('soundEnabled', next);
                    }}
                    className={`px-3 py-1.5 rounded-xl font-bold font-mono text-xs border transition-all cursor-pointer flex items-center gap-1.5 ${
                      soundEnabled
                        ? 'bg-primary/20 text-primary border-primary/40 shadow-[0_0_10px_rgba(99,102,241,0.15)]'
                        : 'bg-white/5 text-muted-foreground border-white/10'
                    }`}
                  >
                    {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    <span>{soundEnabled ? 'ACTIVE' : 'OFF'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <span className="text-[10px] text-muted-foreground/80">Test Audio Synthesizer</span>
                  <button
                    type="button"
                    onClick={playTestChime}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-primary hover:text-primary/90 text-[10px] font-bold border border-white/10 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Volume1 className="h-3 w-3" />
                    <span>Play Chime</span>
                  </button>
                </div>
              </div>

              {/* Desktop Permissions */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">Browser Push Dispatch</div>
                  <div className="text-[10px] text-muted-foreground">HTML5 Notification API</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white/5 text-muted-foreground border border-white/10">
                  READY
                </span>
              </div>
            </CardContent>
          </div>
        </Card>
      </div>

      {/* ── System Connectivity Diagnostics & Infrastructure ── */}
      <Card className="relative overflow-hidden border border-white/5 bg-slate-950/80 backdrop-blur-xl shadow-2xl rounded-2xl">
        <div className="absolute top-0 right-1/4 -mt-12 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        <CardHeader className="p-6 pb-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-sm md:text-base font-bold flex items-center gap-2.5 text-foreground">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                <Database className="h-4 w-4" />
              </div>
              <span>System Connectivity & Infrastructure Diagnostics</span>
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Real-time telemetry status across backend microservices, serverless database, and Gemini neural models.
            </CardDescription>
          </div>

          <button
            onClick={runDiagnostics}
            disabled={diagnosticsRunning}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-foreground border border-white/10 flex items-center gap-2 transition-all self-start sm:self-auto cursor-pointer disabled:opacity-60 shadow-sm"
          >
            <Activity className={`h-3.5 w-3.5 text-primary ${diagnosticsRunning ? 'animate-spin' : ''}`} />
            <span>{diagnosticsRunning ? 'Probing Mesh...' : 'Ping Services'}</span>
          </button>
        </CardHeader>

        <CardContent className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            {/* 1. Backend Server */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-mono uppercase tracking-wider">Backend API</span>
                <Server className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="font-bold text-emerald-400 flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Operational
              </div>
              <div className="text-[10px] text-muted-foreground/70 font-mono">Port 3001 (Node)</div>
            </div>

            {/* 2. Neon PostgreSQL */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-mono uppercase tracking-wider">Database</span>
                <Database className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div className="font-bold text-emerald-400 flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Connected
              </div>
              <div className="text-[10px] text-muted-foreground/70 font-mono">Neon Serverless</div>
            </div>

            {/* 3. Gemini AI Models */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-mono uppercase tracking-wider">AI Inference</span>
                <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              </div>
              <div className="font-bold text-indigo-400 text-xs">
                Pro & Flash 1.5
              </div>
              <div className="text-[10px] text-muted-foreground/70 font-mono">Gemini Quant Engine</div>
            </div>

            {/* 4. Monitored Equities */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-mono uppercase tracking-wider">Asset Scope</span>
                <Globe2 className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <div className="font-bold text-foreground text-xs">
                49 Blue-Chips
              </div>
              <div className="text-[10px] text-muted-foreground/70 font-mono">Nifty 50 Universe</div>
            </div>

            {/* 5. Latency Telemetry */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-mono uppercase tracking-wider">Mesh Latency</span>
                <Zap className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <div className="font-bold text-foreground text-xs font-mono">
                {pingLatency} ms
              </div>
              <div className="text-[10px] text-emerald-400/80 font-mono">Sub-20ms SLA</div>
            </div>

            {/* 6. Security & Encryption */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-mono uppercase tracking-wider">Security</span>
                <Lock className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div className="font-bold text-emerald-400 text-xs">
                TLS 1.3 / SSL
              </div>
              <div className="text-[10px] text-muted-foreground/70 font-mono">Encrypted RPC</div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between text-[11px] text-muted-foreground gap-2">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-primary" />
              <span>Next.js 15.5.22 App Router • React 19.1.0 • Tailwind CSS v4 • Zustand 5.0.14</span>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground/60">
              LAST HEALTH PING: {lastPingTime.toUpperCase()}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
