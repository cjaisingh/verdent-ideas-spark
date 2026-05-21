import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw, FileJson, AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import {
  evaluateBench,
  ADR_DECISION_QUESTIONS,
  type TriggerStatus,
} from "@/lib/adr-bench-thresholds";

type Row = {
  id: string;
  adr: string;
  ran_at: string;
  dataset_hash: string;
  metrics: Record<string, number>;
  notes: string | null;
  tripped_triggers: string[];
  source: string;
  created_at: string;
};

const ADRS = ["adr-0003", "adr-0004", "adr-0005", "adr-0006"] as const;

function statusBadge(s: TriggerStatus) {
  if (s === "revisit") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> revisit
      </Badge>
    );
  }
  if (s === "watch") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
        <Eye className="h-3 w-3" /> watch
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" /> green
    </Badge>
  );
}

function fmtMetric(k: string, v: number): string {
  if (k.endsWith("_pct")) return `${v}%`;
  if (k.endsWith("_eur") || k.endsWith("_eur_30d")) return `€${v.toFixed(2)}`;
  if (k.endsWith("_ms")) return `${v} ms`;
  if (k.endsWith("_days")) return `${v} d`;
  return v.toLocaleString();
}

function RowCard({ row }: { row: Row }) {
  const ev = evaluateBench(row.adr, row.metrics);
  const metricEntries = Object.entries(row.metrics);
  return (
    <div className="border border-border rounded-md p-3 bg-card space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {statusBadge(ev.status)}
          <span className="text-xs tabular-nums text-muted-foreground">
            {new Date(row.ran_at).toLocaleString()}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">
            dataset {row.dataset_hash.slice(0, 12)}
          </span>
          <Badge variant="secondary" className="text-[10px]">{row.source}</Badge>
        </div>
      </div>

      {metricEntries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">no metrics recorded</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
          {metricEntries.map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-border/50 py-0.5">
              <span className="text-muted-foreground truncate" title={k}>{k}</span>
              <span className="tabular-nums font-medium">{fmtMetric(k, Number(v) || 0)}</span>
            </div>
          ))}
        </div>
      )}

      {(ev.tripped.length > 0 || ev.watch.length > 0) && (
        <div className="flex flex-wrap gap-1 pt-1">
          {ev.tripped.map((t) => (
            <Badge key={t} variant="destructive" className="text-[10px]">{t}</Badge>
          ))}
          {ev.watch.map((w) => (
            <Badge key={w} variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
              {w}
            </Badge>
          ))}
          {row.tripped_triggers.map((t) => (
            <Badge key={`db-${t}`} variant="destructive" className="text-[10px]">script: {t}</Badge>
          ))}
        </div>
      )}

      {row.notes && (
        <p className="text-[11px] text-muted-foreground italic">{row.notes}</p>
      )}
    </div>
  );
}

function AdrPanel({ adr, rows }: { adr: string; rows: Row[] }) {
  const latest = rows[0];
  const history = rows.slice(1);
  const latestEv = latest ? evaluateBench(adr, latest.metrics) : null;

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-md p-3 bg-muted/30 space-y-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-medium">{adr.toUpperCase()}</div>
          {latestEv && statusBadge(latestEv.status)}
        </div>
        <p className="text-xs text-muted-foreground">{ADR_DECISION_QUESTIONS[adr] ?? ""}</p>
        <a
          href={`https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/adr/benchmarks.md`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] underline text-muted-foreground hover:text-foreground"
        >
          benchmarks.md §{adr.toUpperCase()}
        </a>
      </div>

      {!latest ? (
        <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
          No bench results recorded yet. Run <code className="font-mono">scripts/adr-bench/{adr}-*.ts</code> with the
          service role key set, or insert manually.
        </div>
      ) : (
        <>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Latest</div>
            <RowCard row={latest} />
          </div>

          {history.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                History ({history.length})
              </div>
              <div className="space-y-2">
                {history.map((r) => <RowCard key={r.id} row={r} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminAdrBench() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("adr-0006");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("adr_bench_results")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(200);
    if (error) console.error("adr_bench_results load", error);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("adr-bench-results-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "adr_bench_results" },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const grouped = useMemo(() => {
    const g: Record<string, Row[]> = {};
    for (const r of rows) (g[r.adr] ??= []).push(r);
    return g;
  }, [rows]);

  return (
    <div className="container mx-auto py-6 space-y-4 max-w-5xl">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">ADR benchmarks</h1>
          <p className="text-sm text-muted-foreground">
            History of <code className="font-mono">scripts/adr-bench/*</code> runs.
            Status is derived from <a href="https://github.com/cjaisingh/verdent-ideas-spark/blob/main/docs/adr/benchmarks.md"
              className="underline" target="_blank" rel="noreferrer">benchmarks.md</a> thresholds.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {ADRS.map((adr) => {
          const latest = grouped[adr]?.[0];
          const ev = latest ? evaluateBench(adr, latest.metrics) : null;
          return (
            <button
              key={adr}
              onClick={() => setTab(adr)}
              className={`text-left border rounded-md p-2 hover:bg-muted/50 transition ${tab === adr ? "border-primary" : "border-border"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono">{adr}</span>
                {ev ? statusBadge(ev.status) : <Badge variant="secondary" className="text-[10px]">no data</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {grouped[adr]?.length ?? 0} run{(grouped[adr]?.length ?? 0) === 1 ? "" : "s"}
              </div>
            </button>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {ADRS.map((adr) => (
            <TabsTrigger key={adr} value={adr} className="text-xs font-mono">{adr}</TabsTrigger>
          ))}
        </TabsList>
        {ADRS.map((adr) => (
          <TabsContent key={adr} value={adr} className="mt-4">
            <AdrPanel adr={adr} rows={grouped[adr] ?? []} />
          </TabsContent>
        ))}
      </Tabs>

      <footer className="text-[11px] text-muted-foreground pt-4 border-t border-border flex items-center gap-1">
        <FileJson className="h-3 w-3" /> Local JSON output lives in <code className="font-mono">bench-results/</code> (gitignored); rows shown here are uploaded by the bench scripts when <code className="font-mono">SUPABASE_URL</code> + service role key are set.
      </footer>
    </div>
  );
}
