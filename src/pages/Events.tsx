import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

type Event = {
  id: string;
  source: "okr" | "capability";
  ref: string;
  event_type: string;
  payload: unknown;
  actor: string | null;
  created_at: string;
};

const Events = () => {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    Promise.all([
      supabase.from("okr_node_events").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("capability_events").select("*").order("created_at", { ascending: false }).limit(100),
    ]).then(([o, c]) => {
      const merged: Event[] = [
        ...(o.data ?? []).map((e: any) => ({
          id: e.id, source: "okr" as const, ref: e.okr_node_id,
          event_type: e.event_type, payload: e.payload, actor: e.actor, created_at: e.created_at,
        })),
        ...(c.data ?? []).map((e: any) => ({
          id: e.id, source: "capability" as const, ref: e.capability_id,
          event_type: e.event_type, payload: e.payload, actor: e.actor, created_at: e.created_at,
        })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at));
      setEvents(merged);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Event log</h1>
        <p className="text-sm text-muted-foreground">
          Combined OKR + capability mutations. The stream a future Control Plane will subscribe to.
        </p>
      </div>
      <div className="border border-border rounded-md divide-y divide-border">
        {events.length === 0 && <div className="p-6 text-sm text-muted-foreground">No events yet.</div>}
        {events.map((e) => (
          <div key={`${e.source}-${e.id}`} className="p-3 flex items-start gap-3 text-sm">
            <Badge variant="outline">{e.source}</Badge>
            <span className="font-mono text-xs">{e.event_type}</span>
            <span className="font-mono text-xs text-muted-foreground truncate flex-1">{e.ref}</span>
            <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
            {e.actor && <span className="text-xs text-muted-foreground">{e.actor}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Events;
