import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

type Capability = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: string;
  owning_module: string | null;
};

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  available: "default",
  planned: "secondary",
  experimental: "outline",
  deprecated: "destructive",
};

const Capabilities = () => {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [demand, setDemand] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.from("capabilities").select("*").order("status").order("id").then(({ data }) => {
      setCaps(data ?? []);
    });
    supabase.from("okr_measurements").select("required_capabilities").then(({ data }) => {
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        for (const c of (row.required_capabilities ?? []) as string[]) {
          counts[c] = (counts[c] ?? 0) + 1;
        }
      }
      setDemand(counts);
    });
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
        {caps.map((c) => (
          <div key={c.id} className="p-4 flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <Badge variant={statusVariant[c.status] ?? "outline"}>{c.status}</Badge>
                <span className="text-xs text-muted-foreground font-mono">{c.id}</span>
              </div>
              {c.description && <p className="text-sm text-muted-foreground mt-1">{c.description}</p>}
              <div className="text-xs text-muted-foreground mt-1">
                v{c.version}{c.owning_module ? ` · owned by ${c.owning_module}` : " · no owner yet"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums">{demand[c.id] ?? 0}</div>
              <div className="text-xs text-muted-foreground">OKRs need this</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Capabilities;
