import { cn } from "@/lib/utils";

export function Progress({ className, value }: { className?: string; value: number }) {
  return (
    <div className={cn("h-[6px] w-full overflow-hidden rounded-sm bg-muted", className)}>
      <div
        className="h-full rounded-sm bg-accent transition-[width] duration-300 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

