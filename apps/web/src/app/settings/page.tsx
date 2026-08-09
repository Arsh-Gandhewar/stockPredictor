'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Monitor, RefreshCcw, Bell, Shield, Sliders, Database, Check, RotateCcw } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [refreshInterval, setRefreshInterval] = useState('30');
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [defaultCurrency, setDefaultCurrency] = useState('INR');
  const [savedStatus, setSavedStatus] = useState(false);

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
    setTimeout(() => setSavedStatus(false), 1500);
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Platform Preferences & Settings
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Configure market data stream intervals, notification triggers, and user interface preferences.
          </p>
        </div>
        {savedStatus && (
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/30 flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Preferences Saved
          </span>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Display Settings */}
        <Card className="bg-card/70 border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" />
              Theme & Presentation
            </CardTitle>
            <CardDescription className="text-xs">Visual styling and color palette</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Color Scheme</span>
              <span className="px-2.5 py-1 rounded-md bg-primary/10 text-primary font-bold border border-primary/20">
                Institutional Dark (Active)
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-semibold">Base Currency</span>
              <select
                value={defaultCurrency}
                onChange={(e) => {
                  setDefaultCurrency(e.target.value);
                  handleSave('defaultCurrency', e.target.value);
                }}
                className="px-2.5 py-1 rounded-md bg-muted/60 border border-border/40 font-bold focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="INR">INR (₹ Indian Rupee)</option>
                <option value="USD">USD ($ US Dollar)</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Data & Auto-Refresh */}
        <Card className="bg-card/70 border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <RefreshCcw className="h-4 w-4 text-primary" />
              Data Feeds & Polling
            </CardTitle>
            <CardDescription className="text-xs">Configure streaming update rates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Quote Refresh Rate</span>
              <select
                value={refreshInterval}
                onChange={(e) => {
                  setRefreshInterval(e.target.value);
                  handleSave('refreshInterval', e.target.value);
                }}
                className="px-2.5 py-1 rounded-md bg-muted/60 border border-border/40 font-bold focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="15">15 seconds (High-Speed)</option>
                <option value="30">30 seconds (Default)</option>
                <option value="60">60 seconds (Standard)</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-semibold">Market Feed Provider</span>
              <span className="text-muted-foreground font-mono">NSE / Yahoo Finance 2</span>
            </div>
          </CardContent>
        </Card>

        {/* Notifications & Audio */}
        <Card className="bg-card/70 border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Alerts & Notifications
            </CardTitle>
            <CardDescription className="text-xs">Price breakout & target notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Price Breakout Alerts</span>
              <button
                onClick={() => {
                  const next = !alertsEnabled;
                  setAlertsEnabled(next);
                  handleSave('alertsEnabled', next);
                }}
                className={`px-3 py-1 rounded-md font-bold transition-all ${
                  alertsEnabled ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-muted/60 text-muted-foreground'
                }`}
              >
                {alertsEnabled ? 'Enabled' : 'Muted'}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-semibold">Audio Chime on Target</span>
              <button
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  handleSave('soundEnabled', next);
                }}
                className={`px-3 py-1 rounded-md font-bold transition-all ${
                  soundEnabled ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-muted/60 text-muted-foreground'
                }`}
              >
                {soundEnabled ? 'Active' : 'Off'}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System Diagnostics & Backend Status */}
      <Card className="border-border/50 bg-card/60 shadow-sm">
        <CardHeader className="pb-3 border-b border-border/30">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            System Connectivity & Infrastructure Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-muted-foreground mb-1">Backend Server</div>
              <div className="font-bold text-green-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                Operational (Port 3001)
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-muted-foreground mb-1">Neon PostgreSQL</div>
              <div className="font-bold text-green-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                Connected (Pooled)
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-muted-foreground mb-1">Gemini AI Models</div>
              <div className="font-bold text-primary">Pro & Flash 1.5</div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="text-muted-foreground mb-1">Monitored Equities</div>
              <div className="font-bold text-foreground">49 Blue-Chips</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
