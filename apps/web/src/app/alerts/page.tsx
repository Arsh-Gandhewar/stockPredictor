'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Bell, BellRing, Plus, Trash2, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAllStocks } from '@/hooks/use-stock';

interface AlertItem {
  id: string;
  ticker: string;
  targetPrice: number;
  condition: 'ABOVE' | 'BELOW';
  createdAt: string;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([
    { id: '1', ticker: 'RELIANCE.NS', targetPrice: 1400, condition: 'ABOVE', createdAt: 'Today' },
    { id: '2', ticker: 'TCS.NS', targetPrice: 3200, condition: 'BELOW', createdAt: 'Yesterday' },
  ]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState('RELIANCE.NS');
  const [targetPrice, setTargetPrice] = useState('1450');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');

  const { data: stocks } = useAllStocks();

  useEffect(() => {
    const saved = localStorage.getItem('user_alerts');
    if (saved) {
      try {
        setAlerts(JSON.parse(saved));
      } catch {}
    }
  }, []);

  const saveAlerts = (list: AlertItem[]) => {
    setAlerts(list);
    localStorage.setItem('user_alerts', JSON.stringify(list));
  };

  const handleCreate = () => {
    const newAlert: AlertItem = {
      id: Date.now().toString(),
      ticker: selectedTicker,
      targetPrice: parseFloat(targetPrice) || 0,
      condition,
      createdAt: 'Just now',
    };
    saveAlerts([newAlert, ...alerts]);
    setIsCreateOpen(false);
  };

  const handleDelete = (id: string) => {
    saveAlerts(alerts.filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Real-Time Price Alerts
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Configure automated price thresholds, breakout notifications, and target triggers.
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-all flex items-center gap-1.5 shadow-sm self-start md:self-auto"
        >
          <Plus className="h-4 w-4" /> Create New Alert
        </button>
      </div>

      <Card className="border-border/50 bg-card/60 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {alerts.length === 0 ? (
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
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {alerts.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-foreground">
                        {item.ticker.replace('.NS', '')}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.condition === 'ABOVE'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          Crosses {item.condition}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-extrabold text-foreground">
                        ₹{item.targetPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-muted-foreground">{item.createdAt}</td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
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
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border/60 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b border-border/40 pb-3">
              <h3 className="font-extrabold text-base">Create Price Alert</h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted-foreground block mb-1">Select Stock</label>
                <select
                  value={selectedTicker}
                  onChange={(e) => setSelectedTicker(e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-muted/40 px-3 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                >
                  {(stocks || []).map((s) => (
                    <option key={s.ticker} value={s.ticker} className="bg-card text-foreground">
                      {s.ticker.replace('.NS', '')} — {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-muted-foreground block mb-1">Trigger Condition</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setCondition('ABOVE')}
                    className={`py-2 rounded-lg font-bold border transition-all ${
                      condition === 'ABOVE'
                        ? 'bg-green-500/20 text-green-400 border-green-500/40'
                        : 'bg-muted/40 text-muted-foreground border-border/40'
                    }`}
                  >
                    Price Crosses Above
                  </button>
                  <button
                    onClick={() => setCondition('BELOW')}
                    className={`py-2 rounded-lg font-bold border transition-all ${
                      condition === 'BELOW'
                        ? 'bg-red-500/20 text-red-400 border-red-500/40'
                        : 'bg-muted/40 text-muted-foreground border-border/40'
                    }`}
                  >
                    Price Crosses Below
                  </button>
                </div>
              </div>

              <div>
                <label className="text-muted-foreground block mb-1">Target Price (₹)</label>
                <input
                  type="number"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-muted/40 px-3 text-xs font-bold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
            </div>

            <button
              onClick={handleCreate}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs transition-colors shadow-sm"
            >
              Set Price Alert
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
