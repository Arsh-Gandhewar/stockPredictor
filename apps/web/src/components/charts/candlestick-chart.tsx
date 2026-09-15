'use client';

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { 
  createChart, 
  CandlestickSeries, 
  HistogramSeries, 
  CrosshairMode, 
  ColorType, 
  LineStyle, 
  IChartApi, 
  ISeriesApi 
} from 'lightweight-charts';
import { Maximize2, BarChart, Layers } from 'lucide-react';

export interface CandleData {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CandlestickChartProps {
  data: CandleData[];
  height?: number;
  ticker?: string;
  showVolume?: boolean;
}

interface ActiveCandleInfo {
  timeStr: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume?: number;
}

export default function CandlestickChart({ 
  data, 
  height = 360, 
  ticker = '',
  showVolume: initialShowVolume = true 
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [displayVolume, setDisplayVolume] = useState<boolean>(initialShowVolume);
  const [activeCandle, setActiveCandle] = useState<ActiveCandleInfo | null>(null);

  // Sanitize, sort, and strictly deduplicate candle data by timestamp
  const sanitizedData = useMemo(() => {
    if (!data || !Array.isArray(data) || data.length === 0) return [];
    
    const seenTimes = new Set<string | number>();
    return [...data]
      .filter((c) => c && c.time && c.open != null && c.close != null && c.high != null && c.low != null)
      .sort((a, b) => {
        const timeA = typeof a.time === 'number' ? a.time : new Date(a.time).getTime();
        const timeB = typeof b.time === 'number' ? b.time : new Date(b.time).getTime();
        return timeA - timeB;
      })
      .filter((c) => {
        if (seenTimes.has(c.time)) return false;
        seenTimes.add(c.time);
        return true;
      });
  }, [data]);

  // Volume series data derived from sanitized candles
  const volumeData = useMemo(() => {
    return sanitizedData
      .filter((c) => c.volume != null && c.volume > 0)
      .map((c) => {
        const isUp = c.close >= c.open;
        return {
          time: c.time,
          value: c.volume || 0,
          color: isUp ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
        };
      });
  }, [sanitizedData]);

  // Format helper for timestamp
  const formatTime = useCallback((time: string | number) => {
    if (typeof time === 'number') {
      const date = new Date(time * 1000);
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
    }
    const d = new Date(time);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(d);
    }
    return String(time);
  }, []);

  // Compute default latest candle info
  const latestCandleInfo = useMemo<ActiveCandleInfo | null>(() => {
    if (sanitizedData.length === 0) return null;
    const last = sanitizedData[sanitizedData.length - 1];
    const change = last.close - last.open;
    const changePercent = last.open ? (change / last.open) * 100 : 0;
    return {
      timeStr: formatTime(last.time),
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      change,
      changePercent,
      volume: last.volume,
    };
  }, [sanitizedData, formatTime]);

  // Reset to latest when active is null
  const currentDisplayCandle = activeCandle || latestCandleInfo;

  // Initialize and configure chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    }

    const containerWidth = chartContainerRef.current.clientWidth || 600;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace, -apple-system, BlinkMacSystemFont, sans-serif",
      },
      grid: {
        vertLines: { 
          color: 'rgba(255, 255, 255, 0.035)', 
          style: LineStyle.Dotted 
        },
        horzLines: { 
          color: 'rgba(255, 255, 255, 0.035)', 
          style: LineStyle.Dotted 
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1e293b',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: {
          top: 0.08,
          bottom: 0.22,
        },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number | string, tickMarkType: number) => {
          if (typeof time === 'number') {
            const date = new Date(time * 1000);
            if (tickMarkType >= 3) {
              return new Intl.DateTimeFormat('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }).format(date);
            }
            return new Intl.DateTimeFormat('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit',
              month: 'short',
              year: tickMarkType === 0 ? 'numeric' : undefined,
            }).format(date);
          }
          return String(time);
        },
      },
      width: containerWidth,
      height: height,
    });

    // Add Volume Histogram Series (bottom 20% overlay)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    // Add Candlestick Series with institutional palette
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.05,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Populate initial data
    if (sanitizedData.length > 0) {
      candleSeries.setData(sanitizedData as any);
      if (displayVolume && volumeData.length > 0) {
        volumeSeries.setData(volumeData as any);
      }
      chart.timeScale().fitContent();
    }

    // Interactive crosshair move listener to update OHLC status bar
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        setActiveCandle(null);
        return;
      }

      const candlePoint = param.seriesData.get(candleSeries) as {
        open?: number;
        high?: number;
        low?: number;
        close?: number;
      } | undefined;

      if (candlePoint && candlePoint.open !== undefined && candlePoint.close !== undefined) {
        const o = candlePoint.open;
        const h = candlePoint.high ?? o;
        const l = candlePoint.low ?? o;
        const c = candlePoint.close;
        const change = c - o;
        const changePercent = o ? (change / o) * 100 : 0;

        // Lookup matching candle volume if available
        const matched = sanitizedData.find((d) => d.time === param.time);

        setActiveCandle({
          timeStr: formatTime(param.time as any),
          open: o,
          high: h,
          low: l,
          close: c,
          change,
          changePercent,
          volume: matched?.volume,
        });
      } else {
        setActiveCandle(null);
      }
    });

    // Responsive container observer
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: height 
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(chartContainerRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [height, formatTime]);

  // Update data dynamically
  useEffect(() => {
    if (candleSeriesRef.current && chartRef.current) {
      if (sanitizedData.length > 0) {
        candleSeriesRef.current.setData(sanitizedData as any);
        if (displayVolume && volumeSeriesRef.current && volumeData.length > 0) {
          volumeSeriesRef.current.setData(volumeData as any);
        } else if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData([]);
        }
        chartRef.current.timeScale().fitContent();
      } else {
        candleSeriesRef.current.setData([]);
        if (volumeSeriesRef.current) volumeSeriesRef.current.setData([]);
      }
    }
  }, [sanitizedData, volumeData, displayVolume]);

  const handleFitContent = () => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  };

  const formatLargeVol = (vol?: number) => {
    if (!vol) return 'N/A';
    if (vol >= 10000000) return `${(vol / 10000000).toFixed(2)}Cr`;
    if (vol >= 100000) return `${(vol / 100000).toFixed(2)}L`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(1)}k`;
    return vol.toLocaleString('en-IN');
  };

  return (
    <div className="w-full flex flex-col select-none group">
      {/* ── Institutional OHLC & Active Candle Legend Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 mb-1.5 text-[11px] font-mono border border-border/40 bg-card/40 backdrop-blur-sm rounded-lg">
        {currentDisplayCandle ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <span className="text-foreground/90 font-bold">{currentDisplayCandle.timeStr}</span>
            <div className="flex items-center gap-2">
              <span>O: <strong className="text-foreground font-semibold">₹{currentDisplayCandle.open.toFixed(2)}</strong></span>
              <span>H: <strong className="text-emerald-400 font-semibold">₹{currentDisplayCandle.high.toFixed(2)}</strong></span>
              <span>L: <strong className="text-rose-400 font-semibold">₹{currentDisplayCandle.low.toFixed(2)}</strong></span>
              <span>C: <strong className="text-foreground font-bold">₹{currentDisplayCandle.close.toFixed(2)}</strong></span>
            </div>
            <div className={`flex items-center font-bold ${currentDisplayCandle.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span>
                {currentDisplayCandle.change >= 0 ? '+' : ''}₹{currentDisplayCandle.change.toFixed(2)} ({currentDisplayCandle.change >= 0 ? '+' : ''}{currentDisplayCandle.changePercent.toFixed(2)}%)
              </span>
            </div>
            {currentDisplayCandle.volume && (
              <span className="hidden sm:inline-block text-muted-foreground">
                Vol: <strong className="text-foreground font-semibold">{formatLargeVol(currentDisplayCandle.volume)}</strong>
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground italic text-[11px]">Hover over chart to inspect candle metrics</span>
        )}

        {/* Quick chart action buttons */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => setDisplayVolume((prev) => !prev)}
            title={displayVolume ? 'Hide Volume Histogram' : 'Show Volume Histogram'}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors flex items-center gap-1 ${
              displayVolume 
                ? 'bg-primary/15 text-primary border-primary/30' 
                : 'bg-muted/40 text-muted-foreground border-border/30 hover:text-foreground'
            }`}
          >
            <BarChart className="h-3 w-3" />
            <span className="hidden md:inline">Vol</span>
          </button>
          <button
            onClick={handleFitContent}
            title="Reset Zoom / Fit Canvas"
            className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted/40 text-muted-foreground border border-border/30 hover:text-foreground hover:bg-muted/70 transition-colors flex items-center gap-1"
          >
            <Maximize2 className="h-3 w-3" />
            <span className="hidden md:inline">Fit</span>
          </button>
        </div>
      </div>

      {/* ── Canvas Container ── */}
      <div className="w-full relative" style={{ height: `${height}px` }}>
        <div ref={chartContainerRef} className="w-full h-full" />
        
        {sanitizedData.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-dashed border-border/40 bg-card/40 backdrop-blur-xs text-xs text-muted-foreground z-10 space-y-2">
            <Layers className="h-6 w-6 text-muted-foreground/60 animate-pulse" />
            <p className="font-semibold">No candlestick data available for this timeframe</p>
            <span className="text-[10px] text-muted-foreground/60">Try selecting another duration above (e.g. 1M, 6M, 1Y)</span>
          </div>
        )}
      </div>
    </div>
  );
}
