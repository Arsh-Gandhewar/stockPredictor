import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "glass" | "glow" | "metric" | "interactive";
}

const cardVariants: Record<NonNullable<CardProps["variant"]>, string> = {
  default:
    "bg-card/60 backdrop-blur-md border-border/50 shadow-sm hover:border-border/80 transition-all duration-200",
  glass:
    "bg-card/40 backdrop-blur-lg border-white/10 dark:border-white/5 shadow-lg shadow-black/5 hover:border-white/20 transition-all duration-200",
  glow:
    "bg-card/60 backdrop-blur-md border-border/50 shadow-sm hover:shadow-[0_0_25px_rgba(99,102,241,0.15)] hover:border-indigo-500/30 transition-all duration-200",
  metric:
    "relative overflow-hidden bg-card/60 backdrop-blur-md border-border/50 shadow-sm hover:border-border/80 transition-all duration-200 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-primary/30 before:to-transparent",
  interactive:
    "bg-card/60 backdrop-blur-md border-border/50 shadow-sm hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all duration-200",
};

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border text-card-foreground",
        cardVariants[variant] || cardVariants.default,
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "font-semibold leading-none tracking-tight text-foreground",
      className
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
