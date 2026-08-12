'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bell, Plus, Trash2, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useAlerts, useCreateAlert, useDeleteAlert, useAllStocks, AlertItem } from '@/hooks/use-stock';

export default function AlertsPage() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState('RELIANCE.NS');
  const [targetPrice, setTargetPrice] = useState('1450');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');

  const { data: alerts, isLoading } = useAlerts();
  const { data: stocks } = useAllStocks();
  const createMutation = useCreateAlert();
  const deleteMutation = useDeleteAlert();

  const handleCreate = () => {
    if (!targetPrice || parseFloat(targetPrice) <= 0) return;
    createMutation.mutate({
      ticker: selectedTicker,
      targetPrice: parseFloat(targetPrice),
      condition,
    });
    setIsCreateOpen(false);
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              Real-Time Price & Breakout Alerts
            </h1>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> MONITORING
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Configure automated price thresholds, breakout notifications, and target triggers across Indian equities.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-sm self-start md:self-auto"
        >
          <Plus className="h-4 w-4" /> Create New Alert
        </button>
      </div>

      {/* Alerts Table */}
      <Card className="border-border/50 bg-card/60 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
              <span className="text-xs text-muted-foreground">Loading active alerts...</span>
            </div>
          ) : alerts?.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground space-y-2">
              <Bell className="h-8 w-8 mx-auto opacity-30 text-primary" />
              <p>No active price alerts. Click "Create New Alert" to set one up.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/30 text-muted-foreground border-b border-border/40 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-4">Stock</th>
                    <th className="py-3 px-4">Trigger Condition</th>
                    <th className="py-3 px-4">Target Price</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {alerts?.map((item: AlertItem) => (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-foreground font-mono">
                        {item.ticker.replace('.NS', '')}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold text-[10px] ${
                            item.condition === 'ABOVE'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          {item.condition === 'ABOVE' ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          Crosses {item.condition}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold">
                        ₹{item.targetPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-muted-foreground">{item.createdAt}</td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold text-[10px]">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => deleteMutation.mutate(item.id)}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete alert"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Alert Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-sm">Create Price Threshold Alert</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-muted-foreground mb-1 font-semibold">Stock Ticker</label>
                <select
                  value={selectedTicker}
                  onChange={(e) => setSelectedTicker(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-muted/40 border border-border/40 font-mono font-bold focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {(stocks || []).slice(0, 100).map((s: any) => (
                    <option key={s.ticker} value={s.ticker}>
                      {s.ticker.replace('.NS', '')} - {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-muted-foreground mb-1 font-semibold">Condition</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCondition('ABOVE')}
                    className={`py-2 rounded-lg font-bold text-xs border transition-all ${
                      condition === 'ABOVE'
                        ? 'bg-green-500/15 text-green-400 border-green-500/40'
                        : 'bg-muted/40 text-muted-foreground border-border/40'
                    }`}
                  >
                    Price Crosses ABOVE (↑)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCondition('BELOW')}
                    className={`py-2 rounded-lg font-bold text-xs border transition-all ${
                      condition === 'BELOW'
                        ? 'bg-red-500/15 text-red-400 border-red-500/40'
                        : 'bg-muted/40 text-muted-foreground border-border/40'
                    }`}
                  >
                    Price Drops BELOW (↓)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-muted-foreground mb-1 font-semibold">Target Price (₹)</label>
                <input
                  type="number"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  placeholder="Enter target in ₹"
                  className="w-full h-9 px-3 rounded-lg bg-muted/40 border border-border/40 font-mono font-bold focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={handleCreate}
                  className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-all shadow-sm"
                >
                  Activate Alert
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
