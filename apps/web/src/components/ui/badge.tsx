import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | "default"
    | "success"
    | "danger"
    | "warning"
    | "info"
    | "purple"
    | "outline"
    | "glass";
  size?: "sm" | "default";
  dot?: boolean;
  pulse?: boolean;
}

const badgeVariants: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default:
    "bg-secondary/60 text-secondary-foreground border-border/60 hover:bg-secondary/80",
  success:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/15",
  danger:
    "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25 hover:bg-rose-500/15",
  warning:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25 hover:bg-amber-500/15",
  info:
    "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25 hover:bg-sky-500/15",
  purple:
    "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25 hover:bg-indigo-500/15",
  outline:
    "bg-transparent text-foreground border-border/80 hover:bg-accent/40",
  glass:
    "bg-white/[0.04] backdrop-blur-md text-foreground border-white/10 hover:bg-white/[0.08]",
};

const dotColors: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "bg-muted-foreground",
  success: "bg-emerald-500 dark:bg-emerald-400",
  danger: "bg-rose-500 dark:bg-rose-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  info: "bg-sky-500 dark:bg-sky-400",
  purple: "bg-indigo-500 dark:bg-indigo-400",
  outline: "bg-foreground",
  glass: "bg-primary",
};

const badgeSizes: Record<NonNullable<BadgeProps["size"]>, string> = {
  sm: "px-1.5 py-0.5 text-[10px] leading-3 font-medium",
  default: "px-2.5 py-0.5 text-xs font-medium",
};

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      dot = false,
      pulse = false,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-md border font-mono tracking-tight transition-colors select-none",
          badgeVariants[variant],
          badgeSizes[size],
          className
        )}
        {...props}
      >
        {dot && (
          <span className="relative flex h-1.5 w-1.5 mr-1.5 shrink-0">
            {pulse && (
              <span
                className={cn(
                  "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                  dotColors[variant]
                )}
              />
            )}
            <span
              className={cn(
                "relative inline-flex rounded-full h-1.5 w-1.5",
                dotColors[variant]
              )}
            />
          </span>
        )}
        {children}
      </div>
    );
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
