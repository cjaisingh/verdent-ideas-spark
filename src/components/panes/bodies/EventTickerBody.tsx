import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Source = "okr" | "capability" | "discussion";

interface TickerRow {
  id: string;
  source: Source;
  event_type: string;
  summary: string;
  href: string;
  created_at: string;
}

type TabKey = "all" | Source;

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "okr", label: "OKR" },
  { key: "capability", label: "Capability" },
  { key: "discussion", label: "Discussion" },
];

const SOURCE_COLOR: Record<Source, string> = {
  okr: "bg-tint-okr/15 text-tint-okr",
  capability: "bg-tint-capability/15 text-tint-capability",
  discussion: "bg-tint-discussion/15 text-tint-discussion",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function summarize(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  const keys = ["title", "name", "summary", "status", "verdict"].filter((k) => obj[k] != null);
  if (keys.length === 0) return JSON.stringify(obj).slice(0, 80);
  return keys.map((k) => `${k}=${String(obj[k]).slice(0, 40)}`).join(" ");
}

function hrefFor(source: Source, row: Record<string, unknown>): string {
  if (source === "capability" && row.capability_id) return `/capabilities/${row.capability_id}`;
  if (source === "okr") return "/roadmap";
  if (source === "discussion") return "/night";
  return "/events";
}

export function EventTickerBody() {
  const [tab, setTab] = useState<TabKey>("all");
  const [rows, setRows] = useState<TickerRow[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const append = (row: TickerRow) => {
    if (pausedRef.current) return;
    setRows((prev) => [row, ...prev].slice(0, 200));
  };

  useEffect(() => {
    let active = true;

    (async () => {
      const [okr, cap, disc] = await Promise.all([
        supabase.from("okr_node_events").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("capability_events").select("*").order("created_at", { ascending: false }).limit(50),
        supabase
          .from("discussion_action_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (!active) return;

      const merged: TickerRow[] = [];
      for (const r of (okr.data as Array<Record<string, unknown>>) ?? []) {
        merged.push({
          id: `okr:${r.id}`,
          source: "okr",
          event_type: String(r.event_type ?? r.type ?? "event"),
          summary: summarize(r.payload ?? r),
          href: hrefFor("okr", r),
          created_at: String(r.created_at),
        });
      }
      for (const r of (cap.data as Array<Record<string, unknown>>) ?? []) {
        merged.push({
          id: `cap:${r.id}`,
          source: "capability",
          event_type: String(r.event_type ?? r.type ?? "event"),
          summary: summarize(r.payload ?? r),
          href: hrefFor("capability", r),
          created_at: String(r.created_at),
        });
      }
      for (const r of (disc.data as Array<Record<string, unknown>>) ?? []) {
        merged.push({
          id: `disc:${r.id}`,
          source: "discussion",
          event_type: String(r.event_type ?? "event"),
          summary: summarize(r.payload ?? r),
          href: hrefFor("discussion", r),
          created_at: String(r.created_at),
        });
      }
      merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setRows(merged.slice(0, 200));
    })();

    const sub = (table: string, source: Source) =>
      supabase
        .channel(`pane-ticker-${table}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table }, (payload) => {
          const r = payload.new as Record<string, unknown>;
          append({
            id: `${source}:${String(r.id)}`,
            source,
            event_type: String(r.event_type ?? r.type ?? "event"),
            summary: summarize(r.payload ?? r),
            href: hrefFor(source, r),
            created_at: String(r.created_at ?? new Date().toISOString()),
          });
        })
        .subscribe();

    const channels = [
      sub("okr_node_events", "okr"),
      sub("capability_events", "capability"),
      sub("discussion_action_events", "discussion"),
    ];

    return () => {
      active = false;
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, []);

  const filtered = tab === "all" ? rows : rows.filter((r) => r.source === tab);

  return (
    <div className="h-full flex flex-col">
      <div className="h-8 px-3 flex items-center gap-2 border-b border-border shrink-0">
        <div className="inline-flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "px-2 py-0.5 text-[11px] rounded transition-colors",
                tab === t.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">{filtered.length} events</span>
        <button
          onClick={() => setPaused((p) => !p)}
          className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[11px]">
        {filtered.length === 0 ? (
          <div className="p-3 text-muted-foreground">No events yet.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.map((r) => (
              <li key={r.id} className="px-3 py-1.5 flex items-center gap-2 hover:bg-muted/40">
                <span className="text-muted-foreground tabular-nums shrink-0">{fmtTime(r.created_at)}</span>
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-sans font-medium shrink-0",
                    SOURCE_COLOR[r.source],
                  )}
                >
                  {r.source}
                </span>
                <span className="text-foreground shrink-0">{r.event_type}</span>
                <span className="text-muted-foreground truncate">{r.summary}</span>
                <Link
                  to={r.href}
                  className="ml-auto text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                >
                  open →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
