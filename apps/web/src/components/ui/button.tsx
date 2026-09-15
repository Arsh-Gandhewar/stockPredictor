import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "premium"
    | "glow"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "relative inline-flex items-center justify-center font-medium rounded-lg text-xs select-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";

    const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
      default:
        "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm border border-primary/20",
      premium:
        "bg-gradient-to-b from-neutral-800/95 to-neutral-900/95 text-neutral-100 border border-white/10 hover:border-white/20 hover:from-neutral-800 hover:to-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)]",
      glow:
        "bg-gradient-to-r from-indigo-500 via-indigo-600 to-indigo-700 hover:from-indigo-600 hover:to-indigo-800 text-white shadow-[0_0_20px_rgba(99,102,241,0.35)] hover:shadow-[0_0_28px_rgba(99,102,241,0.55)] border border-indigo-400/40",
      destructive:
        "bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 hover:border-rose-500/30 hover:text-rose-300 shadow-sm",
      outline:
        "border border-border/80 bg-background/50 backdrop-blur-sm hover:bg-accent hover:text-accent-foreground text-foreground shadow-sm",
      secondary:
        "bg-secondary/80 backdrop-blur-sm text-secondary-foreground hover:bg-secondary border border-border/40 shadow-sm",
      ghost:
        "hover:bg-accent/70 hover:text-accent-foreground text-muted-foreground hover:text-foreground shadow-none",
      link:
        "text-primary underline-offset-4 hover:underline shadow-none p-0 h-auto font-normal",
    };

    const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
      default: "h-9 px-4 py-2 gap-2",
      sm: "h-8 rounded-md px-3 text-xs gap-1.5",
      lg: "h-11 rounded-lg px-6 text-sm gap-2.5",
      icon: "h-9 w-9 rounded-lg p-0",
      "icon-sm": "h-8 w-8 rounded-md p-0",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5 text-current shrink-0" />
        )}
        {!isLoading && leftIcon && (
          <span className="inline-flex shrink-0 items-center">{leftIcon}</span>
        )}
        {children}
        {!isLoading && rightIcon && (
          <span className="inline-flex shrink-0 items-center">{rightIcon}</span>
        )}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
