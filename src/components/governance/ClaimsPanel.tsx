// W7.2 — Claims & truth resolution panel.
// Operator-facing manual claim filing + winner display. Reads/writes go
// directly through the supabase client (RLS gates by has_role). For
// system/CI ingestion, use the claims-ingest edge function.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const ENTITIES = [
  "Tenant", "OkrNode", "Capability", "RoadmapPhase", "DiscussionAction",
  "Lesson", "SentinelFinding", "AuditFinding", "Capacity", "TestRun", "CapabilityEvent",
];
const SOURCES = ["operator", "ai", "ci", "system"];

type ResolveResult = {
  entity: string;
  entity_id: string;
  field: string;
  status: "resolved" | "conflict" | "no-claims";
  winner: { source: string; value: unknown; score: number; precedence: number; claimed_by_label?: string } | null;
  claims: Array<{
    id: string;
    source: string;
    value: unknown;
    confidence: number;
    score: number;
    precedence: number;
    valid_from: string;
    valid_to: string | null;
    claimed_by_label: string | null;
    created_at: string;
  }>;
  rules: Array<{ source: string; precedence: number; weight: number }>;
};

export function ClaimsPanel() {
  const [entity, setEntity] = useState("OkrNode");
  const [entityId, setEntityId] = useState("");
  const [field, setField] = useState("*");
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);

  // claim form
  const [source, setSource] = useState("operator");
  const [valueText, setValueText] = useState("");
  const [confidence, setConfidence] = useState(1);
  const [evidenceText, setEvidenceText] = useState("");
  const [supersedesId, setSupersedesId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  const resolve = async () => {
    if (!isUuid(entityId)) { toast.error("entity_id must be a UUID"); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("resolve_truth", {
      _entity: entity, _entity_id: entityId, _field: field || "*",
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setResolved(data as unknown as ResolveResult);
  };

  useEffect(() => { setResolved(null); }, [entity, entityId, field]);

  const fileClaim = async () => {
    if (!isUuid(entityId)) { toast.error("entity_id must be a UUID"); return; }
    let value: unknown;
    try { value = valueText.trim() ? JSON.parse(valueText) : null; }
    catch { toast.error("Value must be valid JSON"); return; }
    if (value === null) { toast.error("Value is required"); return; }
    let evidence: Record<string, unknown> = {};
    if (evidenceText.trim()) {
      try { evidence = JSON.parse(evidenceText); }
      catch { toast.error("Evidence must be valid JSON object"); return; }
    }
    setSubmitting(true);
    const { error } = await supabase.from("claims").insert({
      entity, entity_id: entityId, field: field || "*",
      source, value: value as never, confidence,
      evidence_ref: evidence,
      supersedes_id: supersedesId.trim() && isUuid(supersedesId) ? supersedesId : null,
      note: note || null,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Claim filed");
    setValueText(""); setEvidenceText(""); setSupersedesId(""); setNote("");
    await resolve();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claims & truth resolution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Entity</Label>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">entity_id (UUID)</Label>
            <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="uuid" className="font-mono text-xs" />
          </div>
          <div>
            <Label className="text-xs">Field</Label>
            <Input value={field} onChange={(e) => setField(e.target.value)} placeholder="*" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={resolve} disabled={loading}>{loading ? "Resolving…" : "Resolve truth"}</Button>
        </div>

        {resolved && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={resolved.status === "conflict" ? "destructive" : resolved.status === "resolved" ? "default" : "outline"}>
                {resolved.status}
              </Badge>
              <span className="text-xs text-muted-foreground">{resolved.claims.length} active claim(s)</span>
            </div>
            {resolved.winner && (
              <div className="text-sm">
                <span className="text-muted-foreground">Winner: </span>
                <Badge variant="secondary">{resolved.winner.source}</Badge>
                <span className="ml-2 font-mono text-xs">score {Number(resolved.winner.score).toFixed(2)} · prec {resolved.winner.precedence}</span>
                <pre className="mt-1 bg-muted/50 rounded p-2 text-xs overflow-auto max-h-40">{JSON.stringify(resolved.winner.value, null, 2)}</pre>
              </div>
            )}
            {resolved.claims.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Active claims</div>
                <ul className="space-y-1">
                  {resolved.claims.map((c) => (
                    <li key={c.id} className="text-xs flex items-center gap-2 font-mono">
                      <Badge variant="outline">{c.source}</Badge>
                      <span>prec {c.precedence}</span>
                      <span>conf {c.confidence}</span>
                      <span>score {Number(c.score).toFixed(2)}</span>
                      <span className="text-muted-foreground truncate">{JSON.stringify(c.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="border-t pt-4 space-y-3">
          <div className="text-sm font-medium">File a new claim</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Confidence (0–1)</Label>
              <Input type="number" min={0} max={1} step={0.1} value={confidence}
                onChange={(e) => setConfidence(Math.max(0, Math.min(1, Number(e.target.value) || 0)))} />
            </div>
            <div>
              <Label className="text-xs">Supersedes claim id (optional)</Label>
              <Input value={supersedesId} onChange={(e) => setSupersedesId(e.target.value)} placeholder="uuid" className="font-mono text-xs" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Value (JSON)</Label>
            <Textarea value={valueText} onChange={(e) => setValueText(e.target.value)}
              placeholder='e.g. {"status":"shipped"} or "shipped" or 42' rows={3} className="font-mono text-xs" />
          </div>
          <div>
            <Label className="text-xs">Evidence (JSON object — notebook_id, run_id, sha, url, …)</Label>
            <Textarea value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)}
              placeholder='{"notebook_id":"…","sha":"abc1234"}' rows={2} className="font-mono text-xs" />
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button onClick={fileClaim} disabled={submitting}>
            {submitting ? "Filing…" : "File claim"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
