// W9.1 — Operator upload → CSV/XLSX adapter → canonical_facts preview.
// Wires the three existing pieces (storage bucket, ingest-file, ingest-csv-adapter)
// into a single-page flow. Mappings can be picked from the approved set or
// authored inline (JSON), saved, approved, and re-used.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Upload, FileCheck2, AlertTriangle, Download } from "lucide-react";

type Mapping = {
  id: string;
  adapter_id: string;
  version: number;
  status: string;
  tenant_id: string | null;
  mapping: unknown;
  notes: string | null;
  created_at: string;
};

type AdapterResponse = {
  staging_batch_id: string;
  raw_record_id: string;
  rows_seen: number;
  rows_staged: number;
  rows_auto_promoted: number;
  rows_quarantined: number;
  conflicts_raised: number;
  auto_promote_eligible: boolean;
  precheck_failures: Array<{ reason: string; column?: string; row_no?: number }>;
  deduped: boolean;
  dry_run: boolean;
};

type CanonicalFactRow = {
  id: string;
  tenant_node_id: string | null;
  fact_type: string;
  value: unknown;
  effective_at: string;
  auto_promoted: boolean;
  staged_row_no: number | null;
};

const MAPPING_TEMPLATE = {
  kind: "csv",
  header_row: 1,
  delimiter: ",",
  tenant_node: { by: "fixed", value: "00000000-0000-0000-0000-000000000000" },
  effective_at: { by: "received_at" },
  facts: [
    { fact_type: "asset.area_m2", column: "area_m2", parser: "number", unit: "m2" },
    { fact_type: "asset.condition", column: "condition", parser: "string", required: false },
  ],
};

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function guessMime(name: string, fallback: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return fallback || "application/octet-stream";
}

