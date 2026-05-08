import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type EventRow = {
  id: string;
  source: "okr" | "capability";
  ref: string;
  tenant_id: string | null;
  event_type: string;
  payload: unknown;
  actor: string | null;
  created_at: string;
};

type Window = "15m" | "1h" | "24h" | "7d";
const WINDOW_MS: Record<Window, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};
const WINDOW_LABEL: Record<Window, string> = {
  "15m": "last 15 min",
  "1h": "last hour",
  "24h": "last 24 hours",
  "7d": "last 7 days",
};

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const EventStream = ({ paused, onError }: { paused: boolean; onError?: (msg: string) => void }) => {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | "okr" | "capability">("all");
  const [windowSize, setWindowSize] = useState<Window>("1h");
  const lastSeen = useRef<string | null>(null);

  const pollEvents = async () => {
    try {
      const url = new URL(`${FN}/events/recent`);
      if (lastSeen.current) url.searchParams.set("since", lastSeen.current);
      else url.searchParams.set("limit", "50");
      const r = await fetch(url.toString(), { headers: await authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "events failed");
      const fresh: EventRow[] = j.events ?? [];
      setLastPoll(new Date());
      if (fresh.length > 0) {
        lastSeen.current = fresh[0].created_at;
        const floor = Date.now() - WINDOW_MS[windowSize];
        setEvents((prev) =>
          [...fresh, ...prev].filter((e) => new Date(e.created_at).getTime() >= floor),
        );
        const ids = new Set(fresh.map((e) => `${e.source}-${e.id}`));
        setFreshIds(ids);
        setTimeout(() => setFreshIds(new Set()), 1800);
      }
    } catch (e) {
      onError?.((e as Error).message);
    }
  };

  // Re-window: trim in-memory list when window shrinks
  useEffect(() => {
    const floor = Date.now() - WINDOW_MS[windowSize];
    setEvents((prev) => prev.filter((e) => new Date(e.created_at).getTime() >= floor));
  }, [windowSize]);

  useEffect(() => {
    pollEvents();
    if (paused) return;
    const id = setInterval(pollEvents, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, windowSize]);

  const visible = useMemo(
    () => events.filter((e) => sourceFilter === "all" || e.source === sourceFilter),
    [events, sourceFilter],
  );

  const bumpWindow = () => {
    const order: Window[] = ["15m", "1h", "24h", "7d"];
    const i = order.indexOf(windowSize);
    if (i < order.length - 1) setWindowSize(order[i + 1]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border border-border rounded-md p-0.5">
          {(["15m", "1h", "24h", "7d"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindowSize(w)}
              className={`px-2.5 py-1 text-xs rounded ${
                windowSize === w
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
        <div className="flex gap-1 border border-border rounded-md p-0.5">
          {(["all", "okr", "capability"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1 text-xs rounded ${
                sourceFilter === s
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`inline-block h-2 w-2 rounded-full ${paused ? "bg-muted-foreground" : "bg-emerald-500 animate-pulse"}`} />
          {paused ? "Paused" : "Live"}
          {lastPoll && <span>· polled {lastPoll.toLocaleTimeString()}</span>}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {visible.length} events · {WINDOW_LABEL[windowSize]}
        </div>
      </div>

      <div className="border border-border rounded-md max-h-[60vh] overflow-auto">
        {visible.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground flex items-center justify-between gap-3">
            <span>No events in the {WINDOW_LABEL[windowSize]}.</span>
            {windowSize !== "7d" && (
              <Button variant="outline" size="sm" onClick={bumpWindow}>
                Load older
              </Button>
            )}
          </div>
        )}
        <div className="divide-y divide-border">
          {visible.map((e) => {
            const key = `${e.source}-${e.id}`;
            const isFresh = freshIds.has(key);
            const isOkr = e.source === "okr";
            return (
              <div
                key={key}
                className={`flex items-stretch text-sm transition-colors ${isFresh ? "bg-primary/10" : ""}`}
              >
                <div
                  className={`w-1 shrink-0 ${isOkr ? "bg-blue-500" : "bg-amber-500"}`}
                  aria-hidden
                />
                <div className="flex-1 p-3 flex items-start gap-3 font-mono">
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${
                      isOkr
                        ? "border-blue-500/40 text-blue-500"
                        : "border-amber-500/40 text-amber-500"
                    }`}
                  >
                    {e.source}
                  </Badge>
                  <span className="text-xs shrink-0 text-muted-foreground tabular-nums">
                    {new Date(e.created_at).toLocaleTimeString()}
                  </span>
                  <span className="text-xs shrink-0 font-medium">{e.event_type}</span>
                  <span className="text-xs text-muted-foreground truncate" title={e.ref}>
                    {e.ref}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {e.actor ?? "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EventStream;
