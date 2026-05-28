import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { RemindersPanel } from "@/components/scheduler/RemindersPanel";

type Measurement = {
  metric_name: string;
  baseline: number | null;
  target: number | null;
  unit: string | null;
  cadence: string | null;
  required_capabilities: string[];
};

type Node = {
  id: string;
  parent_id: string | null;
  kind: "objective" | "key_result";
  title: string;
  description: string | null;
  status: string;
  version: number;
  superseded_by: string | null;
  spawned_from_reason: string | null;
  created_by: string;
  created_at: string;
  okr_measurements: Measurement | Measurement[] | null;
};

const firstMeasurement = (m: Node["okr_measurements"]): Measurement | undefined =>
  Array.isArray(m) ? m[0] : m ?? undefined;

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-primary text-primary-foreground",
  superseded: "bg-secondary text-muted-foreground line-through",
  achieved: "bg-green-600 text-white",
  abandoned: "bg-destructive text-destructive-foreground",
};

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;

async function callApi(path: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FN_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

const NodeRow = ({
  node,
  onSpawn,
  onSupersede,
  children,
}: {
  node: Node;
  onSpawn: (n: Node) => void;
  onSupersede: (n: Node) => void;
  children: React.ReactNode;
}) => {
  const m = firstMeasurement(node.okr_measurements);
  const dim = node.status === "superseded";
  return (
    <li className={dim ? "opacity-50" : ""}>
      <div className="flex items-start gap-3 py-2">
        <Badge className={statusColor[node.status] ?? ""} variant="outline">{node.status}</Badge>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{node.kind === "objective" ? "O" : "KR"}</span>
            <span className="font-medium">{node.title}</span>
            <span className="text-xs text-muted-foreground">v{node.version} · {node.created_by}</span>
            {!dim && (
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => onSpawn(node)}>Spawn sub-OKR</Button>
                <Button size="sm" variant="ghost" onClick={() => onSupersede(node)}>Supersede</Button>
              </div>
            )}
          </div>
          {node.description && <p className="text-sm text-muted-foreground">{node.description}</p>}
          {node.spawned_from_reason && (
            <p className="text-xs italic text-muted-foreground mt-1">Spawn reason: {node.spawned_from_reason}</p>
          )}
          {m && (
            <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
              <div>
                Metric: <span className="font-mono">{m.metric_name}</span>
                {m.baseline !== null && <> · baseline {m.baseline}</>}
                {m.target !== null && <> · target {m.target}</>}
                {m.unit && <> {m.unit}</>}
                {m.cadence && <> · {m.cadence}</>}
              </div>
              {m.required_capabilities?.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {m.required_capabilities.map((c) => (
                    <span key={c} className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {children && <ul className="ml-6 border-l border-border pl-4">{children}</ul>}
    </li>
  );
};

const TenantDetail = () => {
  const { id } = useParams();
  const [tenantName, setTenantName] = useState<string>("");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [spawnFor, setSpawnFor] = useState<Node | null>(null);
  const [supersedeFor, setSupersedeFor] = useState<Node | null>(null);
  const [busy, setBusy] = useState(false);

  // Spawn form
  const [spKind, setSpKind] = useState<"objective" | "key_result">("key_result");
  const [spTitle, setSpTitle] = useState("");
  const [spDesc, setSpDesc] = useState("");
  const [spReason, setSpReason] = useState("");

  // Supersede form
  const [suTitle, setSuTitle] = useState("");
  const [suDesc, setSuDesc] = useState("");
  const [suReason, setSuReason] = useState("");

  const load = useCallback(() => {
    if (!id) return;
    supabase.from("tenants").select("name").eq("id", id).single().then(({ data }) => {
      if (data) setTenantName(data.name);
    });
    supabase
      .from("okr_nodes")
      .select("*, okr_measurements(*)")
      .eq("tenant_id", id)
      .order("created_at")
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setNodes((data ?? []) as unknown as Node[]);
      });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const openSpawn = (n: Node) => {
    setSpKind(n.kind === "objective" ? "key_result" : "key_result");
    setSpTitle(""); setSpDesc(""); setSpReason("");
    setSpawnFor(n);
  };

  const openSupersede = (n: Node) => {
    setSuTitle(n.title); setSuDesc(n.description ?? ""); setSuReason("");
    setSupersedeFor(n);
  };

  const submitSpawn = async () => {
    if (!spawnFor) return;
    if (!spTitle.trim() || !spReason.trim()) {
      toast.error("Title and spawn reason are required");
      return;
    }
    setBusy(true);
    try {
      await callApi(`/okr/${spawnFor.id}/spawn`, {
        kind: spKind,
        title: spTitle,
        description: spDesc || undefined,
        spawned_from_reason: spReason,
        created_by: "human",
      });
      toast.success("Sub-OKR spawned");
      setSpawnFor(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitSupersede = async () => {
    if (!supersedeFor) return;
    if (!suTitle.trim() || !suReason.trim()) {
      toast.error("Title and reason are required");
      return;
    }
    setBusy(true);
    try {
      await callApi(`/okr/${supersedeFor.id}/supersede`, {
        title: suTitle,
        description: suDesc || undefined,
        reason: suReason,
        created_by: "human",
      });
      toast.success("Node superseded");
      setSupersedeFor(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tree = useMemo(() => {
    const byParent = new Map<string | null, Node[]>();
    for (const n of nodes) {
      const k = n.parent_id;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(n);
    }
    const render = (parentId: string | null): React.ReactNode => {
      const kids = byParent.get(parentId) ?? [];
      if (kids.length === 0) return null;
      return (
        <ul className="space-y-1">
          {kids.map((n) => (
            <NodeRow key={n.id} node={n} onSpawn={openSpawn} onSupersede={openSupersede}>
              {render(n.id)}
            </NodeRow>
          ))}
        </ul>
      );
    };
    return render(null);
  }, [nodes]);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/tenants" className="text-xs text-muted-foreground hover:underline">← Tenants</Link>
        <h1 className="text-2xl font-semibold">{tenantName || "Tenant"}</h1>
        <p className="text-sm text-muted-foreground">{nodes.length} node{nodes.length === 1 ? "" : "s"}</p>
      </div>
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No OKRs yet. Discovery AI will POST drafts to <code className="font-mono">/okr/ingest</code>.</p>
      ) : (
        tree
      )}

      {id && (
        <RemindersPanel
          subjectType="tenant"
          subjectId={id}
          tenantId={id}
          subjectLabel={tenantName}
        />
      )}

      {/* Spawn dialog */}
      <Dialog open={!!spawnFor} onOpenChange={(o) => !o && setSpawnFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Spawn sub-OKR</DialogTitle>
            <DialogDescription>
              Under: <span className="font-medium">{spawnFor?.title}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Kind</Label>
              <Select value={spKind} onValueChange={(v) => setSpKind(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="objective">Objective</SelectItem>
                  <SelectItem value="key_result">Key result</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={spTitle} onChange={(e) => setSpTitle(e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={spDesc} onChange={(e) => setSpDesc(e.target.value)} />
            </div>
            <div>
              <Label>Spawn reason <span className="text-destructive">*</span></Label>
              <Textarea
                value={spReason}
                onChange={(e) => setSpReason(e.target.value)}
                placeholder="Why is this sub-OKR needed now?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSpawnFor(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submitSpawn} disabled={busy}>Spawn</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supersede dialog */}
      <Dialog open={!!supersedeFor} onOpenChange={(o) => !o && setSupersedeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supersede OKR</DialogTitle>
            <DialogDescription>
              Replacing: <span className="font-medium">{supersedeFor?.title}</span> (v{supersedeFor?.version})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>New title</Label>
              <Input value={suTitle} onChange={(e) => setSuTitle(e.target.value)} />
            </div>
            <div>
              <Label>New description</Label>
              <Textarea value={suDesc} onChange={(e) => setSuDesc(e.target.value)} />
            </div>
            <div>
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Textarea
                value={suReason}
                onChange={(e) => setSuReason(e.target.value)}
                placeholder="Why is the previous version no longer right?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSupersedeFor(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submitSupersede} disabled={busy}>Supersede</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TenantDetail;
