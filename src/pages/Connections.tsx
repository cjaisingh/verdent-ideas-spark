import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeInvoke } from "@/integrations/supabase/safe-invoke";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, MinusCircle, Search, Plug, Unplug, Link2, History } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Verify = {
  outcome: "verified" | "skipped" | "failed" | "unknown";
  latency_ms?: number;
  error?: string;
  scope_hint?: Record<string, unknown> | null;
};

type DirEntry = {
  connector_id: string;
  name: string;
  uses_gateway: boolean;
  env_var_name: string;
  category: string;
  linked: boolean;
};

type LinkedEntry = DirEntry & { verify: Verify; tested_at?: string | null };

type Extra = { key: string; name: string; purpose: string; present: boolean };

type Inventory = {
  linked: LinkedEntry[];
  directory: DirEntry[];
  extras: Extra[];
  fetched_at: string;
  next_run_at?: string | null;
};

type AuditRow = {
  id: string;
  connector_id: string;
  action: "unlink_intent" | "relink_intent" | "verified_after_relink";
  created_at: string;
  note: string | null;
};

const CONNECTORS_URL = "https://lovable.dev/projects";

// Per-connector impact copy. Add entries here to enable unlink/relink for more connectors.
const IMPACT: Record<string, { label: string; impacts: string[] }> = {
  telegram: {
    label: "Telegram",
    impacts: [
      "Companion mobile alerts will stop sending",
      "AWIP service notifications routed via Telegram will fail",
      "Any cron job posting to Telegram chats will error",
    ],
  },
};

function statusOf(e: DirEntry, verify?: Verify): { label: string; cls: string; icon: typeof CheckCircle2 } {
  if (!e.linked) return { label: "Available", cls: "bg-muted text-muted-foreground", icon: MinusCircle };
  if (!e.uses_gateway) return { label: "Linked (direct API)", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 };
  if (!verify) return { label: "Linked", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 };
  if (verify.outcome === "failed") return { label: "Reconnect", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: AlertTriangle };
  if (verify.outcome === "verified") return { label: "Verified", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 };
  if (verify.outcome === "skipped") return { label: "Linked", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 };
  return { label: "Unknown", cls: "bg-muted text-muted-foreground", icon: MinusCircle };
}

