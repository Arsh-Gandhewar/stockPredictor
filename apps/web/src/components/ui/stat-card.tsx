import * as React from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
  sparkline?: number[];
  badge?: string;
  className?: string;
  onClick?: () => void;
  variant?: "default" | "glow" | "metric" | "glass";
  subtitle?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  trend,
  sparkline,
  badge,
  className,
  onClick,
  variant = "metric",
  subtitle,
}: StatCardProps) {
  const gradId = React.useId();

  // Determine trend: explicit prop takes precedence, otherwise infer from change
  const computedTrend: "up" | "down" | "neutral" =
    trend ??
    (change !== undefined
      ? change > 0
        ? "up"
        : change < 0
        ? "down"
        : "neutral"
      : "neutral");

  const trendConfig = {
    up: {
      color: "text-emerald-500 dark:text-emerald-400",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      stroke: "#10b981",
      Icon: ArrowUpRight,
    },
    down: {
      color: "text-rose-500 dark:text-rose-400",
      bgColor: "bg-rose-500/10",
      borderColor: "border-rose-500/20",
      stroke: "#f43f5e",
      Icon: ArrowDownRight,
    },
    neutral: {
      color: "text-muted-foreground",
      bgColor: "bg-secondary/60",
      borderColor: "border-border/60",
      stroke: "#94a3b8",
      Icon: Minus,
    },
  };

  const currentTrend = trendConfig[computedTrend];
  const TrendIcon = currentTrend.Icon;

  // Generate SVG Sparkline paths
  const sparklineSvg = React.useMemo(() => {
    if (!sparkline || sparkline.length < 2) return null;

    const width = 100;
    const height = 32;
    const padding = 3;

    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = max - min === 0 ? 1 : max - min;
    const stepX = width / (sparkline.length - 1);

    const points = sparkline.map((val, idx) => {
      const x = idx * stepX;
      const y =
        height - padding - ((val - min) / range) * (height - padding * 2);
      return { x, y };
    });

    const linePath = `M ${points
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" L ")}`;
    const areaPath = `M 0,${height} L ${points
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" L ")} L ${width},${height} Z`;

    return { linePath, areaPath, width, height };
  }, [sparkline]);

  return (
    <Card
      variant={variant}
      onClick={onClick}
      className={cn(
        "group relative transition-all duration-200",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
        className
      )}
    >
      <CardContent className="p-5 flex flex-col justify-between space-y-3">
        {/* Top row: Title, Icon, Badge */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          <div className="flex items-center gap-1.5">
            {badge && (
              <Badge variant="glass" size="sm">
                {badge}
              </Badge>
            )}
            {Icon && (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shadow-xs group-hover:scale-105 transition-transform duration-200">
                <Icon className="h-4 w-4" />
              </div>
            )}
          </div>
        </div>

        {/* Middle row: Large Value & Sparkline */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-2xl lg:text-3xl font-bold font-mono tracking-tight text-foreground tabular-nums">
              {value}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>

          {sparklineSvg && (
            <div className="shrink-0 w-[100px] h-[32px] overflow-hidden opacity-85 group-hover:opacity-100 transition-opacity">
              <svg
                viewBox={`0 0 ${sparklineSvg.width} ${sparklineSvg.height}`}
                className="w-full h-full overflow-visible"
              >
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={currentTrend.stroke}
                      stopOpacity="0.3"
                    />
                    <stop
                      offset="100%"
                      stopColor={currentTrend.stroke}
                      stopOpacity="0.0"
                    />
                  </linearGradient>
                </defs>
                <path d={sparklineSvg.areaPath} fill={`url(#${gradId})`} />
                <path
                  d={sparklineSvg.linePath}
                  fill="none"
                  stroke={currentTrend.stroke}
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Bottom row: Trend indicator & change label */}
        {(change !== undefined || changeLabel) && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/40 text-xs">
            {change !== undefined && (
              <div
                className={cn(
                  "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-mono font-medium border",
                  currentTrend.bgColor,
                  currentTrend.color,
                  currentTrend.borderColor
                )}
              >
                <TrendIcon className="h-3 w-3 shrink-0" />
                <span>
                  {change > 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              </div>
            )}
            {changeLabel && (
              <span className="text-muted-foreground text-[11px] truncate">
                {changeLabel}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
