import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, RefreshCw } from "lucide-react";

type QaEvent = {
  id: string;
  qa_check_id: string;
  phase_key: string;
  criterion: string;
  kind: string;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  note: string | null;
  actor_label: string | null;
  created_at: string;
};

const EVENT_COLOURS: Record<string, string> = {
  created: "border-sky-500 text-sky-600 dark:text-sky-400",
  status_changed: "border-amber-500 text-amber-600 dark:text-amber-400",
  note_updated: "border-muted-foreground/40 text-muted-foreground",
  rechecked: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
  snapshot: "border-muted-foreground/30 text-muted-foreground",
};

export default function QaAuditLog() {
  const [events, setEvents] = useState<QaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("qa_check_events" as never)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error) setEvents((data ?? []) as unknown as QaEvent[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`qa-audit-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "qa_check_events" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const phases = useMemo(
    () => Array.from(new Set(events.map((e) => e.phase_key))).sort(),
    [events],
  );

  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (phaseFilter === "all" || e.phase_key === phaseFilter) &&
          (kindFilter === "all" || e.kind === kindFilter) &&
          (eventFilter === "all" || e.event_type === eventFilter),
      ),
    [events, phaseFilter, kindFilter, eventFilter],
  );

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link to="/roadmap/gate-diagnostics" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Gate diagnostics
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">QA audit log</h1>
          <p className="text-sm text-muted-foreground">
            Every override and judgement decision on <code>qa_checks</code>, newest first. Live updates via realtime.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            {filtered.length} event{filtered.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <span className="text-muted-foreground">Phase:</span>
            <Select value={phaseFilter} onValueChange={setPhaseFilter}>
              <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All phases</SelectItem>
                {phases.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>

            <span className="text-muted-foreground ml-2">Kind:</span>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                <SelectItem value="judgement">judgement</SelectItem>
                <SelectItem value="probe">probe</SelectItem>
              </SelectContent>
            </Select>

            <span className="text-muted-foreground ml-2">Event:</span>
            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                <SelectItem value="created">created</SelectItem>
                <SelectItem value="status_changed">status_changed</SelectItem>
                <SelectItem value="note_updated">note_updated</SelectItem>
                <SelectItem value="rechecked">rechecked</SelectItem>
                <SelectItem value="snapshot">snapshot</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr className="text-left">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Phase</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Change</th>
                  <th className="py-2 pr-3 font-medium">Criterion</th>
                  <th className="py-2 pr-3 font-medium">Actor</th>
                  <th className="py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b border-border/40 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{e.phase_key}</td>
                    <td className="py-1.5 pr-3 uppercase text-[10px] tracking-wide">{e.kind}</td>
                    <td className="py-1.5 pr-3">
                      <Badge variant="outline" className={EVENT_COLOURS[e.event_type] ?? ""}>
                        {e.event_type}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">
                      {e.old_status ?? "—"} → <span className="font-medium">{e.new_status ?? "—"}</span>
                    </td>
                    <td className="py-1.5 pr-3 max-w-[260px]">{e.criterion}</td>
                    <td className="py-1.5 pr-3">{e.actor_label ?? "system"}</td>
                    <td className="py-1.5 max-w-[320px] text-muted-foreground">
                      {e.note ?? <span className="italic">—</span>}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      No events match the current filters.
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
