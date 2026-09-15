import * as React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "circular" | "card";
}

function Skeleton({
  className,
  variant = "default",
  ...props
}: SkeletonProps) {
  const variantStyles = {
    default: "rounded-lg",
    circular: "rounded-full",
    card: "rounded-xl border border-border/40 p-6",
  };

  return (
    <div
      className={cn(
        "bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40 animate-pulse",
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
