import * as React from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "icon";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-[oklch(0.38_0.08_250)]",
  secondary: "bg-secondary text-secondary-foreground hover:bg-[oklch(0.90_0.01_250)]",
  outline: "border border-border bg-surface text-foreground hover:bg-secondary",
  ghost: "text-foreground hover:bg-secondary",
  destructive: "bg-destructive text-destructive-foreground hover:bg-[oklch(0.44_0.16_25)]",
};

const sizes: Record<ButtonSize, string> = {
  default: "h-8 px-3 py-1.5",
  sm: "h-7 px-2.5",
  icon: "h-8 w-8",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-3.5",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

