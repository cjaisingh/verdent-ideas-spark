import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Trash2, Database, Bot, FileText, History } from "lucide-react";

type RetentionRow = {
  table_name: string;
  retention_days: number;
  row_count: number;
  oldest: string | null;
};

type AutoLog = {
  enabled: boolean;
  capture_tokens: boolean;
  capture_duration: boolean;
  capture_model: boolean;
  capture_prompt: boolean;
  capture_response: boolean;
  capture_request_meta: boolean;
  capture_response_meta: boolean;
  extract_issues_fixes: boolean;
  source_lovable_agent: boolean;
  source_ai_gateway: boolean;
  source_awip_api: boolean;
};

const AGENT_MEMORY = [
  {
    path: "mem://index.md",
    type: "core",
    body: `AWIP Core: operator console + contract API. Substrate, not a brain — records OKRs and capability manifest, emits events; no "who acts when" logic.
Stack: React + Vite + Tailwind + Lovable Cloud (Supabase). Single edge function awip-api for the contract surface.
Every OKR mutation → okr_node_events; every manifest change → capability_events; all write endpoints idempotent via Idempotency-Key.
Auth: operator JWT or x-awip-service-token (cross-project). Roles in user_roles via has_role(); never store roles on profiles.
Cron jobs (scheduled-code-review, qa-validate, record-test-run) auth with AWIP_SERVICE_TOKEN; all new tables operator-only RLS + realtime.
GitHub repo (not GitLab). Nightly + weekly automation surfaced on /roadmap via AutomationPanel.`,
  },
  {
    path: "mem://features/automation.md",
    type: "feature",
    body: `Cron cadences, tables, alert webhook contract for code review / nightly tests / QA probes / alerts. See docs/automation.md for full reference.`,
  },
  {
    path: "mem://preferences/docs.md",
    type: "preference",
    body: `When shipping a meaningful feature: add docs/<topic>.md, link from README, append CHANGELOG entry under [Unreleased] then bump version. ADRs in docs/adr/ for architectural decisions only.`,
  },
];

const AUTOLOG_FIELDS: { key: keyof AutoLog; label: string; hint: string; group: "field" | "source" }[] = [
  { key: "capture_duration", label: "Duration", hint: "Wall-clock time per AI turn", group: "field" },
  { key: "capture_tokens", label: "Tokens", hint: "Prompt / completion / total", group: "field" },
  { key: "capture_model", label: "Model", hint: "Model name + inferred provider", group: "field" },
  { key: "capture_prompt", label: "Prompt preview", hint: "First ~500 chars of the user prompt", group: "field" },
  { key: "capture_response", label: "Response preview", hint: "First ~500 chars of the AI response", group: "field" },
  { key: "capture_request_meta", label: "Request metadata", hint: "Endpoint, system prompt, tool choices", group: "field" },
  { key: "capture_response_meta", label: "Response metadata", hint: "HTTP status, finish reason, tool calls", group: "field" },
  { key: "extract_issues_fixes", label: "Auto-extract issues/fixes", hint: "Parse labelled sections from the AI output", group: "field" },
  { key: "source_lovable_agent", label: "Lovable agent", hint: "Turns captured by the in-app TurnTracker", group: "source" },
  { key: "source_ai_gateway", label: "AI gateway", hint: "Turns posted via the AI gateway", group: "source" },
  { key: "source_awip_api", label: "AWIP API", hint: "Turns posted with the service token", group: "source" },
];

