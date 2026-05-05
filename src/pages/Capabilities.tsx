import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";

type Capability = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: string;
  owning_module: string | null;
};

type DemandEntry = {
  okr_id: string;
  okr_title: string;
  okr_status: string;
  tenant_id: string;
  tenant_name: string;
};

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  available: "default",
  planned: "secondary",
  experimental: "outline",
  deprecated: "destructive",
};

const Capabilities = () => {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [demand, setDemand] = useState<Record<string, DemandEntry[]>>({});

  useEffect(() => {
    supabase.from("capabilities").select("*").order("status").order("id").then(({ data }) => {
      setCaps(data ?? []);
    });
    (async () => {
      const { data: measurements } = await supabase
        .from("okr_measurements")
        .select("required_capabilities, okr_node_id");
      if (!measurements?.length) return;

      const nodeIds = measurements.map((m) => m.okr_node_id);
      const { data: nodes } = await supabase
        .from("okr_nodes")
        .select("id, title, status, tenant_id, tenants(name)")
        .in("id", nodeIds);
      const nodeMap = new Map(
        (nodes ?? []).map((n: any) => [
          n.id,
          {
            title: n.title as string,
            status: n.status as string,
            tenant_id: n.tenant_id as string,
            tenant_name: (n.tenants?.name ?? "Unknown") as string,
          },
        ]),
      );

      const map: Record<string, DemandEntry[]> = {};
      for (const m of measurements) {
        const meta = nodeMap.get(m.okr_node_id as string);
        if (!meta) continue;
        for (const c of (m.required_capabilities ?? []) as string[]) {
          if (!map[c]) map[c] = [];
          map[c].push({
            okr_id: m.okr_node_id as string,
            okr_title: meta.title,
            okr_status: meta.status,
            tenant_id: meta.tenant_id,
            tenant_name: meta.tenant_name,
          });
        }
      }
      setDemand(map);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Capability manifest</h1>
        <p className="text-sm text-muted-foreground">
          What AWIP can do, what's planned, and which OKRs are pulling for it.
        </p>
      </div>
      <div className="border border-border rounded-md divide-y divide-border">
        {caps.map((c) => {
          const refs = demand[c.id] ?? [];
          const tenantCount = new Set(refs.map((r) => r.tenant_id)).size;
          return (
            <Collapsible key={c.id}>
              <div className="p-4 flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{c.name}</span>
                    <Badge variant={statusVariant[c.status] ?? "outline"}>{c.status}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">{c.id}</span>
                  </div>
                  {c.description && <p className="text-sm text-muted-foreground mt-1">{c.description}</p>}
                  <div className="text-xs text-muted-foreground mt-1">
                    v{c.version}{c.owning_module ? ` · owned by ${c.owning_module}` : " · no owner yet"}
                  </div>
                </div>
                <CollapsibleTrigger
                  className="text-right group"
                  disabled={refs.length === 0}
                >
                  <div className="flex items-center gap-2 justify-end">
                    <div>
                      <div className="text-2xl font-semibold tabular-nums">{refs.length}</div>
                      <div className="text-xs text-muted-foreground">
                        OKR{refs.length === 1 ? "" : "s"}
                        {tenantCount > 0 && ` · ${tenantCount} tenant${tenantCount === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    {refs.length > 0 && (
                      <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                    )}
                  </div>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="px-4 pb-4 ml-0 space-y-1">
                  {refs.map((r) => (
                    <Link
                      key={r.okr_id}
                      to={`/tenants/${r.tenant_id}`}
                      className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted"
                    >
                      <Badge variant="outline" className="text-[10px]">{r.okr_status}</Badge>
                      <span className="text-muted-foreground">{r.tenant_name}</span>
                      <span>·</span>
                      <span>{r.okr_title}</span>
                    </Link>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
};

export default Capabilities;
