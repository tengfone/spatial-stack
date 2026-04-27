import * as React from "react";

import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline" | "warning";

const variants: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-border bg-secondary text-secondary-foreground",
  outline: "border-border bg-transparent text-foreground",
  warning: "border-amber-300 bg-amber-100 text-amber-900",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: BadgeVariant }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-[0.68rem] font-semibold uppercase",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
