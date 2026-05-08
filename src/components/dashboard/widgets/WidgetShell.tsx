import { ArrowUpRight, RefreshCw } from "lucide-react";
import { ReactNode } from "react";

export function WidgetShell({
  title,
  onOpen,
  children,
  scrollable = false,
}: {
  title: string;
  onOpen?: () => void;
  children: ReactNode;
  scrollable?: boolean;
}) {
  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-card text-card-foreground overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
          {title}
        </h3>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="text-muted-foreground hover:text-foreground transition"
            aria-label={`Open ${title}`}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className={`flex-1 min-h-0 px-3 py-2 ${scrollable ? "overflow-auto" : "overflow-hidden"}`}>
        {children}
      </div>
    </div>
  );
}

export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted-foreground">{children}</div>;
}

export function WidgetError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2">
      <div className="text-xs text-muted-foreground italic">Couldn't load data.</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}

export function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse" aria-hidden="true">
      <div className="h-6 w-16 rounded bg-muted" />
      <div className="space-y-1.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-muted" />
            <div className="h-3 flex-1 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