export default function Connections() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<Record<string, "unlink" | "relink" | undefined>>({});
  const [audit, setAudit] = useState<Record<string, AuditRow[]>>({});
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<{ kind: "unlink" | "relink"; entry: DirEntry } | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await safeInvoke("connections-inventory", { body: {} });
    if (error) {
      toast({ title: "Failed to load connections", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } else {
      setInv(data as Inventory);
    }
    setLoading(false);
  };

  const loadAudit = async (connectorId: string) => {
    const { data, error } = await supabase
      .from("connection_audit_log")
      .select("id, connector_id, action, created_at, note")
      .eq("connector_id", connectorId)
      .order("created_at", { ascending: false })
      .limit(3);
    if (!error && data) setAudit((cur) => ({ ...cur, [connectorId]: data as AuditRow[] }));
  };

  useEffect(() => { void load(); }, []);

  // Refresh on tab focus so returning from Cloud → Connectors updates the UI.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  const reprobe = async (envVar: string) => {
    setProbing(envVar);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connections-inventory?probe=${encodeURIComponent(envVar)}`;
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
      setInv((cur) => {
        if (!cur) return cur;
        return {
          ...cur,
          linked: cur.linked.map((l) => l.env_var_name === envVar ? { ...l, verify: body.verify, tested_at: body.fetched_at } : l),
        };
      });
      const desc = body.verify.outcome === "failed"
        ? (body.verify.error ?? "no detail")
        : `${body.verify.latency_ms ?? "?"} ms${body.verify.scope_hint ? ` · ${Object.entries(body.verify.scope_hint).slice(0, 2).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}` : ""}`;
      toast({
        title: `${envVar}: ${body.verify.outcome}`,
        description: desc.slice(0, 160),
        variant: body.verify.outcome === "failed" ? "destructive" : "default",
      });
      return body.verify as Verify;
    } catch (e) {
      toast({ title: "Probe failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return null;
    } finally {
      setProbing(null);
    }
  };

  const writeAudit = async (connectorId: string, envVar: string, action: AuditRow["action"], note?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("connection_audit_log").insert({
      connector_id: connectorId,
      env_var_name: envVar,
      action,
      actor_user_id: user.id,
      note: note ?? null,
    });
    if (error) {
      toast({ title: "Audit log failed", description: error.message, variant: "destructive" });
    } else {
      void loadAudit(connectorId);
    }
  };

  const startRelinkPoll = (entry: DirEntry) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    const start = Date.now();
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - start > 60_000) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        return;
      }
      const v = await reprobe(entry.env_var_name);
      if (v && v.outcome === "verified") {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setPending((p) => ({ ...p, [entry.connector_id]: undefined }));
        await writeAudit(entry.connector_id, entry.env_var_name, "verified_after_relink");
        toast({ title: `${IMPACT[entry.connector_id]?.label ?? entry.name} relinked`, description: "Connection verified." });
      }
    }, 5000) as unknown as number;
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    const { kind, entry } = dialog;
    setPending((p) => ({ ...p, [entry.connector_id]: kind }));
    await writeAudit(entry.connector_id, entry.env_var_name, kind === "unlink" ? "unlink_intent" : "relink_intent");
    window.open(CONNECTORS_URL, "_blank", "noopener,noreferrer");
    if (kind === "relink") startRelinkPoll(entry);
    setDialog(null);
  };

  const merged = useMemo(() => {
    if (!inv) return { linked: [] as LinkedEntry[], available: [] as DirEntry[], needsAction: [] as LinkedEntry[] };
    const linked = inv.linked;
    const available = inv.directory.filter((d) => !d.linked);
    const needsAction = linked.filter((l) => l.verify?.outcome === "failed");
    return { linked, available, needsAction };
  }, [inv]);

  const filter = <T extends DirEntry>(rows: T[]) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(needle) || r.connector_id.includes(needle) || r.env_var_name.toLowerCase().includes(needle));
  };

  const Row = ({ entry, verify, testedAt }: { entry: DirEntry; verify?: Verify; testedAt?: string | null }) => {
    const s = statusOf(entry, verify);
    const Icon = s.icon;
    const scopeLine = verify?.scope_hint && verify.outcome === "verified"
      ? Object.entries(verify.scope_hint).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")
      : null;
    const ago = testedAt ? `${Math.max(0, Math.round((Date.now() - new Date(testedAt).getTime()) / 60000))}m ago` : null;
    const nextRun = inv?.next_run_at ? (() => {
      const mins = Math.max(0, Math.round((new Date(inv.next_run_at!).getTime() - Date.now()) / 60000));
      return mins === 0 ? "any moment" : `in ${mins}m`;
    })() : null;
    const isProbing = probing === entry.env_var_name;
    const impact = IMPACT[entry.connector_id];
    const pendingState = pending[entry.connector_id];
    const showRelink = entry.linked && impact && (verify?.outcome === "failed" || pendingState === "unlink");
    const showUnlink = entry.linked && impact && pendingState !== "unlink";
    const history = audit[entry.connector_id] ?? [];
    const isHistoryOpen = !!showHistory[entry.connector_id];

    return (
      <div className="border-b last:border-b-0">
        <div className="flex items-start justify-between gap-3 px-3 py-2.5">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Plug className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{entry.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                <code className="font-mono">{entry.connector_id}</code>
                {" · "}
                <code className="font-mono">{entry.env_var_name}</code>
                {" · "}
                {entry.uses_gateway ? "gateway" : "direct API"}
              </div>
              {entry.linked && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs mt-1">
                  <span className="text-muted-foreground">
                    Last sync: <span className="text-foreground">{ago ?? "never"}</span>
                    {verify?.latency_ms != null && ` (${verify.latency_ms} ms)`}
                  </span>
                  {verify?.error && verify.outcome === "failed" ? (
                    <span className="text-destructive truncate max-w-md">Error: {verify.error}</span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400">No errors</span>
                  )}
                  {nextRun && (
                    <span className="text-muted-foreground">Next run: {nextRun}</span>
                  )}
                </div>
              )}
              {scopeLine && (
                <div className="text-xs text-muted-foreground/80 truncate mt-0.5">{scopeLine}</div>
              )}
              {pendingState === "unlink" && (
                <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Awaiting unlink in Cloud → Connectors</div>
              )}
              {pendingState === "relink" && (
                <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Awaiting relink — polling every 5s for up to 1 min</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary" className={`gap-1 ${s.cls}`}>
              <Icon className="h-3 w-3" /> {s.label}
            </Badge>
            {entry.linked && (
              <Button size="sm" variant="outline" onClick={() => reprobe(entry.env_var_name)} disabled={isProbing}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isProbing ? "animate-spin" : ""}`} />
                {isProbing ? "Testing…" : "Test"}
              </Button>
            )}
            {showRelink && (
              <Button size="sm" variant="default" onClick={() => { void loadAudit(entry.connector_id); setDialog({ kind: "relink", entry }); }}>
                <Link2 className="h-3.5 w-3.5 mr-1" /> Relink
              </Button>
            )}
            {showUnlink && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { void loadAudit(entry.connector_id); setDialog({ kind: "unlink", entry }); }}>
                <Unplug className="h-3.5 w-3.5 mr-1" /> Unlink
              </Button>
            )}
            {impact && (
              <Button size="sm" variant="ghost" onClick={() => { setShowHistory((h) => ({ ...h, [entry.connector_id]: !isHistoryOpen })); if (!isHistoryOpen) void loadAudit(entry.connector_id); }}>
                <History className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {isHistoryOpen && (
          <div className="px-3 pb-2.5 pl-10 text-xs text-muted-foreground space-y-0.5">
            {history.length === 0 ? (
              <div>No audit entries yet.</div>
            ) : history.map((a) => (
              <div key={a.id}>
                <span className="font-mono">{new Date(a.created_at).toLocaleString()}</span> · {a.action.replace(/_/g, " ")}
                {a.note ? ` · ${a.note}` : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const dialogImpact = dialog ? IMPACT[dialog.entry.connector_id] : null;

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Connections</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {inv
              ? `${merged.linked.length} linked · ${merged.available.length} available · ${merged.needsAction.length} need action`
              : "Loading inventory…"}
            {inv?.fetched_at && ` · refreshed ${new Date(inv.fetched_at).toLocaleTimeString()}`}
            {inv?.next_run_at && ` · next auto-probe ${new Date(inv.next_run_at).toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, connector_id, or env var" className="pl-9" />
      </div>

      <Tabs defaultValue="needs">
        <TabsList>
          <TabsTrigger value="needs">Needs action ({merged.needsAction.length})</TabsTrigger>
          <TabsTrigger value="linked">Linked ({merged.linked.length})</TabsTrigger>
          <TabsTrigger value="available">Available ({merged.available.length})</TabsTrigger>
          <TabsTrigger value="extras">Other secrets ({inv?.extras.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="needs">
          <Card>
            {filter(merged.needsAction).length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Everything that's linked verifies cleanly.</div>
            ) : filter(merged.needsAction).map((l) => <Row key={l.connector_id} entry={l} verify={l.verify} testedAt={l.tested_at} />)}
          </Card>
        </TabsContent>

        <TabsContent value="linked">
          <Card>
            {filter(merged.linked).length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Nothing linked yet.</div>
            ) : filter(merged.linked).map((l) => <Row key={l.connector_id} entry={l} verify={l.verify} testedAt={l.tested_at} />)}
          </Card>
        </TabsContent>

        <TabsContent value="available">
          <Card className="overflow-hidden">
            <div className="px-3 py-2.5 border-b bg-muted/40 text-xs text-muted-foreground flex items-center justify-between">
              <span>Curated directory of common connectors. Manage in Lovable Cloud → Connectors.</span>
              <a href={CONNECTORS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                Open Connectors <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {filter(merged.available).map((d) => <Row key={d.connector_id} entry={d} />)}
          </Card>
        </TabsContent>

        <TabsContent value="extras">
          <Card>
            {(inv?.extras ?? []).map((e) => (
              <div key={e.key} className="flex items-center justify-between px-3 py-2.5 border-b last:border-b-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground"><code className="font-mono">{e.key}</code> · {e.purpose}</div>
                </div>
                <Badge variant="secondary" className={e.present ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}>
                  {e.present ? "present" : "missing"}
                </Badge>
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!dialog} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <AlertDialogContent>
          {dialog && dialogImpact && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {dialog.kind === "unlink" ? `Unlink ${dialogImpact.label}?` : `Relink ${dialogImpact.label}`}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3 text-sm">
                    {dialog.kind === "unlink" ? (
                      <>
                        <p>The following will stop working until you relink:</p>
                        <ul className="list-disc pl-5 space-y-1">
                          {dialogImpact.impacts.map((i) => <li key={i}>{i}</li>)}
                        </ul>
                        <p className="text-muted-foreground">
                          <code className="font-mono">{dialog.entry.env_var_name}</code> will be removed from this project's runtime.
                        </p>
                        <p>
                          The unlink itself happens in Lovable Cloud → Connectors. We'll log the intent now and re-check the connection when you return.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>Pick the existing {dialogImpact.label} connection in Cloud → Connectors and link it to this project again.</p>
                        <p className="text-muted-foreground">If the workspace connection still exists, you don't need to re-enter credentials.</p>
                        <p>We'll poll the connection every 5 seconds for up to a minute and confirm when it verifies.</p>
                      </>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDialog}
                  className={dialog.kind === "unlink" ? "bg-destructive hover:bg-destructive/90" : ""}
                >
                  {dialog.kind === "unlink" ? "Open Connectors to unlink" : "Open Connectors to relink"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