export default function Memory() {
  // ---- Retention
  const [stats, setStats] = useState<RetentionRow[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [purging, setPurging] = useState<string | null>(null);

  const loadStats = async () => {
    setLoadingStats(true);
    const { data, error } = await supabase.rpc("retention_stats" as any);
    if (error) toast({ title: "Failed to load stats", description: error.message, variant: "destructive" });
    setStats(((data as any) ?? []) as RetentionRow[]);
    setLoadingStats(false);
  };

  const setDays = async (table: string, days: number) => {
    const next = Math.max(0, Math.floor(days || 0));
    setStats((prev) => prev.map((r) => (r.table_name === table ? { ...r, retention_days: next } : r)));
    const { error } = await supabase
      .from("retention_settings" as any)
      .update({ retention_days: next, updated_at: new Date().toISOString() })
      .eq("table_name", table);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };

  const purge = async (table?: string) => {
    setPurging(table ?? "__all__");
    const { data, error } = await supabase.rpc("purge_expired_rows" as any, { _table: table ?? null });
    setPurging(null);
    if (error) {
      toast({ title: "Purge failed", description: error.message, variant: "destructive" });
      return;
    }
    const total = ((data as any[]) ?? []).reduce((s, r) => s + Number(r.deleted ?? 0), 0);
    toast({ title: `Purged ${total} row(s)` });
    loadStats();
  };

  const purgeAll = async (table: string) => {
    const row = stats.find((s) => s.table_name === table);
    const count = row?.row_count ?? 0;
    if (!window.confirm(`Delete ALL ${count.toLocaleString()} rows from ${table}? This cannot be undone.`)) return;
    setPurging(`all:${table}`);
    const { data, error } = await supabase.rpc("purge_all_rows" as any, { _table: table });
    setPurging(null);
    if (error) {
      toast({ title: "Purge failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Deleted ${Number(data ?? 0).toLocaleString()} row(s) from ${table}` });
    loadStats();
  };

  // ---- Autolog
  const [autolog, setAutolog] = useState<AutoLog | null>(null);

  const loadAutolog = async () => {
    const { data } = await supabase
      .from("roadmap_autolog_settings" as any)
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (data) setAutolog(data as unknown as AutoLog);
  };

  const toggleAutolog = async (key: keyof AutoLog) => {
    if (!autolog) return;
    const next = { ...autolog, [key]: !autolog[key] };
    setAutolog(next);
    const { error } = await supabase
      .from("roadmap_autolog_settings" as any)
      .upsert({ id: true, ...next, updated_at: new Date().toISOString() });
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };

  // ---- Audit log
  const [audit, setAudit] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(true);

  const loadAudit = async () => {
    setLoadingAudit(true);
    const { data, error } = await supabase
      .from("memory_audit_log" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast({ title: "Failed to load audit", description: error.message, variant: "destructive" });
    setAudit((data as any[]) ?? []);
    setLoadingAudit(false);
  };

  useEffect(() => {
    loadStats();
    loadAutolog();
    loadAudit();

    const ch = supabase
      .channel("memory_audit_log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "memory_audit_log" }, (p) => {
        setAudit((prev) => [p.new, ...prev].slice(0, 100));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Memory & retention</h1>
          <p className="text-sm text-muted-foreground">
            What the system remembers, what gets captured automatically, and how long it's kept.
          </p>
        </div>
      </header>

      {/* Agent memory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" /> Agent memory
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Read-only. These rules live in the Lovable build agent's <code className="font-mono">mem://</code> namespace and are
            applied to every code change. Edit them by asking the agent to remember or forget something.
          </p>
          {AGENT_MEMORY.map((m) => (
            <div key={m.path} className="border border-border rounded-md p-3 bg-card space-y-1">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <code className="text-xs font-mono">{m.path}</code>
                <Badge variant="outline" className="text-[10px]">{m.type}</Badge>
              </div>
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-sans leading-snug">
                {m.body}
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Autolog capture */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Auto-log capture
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!autolog ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <div className="font-medium text-sm">Auto-logging enabled</div>
                  <div className="text-xs text-muted-foreground">Master switch for all automatic sources</div>
                </div>
                <Switch checked={autolog.enabled} onCheckedChange={() => toggleAutolog("enabled")} />
              </div>
              <div className={`grid grid-cols-2 gap-2 ${autolog.enabled ? "" : "opacity-50 pointer-events-none"}`}>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Fields</p>
                  {AUTOLOG_FIELDS.filter((f) => f.group === "field").map((f) => (
                    <Row key={f.key} label={f.label} hint={f.hint} checked={autolog[f.key]} onChange={() => toggleAutolog(f.key)} />
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Sources</p>
                  {AUTOLOG_FIELDS.filter((f) => f.group === "source").map((f) => (
                    <Row key={f.key} label={f.label} hint={f.hint} checked={autolog[f.key]} onChange={() => toggleAutolog(f.key)} />
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Retention */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" /> Data retention
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadStats} disabled={loadingStats}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loadingStats ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => purge()} disabled={!!purging}>
              <Trash2 className="h-4 w-4 mr-1" />
              {purging === "__all__" ? "Purging…" : "Purge all expired"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Set retention in days per table. <strong>0 = keep forever.</strong> Rows older than the window are deleted on purge.
          </p>
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Table</th>
                  <th className="px-3 py-2 font-medium text-right">Rows</th>
                  <th className="px-3 py-2 font-medium">Oldest</th>
                  <th className="px-3 py-2 font-medium text-right">Retention (days)</th>
                  <th className="px-3 py-2 w-44" />
                </tr>
              </thead>
              <tbody>
                {stats.map((r) => (
                  <tr key={r.table_name} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{r.table_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.row_count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.oldest ? new Date(r.oldest).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        max={3650}
                        value={r.retention_days}
                        onChange={(e) => setDays(r.table_name, parseInt(e.target.value || "0", 10))}
                        className="w-20 bg-background border border-border rounded px-2 py-1 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={purging === r.table_name || r.retention_days === 0}
                        onClick={() => purge(r.table_name)}
                      >
                        {purging === r.table_name ? "…" : "Purge"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {stats.length === 0 && !loadingStats && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                      No retention rows configured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Memory audit log
          </CardTitle>
          <Button variant="outline" size="sm" onClick={loadAudit} disabled={loadingAudit}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loadingAudit ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Every change to retention windows, auto-log capture toggles, and agent memory files. Newest first, last 100 entries.
          </p>
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Scope</th>
                  <th className="px-3 py-2 font-medium">Entry</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Change</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{r.scope}</Badge></td>
                    <td className="px-3 py-2 font-mono">{r.entry_key}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={r.action === "removed" ? "destructive" : r.action === "added" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {r.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground max-w-md">
                      {r.action === "updated" ? (
                        <span>
                          <span className="line-through">{fmtVal(r.old_value)}</span>
                          {" → "}
                          <span className="text-foreground">{fmtVal(r.new_value)}</span>
                        </span>
                      ) : r.action === "added" ? (
                        <span className="text-foreground">{fmtVal(r.new_value)}</span>
                      ) : (
                        <span className="line-through">{fmtVal(r.old_value)}</span>
                      )}
                      {r.note ? <div className="text-muted-foreground italic mt-0.5">{r.note}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.actor ?? "—"}</td>
                  </tr>
                ))}
                {audit.length === 0 && !loadingAudit && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      No audit entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function fmtVal(v: any): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 1) return String(v[keys[0]]);
    return JSON.stringify(v);
  }
  return String(v);
}

function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-2">
      <div className="pr-3 min-w-0">
        <div className="text-sm font-medium truncate">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
