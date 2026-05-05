import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

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

const NodeRow = ({ node, children }: { node: Node; children: React.ReactNode }) => {
  const m = firstMeasurement(node.okr_measurements);
  const dim = node.status === "superseded";
  return (
    <li className={dim ? "opacity-50" : ""}>
      <div className="flex items-start gap-3 py-2">
        <Badge className={statusColor[node.status] ?? ""} variant="outline">{node.status}</Badge>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{node.kind === "objective" ? "O" : "KR"}</span>
            <span className="font-medium">{node.title}</span>
            <span className="text-xs text-muted-foreground">v{node.version} · {node.created_by}</span>
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

  useEffect(() => {
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
            <NodeRow key={n.id} node={n}>
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
    </div>
  );
};

export default TenantDetail;