export default function AdminIngestUpload() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [selectedMappingId, setSelectedMappingId] = useState<string>("");
  const [mappingJson, setMappingJson] = useState<string>(
    JSON.stringify(MAPPING_TEMPLATE, null, 2),
  );
  const [adapterId, setAdapterId] = useState<string>("csv-manual");
  const [engagementId, setEngagementId] = useState<string>("");
  const [domainId, setDomainId] = useState<string>("");
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<false | "upload" | "mapping" | "run">(false);
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [result, setResult] = useState<AdapterResponse | null>(null);
  const [facts, setFacts] = useState<CanonicalFactRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMappings = async () => {
    const { data } = await supabase
      .from("source_mappings" as any)
      .select("id, adapter_id, version, status, tenant_id, mapping, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    setMappings(((data ?? []) as unknown) as Mapping[]);
  };

  useEffect(() => {
    loadMappings();
  }, []);

  useEffect(() => {
    if (!selectedMappingId) return;
    const m = mappings.find((x) => x.id === selectedMappingId);
    if (m) {
      setMappingJson(JSON.stringify(m.mapping, null, 2));
      setAdapterId(m.adapter_id);
    }
  }, [selectedMappingId, mappings]);

  const selectedMapping = useMemo(
    () => mappings.find((m) => m.id === selectedMappingId) ?? null,
    [selectedMappingId, mappings],
  );

  const saveMapping = async (approve: boolean) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mappingJson);
    } catch (e) {
      toast({ title: "Invalid JSON", description: String(e), variant: "destructive" });
      return;
    }
    setBusy("mapping");
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (selectedMappingId) {
        const patch: Record<string, unknown> = {
          mapping: parsed,
          adapter_id: adapterId,
        };
        if (approve) {
          patch.status = "approved";
          patch.approved_by = user?.id ?? null;
          patch.approved_at = new Date().toISOString();
        }
        const { error } = await supabase
          .from("source_mappings" as any)
          .update(patch)
          .eq("id", selectedMappingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("source_mappings" as any)
          .insert({
            adapter_id: adapterId,
            version: 1,
            status: approve ? "approved" : "draft",
            mapping: parsed,
            approved_by: approve ? user?.id ?? null : null,
            approved_at: approve ? new Date().toISOString() : null,
            notes: "Created via /admin/ingest-upload",
          })
          .select("id")
          .single();
        if (error) throw error;
        setSelectedMappingId((data as unknown as { id: string }).id);
      }
      await loadMappings();
      toast({ title: approve ? "Mapping approved" : "Mapping saved" });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const uploadAndRegister = async (): Promise<string | null> => {
    if (!file) {
      toast({ title: "Pick a file first", variant: "destructive" });
      return null;
    }
    if (!/^[0-9a-f-]{36}$/i.test(engagementId)) {
      toast({ title: "engagement_id must be a UUID", variant: "destructive" });
      return null;
    }
    setBusy("upload");
    try {
      const buf = await file.arrayBuffer();
      const sha = await sha256Hex(buf);
      const mime = guessMime(file.name, file.type);
      const storagePath = `${engagementId}/${sha}/${file.name}`;

      const { error: upErr } = await supabase.storage
        .from("ingested-files")
        .upload(storagePath, buf, { contentType: mime, upsert: true });
      if (upErr) throw upErr;

      const { data, error } = await supabase.functions.invoke("ingest-file", {
        body: {
          engagement_id: engagementId,
          domain_id: /^[0-9a-f-]{36}$/i.test(domainId) ? domainId : null,
          storage_path: storagePath,
          filename: file.name,
          mime,
          size_bytes: file.size,
          sha256: sha,
          source: "upload",
        },
      });
      if (error) throw error;
      const fileId = (data as { file_id: string }).file_id;
      setUploadedFileId(fileId);
      toast({
        title: "File registered",
        description: `${(data as { route: string }).route} · ${fileId.slice(0, 8)}`,
      });
      return fileId;
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const runAdapter = async () => {
    if (!selectedMappingId) {
      toast({ title: "Select or save a mapping first", variant: "destructive" });
      return;
    }
    const fileId = uploadedFileId ?? (await uploadAndRegister());
    if (!fileId) return;

    setBusy("run");
    setResult(null);
    setFacts([]);
    try {
      const { data, error } = await supabase.functions.invoke("ingest-csv-adapter", {
        body: {
          file_id: fileId,
          source_mapping_id: selectedMappingId,
          dry_run: dryRun,
          pii_fields: [],
          max_rows: 10000,
        },
      });
      if (error) throw error;
      const res = data as AdapterResponse;
      setResult(res);

      if (!res.dry_run && res.staging_batch_id) {
        const { data: fRows } = await supabase
          .from("canonical_facts" as any)
          .select("id, tenant_node_id, fact_type, value, effective_at, auto_promoted, staged_row_no")
          .eq("staging_batch_id", res.staging_batch_id)
          .order("staged_row_no", { ascending: true })
          .limit(500);
        setFacts(((fRows ?? []) as unknown) as CanonicalFactRow[]);
      }
      toast({
        title: res.dry_run ? "Dry run complete" : "Adapter run complete",
        description: `${res.rows_seen} seen · ${res.rows_auto_promoted} promoted · ${res.rows_quarantined} quarantined · ${res.conflicts_raised} conflicts`,
      });
    } catch (e) {
      toast({
        title: "Adapter failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Upload className="h-5 w-5" /> Ingest Upload
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV/XLSX, pick or author a mapping, and see the parsed{" "}
          <code>canonical_facts</code> for that batch.
        </p>
      </header>

      {/* Step 1 — file + engagement */}
      <section className="border rounded-md p-4 space-y-3">
        <h2 className="font-medium">1. File &amp; scope</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>Engagement ID (UUID)</Label>
            <Input
              placeholder="00000000-0000-0000-0000-000000000000"
              value={engagementId}
              onChange={(e) => setEngagementId(e.target.value.trim())}
            />
          </div>
          <div>
            <Label>Domain ID (UUID, optional)</Label>
            <Input
              placeholder="optional"
              value={domainId}
              onChange={(e) => setDomainId(e.target.value.trim())}
            />
          </div>
        </div>
        <div>
          <Label>File</Label>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setUploadedFileId(null);
              setResult(null);
              setFacts([]);
            }}
          />
          {file && (
            <div className="text-xs text-muted-foreground mt-1">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
              {uploadedFileId && (
                <Badge variant="outline" className="ml-2">
                  <FileCheck2 className="h-3 w-3 mr-1" /> registered {uploadedFileId.slice(0, 8)}
                </Badge>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Step 2 — mapping */}
      <section className="border rounded-md p-4 space-y-3">
        <h2 className="font-medium">2. Mapping</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>Existing mapping</Label>
            <Select
              value={selectedMappingId || "__new__"}
              onValueChange={(v) => {
                if (v === "__new__") {
                  setSelectedMappingId("");
                  setMappingJson(JSON.stringify(MAPPING_TEMPLATE, null, 2));
                  setAdapterId("csv-manual");
                } else {
                  setSelectedMappingId(v);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select or create new" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">— New mapping —</SelectItem>
                {mappings.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.adapter_id} v{m.version} · {m.status} · {m.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedMapping && (
              <div className="text-xs text-muted-foreground mt-1">
                Status:{" "}
                <Badge variant={selectedMapping.status === "approved" ? "default" : "outline"}>
                  {selectedMapping.status}
                </Badge>
              </div>
            )}
          </div>
          <div>
            <Label>adapter_id</Label>
            <Input value={adapterId} onChange={(e) => setAdapterId(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Mapping JSON</Label>
          <Textarea
            value={mappingJson}
            onChange={(e) => setMappingJson(e.target.value)}
            className="font-mono text-xs h-56"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Shape: <code>CsvMappingSchema</code> in{" "}
            <code>_shared/contracts/ingest-csv-adapter.ts</code>. Adapter promotes rows to{" "}
            <code>canonical_facts</code> only when the mapping is <code>approved</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveMapping(false)}
            disabled={busy !== false}
          >
            {busy === "mapping" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save draft
          </Button>
          <Button size="sm" onClick={() => saveMapping(true)} disabled={busy !== false}>
            {busy === "mapping" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save &amp; approve
          </Button>
        </div>
      </section>

      {/* Step 3 — run */}
      <section className="border rounded-md p-4 space-y-3">
        <h2 className="font-medium">3. Run adapter</h2>
        <div className="flex items-center gap-2">
          <Checkbox
            id="dry_run"
            checked={dryRun}
            onCheckedChange={(v) => setDryRun(v === true)}
          />
          <Label htmlFor="dry_run" className="text-sm cursor-pointer">
            Dry run (parse &amp; validate only, no writes)
          </Label>
        </div>
        <Button onClick={runAdapter} disabled={busy !== false || !file || !selectedMappingId}>
          {busy === "upload" || busy === "run" ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          {uploadedFileId ? "Run adapter" : "Upload &amp; run adapter"}
        </Button>
      </section>

      {/* Result */}
      {result && (
        <section className="border rounded-md p-4 space-y-3">
          <h2 className="font-medium flex items-center gap-2">
            {result.auto_promote_eligible ? (
              <FileCheck2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )}
            Result {result.dry_run && <Badge variant="outline">dry run</Badge>}
            {result.deduped && <Badge variant="secondary">deduped replay</Badge>}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Metric label="rows_seen" value={result.rows_seen} />
            <Metric label="rows_staged" value={result.rows_staged} />
            <Metric label="promoted" value={result.rows_auto_promoted} tone="good" />
            <Metric label="quarantined" value={result.rows_quarantined} tone="warn" />
            <Metric label="conflicts" value={result.conflicts_raised} tone="warn" />
          </div>
          {result.precheck_failures.length > 0 && (
            <div className="text-xs">
              <div className="font-medium mb-1">Precheck failures</div>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                {result.precheck_failures.slice(0, 20).map((p, i) => (
                  <li key={i}>
                    <code>{p.reason}</code>
                    {p.column ? ` · column=${p.column}` : ""}
                    {p.row_no ? ` · row=${p.row_no}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground font-mono">
            batch {result.staging_batch_id.slice(0, 8)} · raw {result.raw_record_id.slice(0, 8)}
          </div>
        </section>
      )}

      {facts.length > 0 && (
        <section className="border rounded-md overflow-hidden">
          <div className="p-3 bg-muted/50 font-medium text-sm">
            canonical_facts for this batch ({facts.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr className="text-left">
                  <th className="p-2">row</th>
                  <th className="p-2">fact_type</th>
                  <th className="p-2">tenant_node</th>
                  <th className="p-2">effective_at</th>
                  <th className="p-2">value</th>
                </tr>
              </thead>
              <tbody>
                {facts.map((f) => (
                  <tr key={f.id} className="border-t">
                    <td className="p-2 font-mono">{f.staged_row_no ?? "—"}</td>
                    <td className="p-2 font-mono">{f.fact_type}</td>
                    <td className="p-2 font-mono">
                      {f.tenant_node_id ? f.tenant_node_id.slice(0, 8) : "—"}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {new Date(f.effective_at).toLocaleString()}
                    </td>
                    <td className="p-2 font-mono max-w-md truncate">
                      {JSON.stringify(f.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn";
}) {
  const cls =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "";
  return (
    <div className="border rounded p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
