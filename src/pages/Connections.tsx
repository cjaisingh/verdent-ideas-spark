import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, MinusCircle, Search, Plug } from "lucide-react";
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

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("connections-inventory", { body: {} });
    if (error) {
      toast({ title: "Failed to load connections", description: error.message, variant: "destructive" });
    } else {
      setInv(data as Inventory);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

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
    } catch (e) {
      toast({ title: "Probe failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setProbing(null);
    }
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
    const isProbing = probing === entry.env_var_name;
    return (
      <div className="flex items-start justify-between gap-3 px-3 py-2.5 border-b last:border-b-0">
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
              {verify?.latency_ms != null && ` · ${verify.latency_ms} ms`}
              {ago && ` · tested ${ago}`}
              {verify?.error && verify.outcome === "failed" && ` · ${verify.error}`}
            </div>
            {scopeLine && (
              <div className="text-xs text-muted-foreground/80 truncate mt-0.5">{scopeLine}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className={`gap-1 ${s.cls}`}>
            <Icon className="h-3 w-3" /> {s.label}
          </Badge>
          {entry.linked && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => reprobe(entry.env_var_name)}
              disabled={isProbing}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isProbing ? "animate-spin" : ""}`} />
              {isProbing ? "Testing…" : "Test connection"}
            </Button>
          )}
        </div>
      </div>
    );
  };

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
            ) : filter(merged.needsAction).map((l) => <Row key={l.connector_id} entry={l} verify={l.verify} />)}
          </Card>
        </TabsContent>

        <TabsContent value="linked">
          <Card>
            {filter(merged.linked).length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Nothing linked yet.</div>
            ) : filter(merged.linked).map((l) => <Row key={l.connector_id} entry={l} verify={l.verify} />)}
          </Card>
        </TabsContent>

        <TabsContent value="available">
          <Card className="overflow-hidden">
            <div className="px-3 py-2.5 border-b bg-muted/40 text-xs text-muted-foreground flex items-center justify-between">
              <span>Curated directory of common connectors. Manage in Lovable Cloud → Connectors.</span>
              <a
                href="https://lovable.dev/projects"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
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
    </div>
  );
}
