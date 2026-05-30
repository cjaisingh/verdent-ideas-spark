import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, RefreshCw } from "lucide-react";

type ThresholdRow = {
  band: "auto_bind" | "conflict" | "no_match";
  min_score: number;
  updated_at: string;
  updated_by: string | null;
};

type DecisionRow = {
  id: string;
  request_id: string | null;
  tenant_id: string;
  candidate_count: number;
  winning_node_id: string | null;
  match_source: string | null;
  score: number | null;
  confidence_band: string;
  authoritative_hit: boolean;
  latency_ms: number | null;
  actor_label: string | null;
  matched_kinds: string[] | null;
  created_at: string;
};

const BAND_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  auto_bind: "default",
  conflict: "secondary",
  no_match: "outline",
  high: "default",
  medium: "secondary",
  low: "outline",
  none: "outline",
};

export default function AdminResolver() {
  const { toast } = useToast();
  const [thresholds, setThresholds] = useState<ThresholdRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  const load = async () => {
    setLoading(true);
    const [thr, dec] = await Promise.all([
      supabase
        .from("resolver_thresholds")
        .select("band, min_score, updated_at, updated_by")
        .order("min_score", { ascending: false }),
      supabase
        .from("resolver_decisions")
        .select("id, request_id, tenant_id, candidate_count, winning_node_id, match_source, score, confidence_band, authoritative_hit, latency_ms, actor_label, matched_kinds, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const rows = (thr.data ?? []) as ThresholdRow[];
    setThresholds(rows);
    setDraft(Object.fromEntries(rows.map((r) => [r.band, String(r.min_score)])));
    setDecisions((dec.data ?? []) as DecisionRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin-resolver-thresholds")
      .on("postgres_changes", { event: "*", schema: "public", table: "resolver_thresholds" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const dirty = useMemo(
    () => thresholds.some((r) => String(r.min_score) !== draft[r.band]),
    [thresholds, draft],
  );

  const save = async () => {
    if (reason.trim().length < 8) {
      toast({ title: "Reason required", description: "Min 8 characters.", variant: "destructive" });
      return;
    }
    const next = thresholds.map((r) => ({
      band: r.band,
      min_score: parseFloat(draft[r.band] ?? String(r.min_score)),
    }));
    if (next.some((n) => Number.isNaN(n.min_score) || n.min_score < 0 || n.min_score > 1)) {
      toast({ title: "Invalid score", description: "Each score must be in [0, 1].", variant: "destructive" });
      return;
    }
    setSaving(true);
    const idemKey = `thr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await supabase.functions.invoke("awip-api", {
      method: "PUT",
      body: { thresholds: next, reason: reason.trim() },
      headers: { "Idempotency-Key": idemKey, "x-awip-path": "/resolver/thresholds" },
    });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Thresholds updated", description: JSON.stringify((data as any)?.current ?? data) });
    setReason("");
    load();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Resolver thresholds</h1>
          <p className="text-sm text-muted-foreground">
            Band cut-offs used by <code>resolve_entity_logged</code>. Changes audit to{" "}
            <code>resolver_thresholds_audit</code> and snapshot on every decision row.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </header>

      <Card>
        <CardHeader><CardTitle>Band cut-offs</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {thresholds.map((r) => (
              <div key={r.band} className="space-y-2">
                <Label className="capitalize">{r.band.replace("_", " ")}</Label>
                <Input
                  type="number" step="0.01" min="0" max="1"
                  value={draft[r.band] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [r.band]: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Current: {r.min_score} · updated {new Date(r.updated_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Reason (audit trail, ≥ 8 chars)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you changing these thresholds?"
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Must satisfy: auto_bind &gt; conflict &gt; no_match ≥ 0.
            </p>
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent decisions (50)</CardTitle></CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions logged yet.</p>
          ) : (
            <div className="space-y-2">
              {decisions.map((d) => (
                <div key={d.id} className="flex items-center justify-between border-b py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={BAND_VARIANT[d.confidence_band] ?? "outline"}>{d.confidence_band}</Badge>
                    <span className="font-mono text-xs">{d.score ?? "—"}</span>
                    <span className="text-muted-foreground">{d.match_source ?? "—"}</span>
                    {d.matched_kinds && d.matched_kinds.length > 0 && (
                      <span className="text-xs text-muted-foreground">[{d.matched_kinds.join(", ")}]</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {d.latency_ms ?? "?"}ms · {new Date(d.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
