'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi } from 'lightweight-charts';

interface CandleData {
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
}

export default function CandlestickChart({ data, height = 280 }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

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

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up any existing chart instance in this container
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const containerWidth = chartContainerRef.current.clientWidth || 600;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      width: containerWidth,
      height: height,
      localization: {
        timeFormatter: (businessDayOrTimestamp: number | string) => {
          if (typeof businessDayOrTimestamp === 'number') {
            return new Intl.DateTimeFormat('en-IN', {
              timeZone: 'Asia/Kolkata',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            }).format(new Date(businessDayOrTimestamp * 1000));
          }
          return String(businessDayOrTimestamp);
        },
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
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
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    if (sanitizedData.length > 0) {
      series.setData(sanitizedData as any);
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
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
      seriesRef.current = null;
    };
  }, [height]);

  // Update data when it changes
  useEffect(() => {
    if (seriesRef.current && chartRef.current) {
      if (sanitizedData.length > 0) {
        seriesRef.current.setData(sanitizedData as any);
        chartRef.current.timeScale().fitContent();
      } else {
        seriesRef.current.setData([]);
      }
    }
  }, [sanitizedData]);

  return (
    <div className="w-full relative" style={{ height: `${height}px` }}>
      <div ref={chartContainerRef} className="w-full h-full" />
      {sanitizedData.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-border/50 bg-card/30 text-xs text-muted-foreground z-10">
          No candlestick data available for this timeframe
        </div>
      )}
    </div>
  );
}
