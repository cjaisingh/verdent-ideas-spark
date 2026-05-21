import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DESCRIPTOR_KINDS = [
  "asset_code", "name", "address", "postcode",
  "bim_ifc_guid", "rics_id", "os_uprn", "sap_floc", "other",
] as const;
type DescKind = typeof DESCRIPTOR_KINDS[number];

type Descriptor = { kind: DescKind; value: string; authoritative?: boolean };
type Candidate = {
  nodeId: string;
  ancestry: string[];
  score: number;
  matchedDescriptors: string[];
  matchSource: "authoritative" | "alias_exact" | "alias_fts" | "embedding_hint";
};

export default function Entities() {
  const [tenantId, setTenantId] = useState("");
  const [raw, setRaw] = useState(
    JSON.stringify([{ kind: "name", value: "" }], null, 2),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    candidates: Candidate[];
    authoritativeHit: boolean;
  } | null>(null);

  async function probe() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let descriptors: Descriptor[];
      try {
        descriptors = JSON.parse(raw);
      } catch {
        throw new Error("Descriptors must be valid JSON array");
      }
      const { data, error: invErr } = await supabase.functions.invoke("entity-resolve", {
        body: { tenantId, descriptors },
      });
      if (invErr) throw invErr;
      if ((data as { error?: unknown })?.error) {
        throw new Error(JSON.stringify((data as { error: unknown }).error));
      }
      setResult(data as { candidates: Candidate[]; authoritativeHit: boolean });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Entities</h1>
        <p className="text-muted-foreground mt-1">
          Phase 5 sprint s5.1 — resolver probe. Read-only. Match order:
          authoritative → alias_exact → alias_fts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resolver probe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenant">Tenant ID (UUID)</Label>
            <Input
              id="tenant"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="descs">Descriptors (JSON array)</Label>
            <Textarea
              id="descs"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={8}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Kinds: {DESCRIPTOR_KINDS.join(", ")}
            </p>
          </div>
          <Button onClick={probe} disabled={busy || !tenantId}>
            {busy ? "Resolving…" : "Probe resolver"}
          </Button>
          {error && (
            <div className="text-sm text-destructive border border-destructive/30 rounded p-3">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Candidates ({result.candidates.length})
              {result.authoritativeHit && (
                <Badge variant="default">authoritative hit</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No candidates. Propose-new-node is a separate operator flow.
              </p>
            ) : (
              <div className="space-y-3">
                {result.candidates.map((c) => (
                  <div
                    key={c.nodeId}
                    className="border rounded p-3 space-y-2 text-sm"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono">{c.nodeId}</code>
                      <Badge variant="outline">score {c.score.toFixed(2)}</Badge>
                      <Badge variant="secondary">{c.matchSource}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      matched: {c.matchedDescriptors.join(", ") || "—"}
                    </div>
                    {c.ancestry.length > 1 && (
                      <div className="text-xs text-muted-foreground">
                        ancestry: {c.ancestry.join(" → ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
