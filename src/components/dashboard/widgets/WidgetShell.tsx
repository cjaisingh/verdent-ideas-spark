import { ArrowUpRight } from "lucide-react";
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

export function WidgetError() {
  return <div className="text-xs text-muted-foreground italic">unavailable</div>;
}
