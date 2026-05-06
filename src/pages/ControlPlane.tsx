import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type DemandRow = {
  id: string;
  name: string;
  status: string;
  owning_module: string | null;
  tenant_count: number;
  kr_count: number;
  active_kr_count: number;
};

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

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const statusVariant = (s: string) => {
  if (s === "available") return "default" as const;
  if (s === "planned") return "secondary" as const;
  if (s === "unknown") return "destructive" as const;
  return "outline" as const;
};

const ControlPlane = () => {
  const [demand, setDemand] = useState<DemandRow[] | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const lastSeen = useRef<string | null>(null);

  const loadDemand = async () => {
    try {
      const r = await fetch(`${FN}/capabilities/demand`, { headers: await authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "demand failed");
      setDemand(j.demand);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pollEvents = async () => {
    try {
      const url = new URL(`${FN}/events/recent`);
      if (lastSeen.current) url.searchParams.set("since", lastSeen.current);
      else url.searchParams.set("limit", "50");
      const r = await fetch(url.toString(), { headers: await authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "events failed");
      const fresh: EventRow[] = j.events ?? [];
      if (fresh.length > 0) {
        lastSeen.current = fresh[0].created_at;
        setEvents((prev) => [...fresh, ...prev].slice(0, 200));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    loadDemand();
    pollEvents();
    if (paused) return;
    const id = setInterval(() => {
      pollEvents();
      loadDemand();
    }, 5000);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Control Plane</h1>
          <p className="text-sm text-muted-foreground">
            Read-only view of the AWIP contract. Auto-refresh every 5s.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>

      {error && (
        <div className="border border-destructive/50 text-destructive text-sm rounded-md p-3 font-mono">
          {error}
        </div>
      )}

      <Tabs defaultValue="demand">
        <TabsList>
          <TabsTrigger value="demand">Demand board</TabsTrigger>
          <TabsTrigger value="feed">Live event feed</TabsTrigger>
        </TabsList>

        <TabsContent value="demand" className="mt-4">
          <div className="border border-border rounded-md overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
              <div className="col-span-4">Capability</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Module</div>
              <div className="col-span-1 text-right">Tenants</div>
              <div className="col-span-1 text-right">Active KRs</div>
              <div className="col-span-2 text-right">Total KRs</div>
            </div>
            <div className="divide-y divide-border">
              {!demand && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
              {demand?.length === 0 && (
                <div className="p-6 text-sm text-muted-foreground">No capability demand yet.</div>
              )}
              {demand?.map((d) => (
                <div key={d.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm items-center">
                  <div className="col-span-4">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{d.id}</div>
                  </div>
                  <div className="col-span-2">
                    <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                  </div>
                  <div className="col-span-2 text-xs font-mono text-muted-foreground">
                    {d.owning_module ?? "—"}
                  </div>
                  <div className="col-span-1 text-right tabular-nums">{d.tenant_count}</div>
                  <div className="col-span-1 text-right tabular-nums font-medium">{d.active_kr_count}</div>
                  <div className="col-span-2 text-right tabular-nums text-muted-foreground">{d.kr_count}</div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="feed" className="mt-4">
          <div className="border border-border rounded-md divide-y divide-border max-h-[60vh] overflow-auto">
            {events.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">Waiting for events…</div>
            )}
            {events.map((e) => (
              <div key={`${e.source}-${e.id}`} className="p-3 text-sm flex items-start gap-3 font-mono">
                <Badge variant="outline" className="shrink-0">{e.source}</Badge>
                <span className="text-xs shrink-0 text-muted-foreground">
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>
                <span className="text-xs shrink-0">{e.event_type}</span>
                <span className="text-xs text-muted-foreground truncate">{e.ref}</span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">{e.actor ?? "—"}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ControlPlane;
