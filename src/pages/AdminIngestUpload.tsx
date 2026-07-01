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
import { Loader2, Upload, FileCheck2, AlertTriangle, Download, ArrowUp, ArrowDown, ArrowUpDown, X, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

type QuarantinePreview = {
  row_no: number;
  fact_type: string;
  column: string;
  tenant_node_id: string | null;
  effective_at: string | null;
  raw_value: unknown;
  errors: Array<Record<string, unknown>>;
};

type ConflictPreview = {
  row_no: number;
  fact_type: string;
  tenant_node_id: string;
  effective_at: string;
  incoming_value: unknown;
  existing_canonical_id: string;
  existing_value_hash: string;
  existing_value?: unknown;
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
  quarantine_preview: QuarantinePreview[];
  conflicts_preview: ConflictPreview[];
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
  const [retryingRow, setRetryingRow] = useState<number | null>(null);
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

  const refreshBatchState = async (batchId: string) => {
    const [{ data: stagedRows }, { data: conflictRows }, { data: fRows }] = await Promise.all([
      supabase
        .from("staged_records" as any)
        .select("row_no, fact_type, tenant_node_id, effective_at, value, validation_status, validation_errors, descriptors")
        .eq("staging_batch_id", batchId)
        .order("row_no", { ascending: true })
        .limit(50000),
      supabase
        .from("fact_conflicts" as any)
        .select("row_no, fact_type, tenant_node_id, incoming_value, existing_value, existing_canonical_id")
        .eq("staging_batch_id", batchId)
        .order("row_no", { ascending: true })
        .limit(50000),
      supabase
        .from("canonical_facts" as any)
        .select("id, tenant_node_id, fact_type, value, effective_at, auto_promoted, staged_row_no")
        .eq("staging_batch_id", batchId)
        .order("staged_row_no", { ascending: true })
        .limit(500),
    ]);
    const staged = ((stagedRows ?? []) as unknown) as Array<Record<string, unknown>>;
    const conflicts = ((conflictRows ?? []) as unknown) as Array<Record<string, unknown>>;
    const quarantined = staged.filter((s) => s.validation_status === "quarantined");
    const promoted = staged.filter((s) => s.validation_status === "passed");
    setFacts(((fRows ?? []) as unknown) as CanonicalFactRow[]);
    setResult((prev) => prev && ({
      ...prev,
      rows_staged: staged.length,
      rows_auto_promoted: promoted.length,
      rows_quarantined: quarantined.length,
      conflicts_raised: conflicts.length,
      quarantine_preview: quarantined.slice(0, 50).map((s) => ({
        row_no: s.row_no as number,
        fact_type: s.fact_type as string,
        column: (s.descriptors as { source_column?: string } | null)?.source_column ?? "",
        tenant_node_id: (s.tenant_node_id as string | null) ?? null,
        effective_at: (s.effective_at as string | null) ?? null,
        raw_value: s.value,
        errors: (s.validation_errors as Array<Record<string, unknown>>) ?? [],
      })),
      conflicts_preview: conflicts.slice(0, 50).map((c) => ({
        row_no: c.row_no as number,
        fact_type: c.fact_type as string,
        tenant_node_id: (c.tenant_node_id as string) ?? "",
        effective_at: "",
        incoming_value: c.incoming_value,
        existing_canonical_id: (c.existing_canonical_id as string) ?? "",
        existing_value_hash:
          (c.existing_value as { hash?: string } | null)?.hash ?? "",
        existing_value:
          (c.existing_value as { value?: unknown } | null)?.value,
      })),
    }));
  };

  const retryRow = async (rowNo: number) => {
    if (!result?.staging_batch_id || !uploadedFileId || !selectedMappingId) {
      toast({ title: "Nothing to retry", variant: "destructive" });
      return;
    }
    setRetryingRow(rowNo);
    try {
      const { data, error } = await supabase.functions.invoke("ingest-csv-adapter", {
        body: {
          file_id: uploadedFileId,
          source_mapping_id: selectedMappingId,
          staging_batch_id: result.staging_batch_id,
          retry_row_nos: [rowNo],
          pii_fields: [],
          max_rows: 10000,
        },
      });
      if (error) throw error;
      const res = data as AdapterResponse;
      await refreshBatchState(result.staging_batch_id);
      toast({
        title: `Row ${rowNo} retried`,
        description: `${res.rows_auto_promoted} promoted · ${res.rows_quarantined} quarantined · ${res.conflicts_raised} conflicts`,
      });
    } catch (e) {
      toast({
        title: "Retry failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRetryingRow(null);
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

      {result && (result.conflicts_preview.length > 0 || result.conflicts_raised > 0) && (
        <ConflictsPreviewTable
          rows={result.conflicts_preview}
          totalCount={result.conflicts_raised}
          onDownload={(fmt) => downloadConflictsReport(result.staging_batch_id, fmt)}
        />
      )}

      {result && (result.quarantine_preview.length > 0 || result.rows_quarantined > 0) && (
        <QuarantinePreviewTable
          rows={result.quarantine_preview}
          totalCount={result.rows_quarantined}
          onDownload={(fmt) => downloadQuarantineReport(result.staging_batch_id, fmt)}
          onRetry={retryRow}
          retryingRow={retryingRow}
          canRetry={!!uploadedFileId && !!selectedMappingId}
        />
      )}
    </div>
  );
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const body = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ReportFormat = "csv" | "xlsx";

async function downloadXlsx(filename: string, header: string[], rows: string[][]) {
  const XLSX = await import("xlsx");
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "report");
  XLSX.writeFile(wb, filename);
}

async function writeReport(
  format: ReportFormat,
  baseName: string,
  header: string[],
  rows: string[][],
) {
  if (format === "xlsx") {
    await downloadXlsx(`${baseName}.xlsx`, header, rows);
  } else {
    downloadCsv(`${baseName}.csv`, header, rows);
  }
}

async function downloadQuarantineReport(batchId: string, format: ReportFormat = "csv") {
  const { data, error } = await supabase
    .from("staged_records" as any)
    .select("row_no, fact_type, tenant_node_id, effective_at, value, validation_errors, descriptors, source_mapping_id")
    .eq("staging_batch_id", batchId)
    .eq("validation_status", "quarantined")
    .order("row_no", { ascending: true })
    .limit(50000);
  if (error) {
    toast({ title: "Report failed", description: error.message, variant: "destructive" });
    return;
  }
  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((s) => {
    const errs = (s.validation_errors as Array<Record<string, unknown>>) ?? [];
    return [
      String(s.row_no ?? ""),
      String(s.fact_type ?? ""),
      (s.descriptors as { source_column?: string } | null)?.source_column ?? "",
      String(s.tenant_node_id ?? ""),
      String(s.effective_at ?? ""),
      formatRawCell(s.value),
      humanizeErrors(errs),
      JSON.stringify(s.value ?? null),
      JSON.stringify(errs),
    ];
  });
  await writeReport(
    format,
    `quarantine-${batchId.slice(0, 8)}`,
    ["row_no", "fact_type", "column", "tenant_node_id", "effective_at", "raw_value", "reason", "raw_value_json", "errors_json"],
    rows,
  );
}

async function downloadConflictsReport(batchId: string, format: ReportFormat = "csv") {
  const { data, error } = await supabase
    .from("fact_conflicts" as any)
    .select("row_no, fact_type, tenant_node_id, incoming_value, existing_value, existing_canonical_id, status, created_at")
    .eq("staging_batch_id", batchId)
    .order("row_no", { ascending: true })
    .limit(50000);
  if (error) {
    toast({ title: "Report failed", description: error.message, variant: "destructive" });
    return;
  }
  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((c) => {
    const existing = c.existing_value as { value?: unknown; hash?: string } | null;
    return [
      String(c.row_no ?? ""),
      String(c.fact_type ?? ""),
      String(c.tenant_node_id ?? ""),
      formatRawCell(c.incoming_value),
      formatRawCell(existing?.value),
      existing?.hash ?? "",
      String(c.existing_canonical_id ?? ""),
      String(c.status ?? ""),
      String(c.created_at ?? ""),
      JSON.stringify(c.incoming_value ?? null),
      JSON.stringify(existing?.value ?? null),
    ];
  });
  await writeReport(
    format,
    `conflicts-${batchId.slice(0, 8)}`,
    ["row_no", "fact_type", "tenant_node_id", "incoming_value", "existing_value", "existing_value_hash", "existing_canonical_id", "status", "created_at", "incoming_value_json", "existing_value_json"],
    rows,
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

type SortDir = "asc" | "desc";

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** Render an arbitrary JSON payload as a compact, readable cell string. */
function formatRawCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Unwrap the adapter's { value, unit? } envelope for readability.
  if (typeof v === "object" && v !== null && "value" in (v as Record<string, unknown>)) {
    const obj = v as { value?: unknown; unit?: unknown };
    const inner = formatRawCell(obj.value);
    return obj.unit ? `${inner} ${String(obj.unit)}` : inner;
  }
  return JSON.stringify(v);
}

/** Human-readable text for a single quarantine/validation error entry. */
function humanizeError(err: Record<string, unknown>): string {
  const kind = String(err.kind ?? "error");
  const reason = err.reason ? String(err.reason) : "";
  const column = err.column ? String(err.column) : "";
  switch (kind) {
    case "tenant_node_unresolved":
      return "Tenant node could not be resolved from the row.";
    case "effective_at_unresolved":
      return "Effective date column was missing or unparseable.";
    case "parse_failed":
      return `Value in column “${column}” failed to parse${reason ? ` (${reason})` : ""}.`;
    case "promote_failed":
      return `Promotion to canonical_facts failed${reason ? `: ${reason}` : ""}.`;
    default:
      return reason ? `${kind}: ${reason}` : kind;
  }
}

function humanizeErrors(errs: Array<Record<string, unknown>>): string {
  if (!errs || errs.length === 0) return "—";
  return errs.map(humanizeError).join(" · ");
}


function SortHeader<K extends string>({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: K;
  sortKey: K | null;
  sortDir: SortDir;
  onSort: (k: K) => void;
}) {
  const active = sortKey === col;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="p-2">
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

function DownloadFormatMenu({
  label,
  onDownload,
}: {
  label: string;
  onDownload: (format: ReportFormat) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-3 w-3 mr-1" /> {label}
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onDownload("csv")}>Download CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDownload("xlsx")}>Download XLSX</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ConflictSortKey = "row_no" | "fact_type" | "tenant_node_id" | "effective_at";

function ConflictsPreviewTable({
  rows,
  totalCount,
  onDownload,
}: {
  rows: ConflictPreview[];
  totalCount: number;
  onDownload: (format: ReportFormat) => void;
}) {
  const [query, setQuery] = useState("");
  const [factType, setFactType] = useState<string>("__all__");
  const [sortKey, setSortKey] = useState<ConflictSortKey | null>("row_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const factTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.fact_type))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (factType !== "__all__" && r.fact_type !== factType) return false;
      if (!q) return true;
      return (
        r.fact_type.toLowerCase().includes(q) ||
        String(r.row_no).includes(q) ||
        (r.tenant_node_id ?? "").toLowerCase().includes(q) ||
        JSON.stringify(r.incoming_value).toLowerCase().includes(q) ||
        r.existing_canonical_id.toLowerCase().includes(q)
      );
    });
    if (sortKey) {
      const k = sortKey;
      const dir = sortDir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => cmp(a[k], b[k]) * dir);
    }
    return out;
  }, [rows, query, factType, sortKey, sortDir]);

  const onSort = (k: ConflictSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const clearFilters = () => { setQuery(""); setFactType("__all__"); };
  const hasFilters = query !== "" || factType !== "__all__";

  return (
    <section className="border rounded-md overflow-hidden">
      <div className="p-3 bg-muted/50 font-medium text-sm flex flex-wrap items-center justify-between gap-2">
        <span>
          fact_conflicts preview ({filtered.length}
          {filtered.length !== rows.length ? ` filtered of ${rows.length}` : ""}
          {totalCount > rows.length ? ` · ${rows.length} of ${totalCount}` : ""})
        </span>
        <DownloadFormatMenu label="Conflicts" onDownload={onDownload} />

      </div>
      <div className="p-3 flex flex-wrap items-center gap-2 border-b bg-background">
        <Input
          placeholder="Search row / fact / tenant / value…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 max-w-xs text-xs"
        />
        <Select value={factType} onValueChange={setFactType}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="Fact type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All fact types</SelectItem>
            {factTypes.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <SortHeader<ConflictSortKey> label="row" col="row_no" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader<ConflictSortKey> label="fact_type" col="fact_type" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader<ConflictSortKey> label="tenant_node" col="tenant_node_id" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader<ConflictSortKey> label="effective_at" col="effective_at" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <th className="p-2">incoming</th>
              <th className="p-2">existing_value</th>
              <th className="p-2">existing_canonical</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const incoming = formatRawCell(c.incoming_value);
              const existing = c.existing_value !== undefined
                ? formatRawCell(c.existing_value)
                : (c.existing_value_hash ? `hash:${c.existing_value_hash.slice(0, 12)}…` : "—");
              return (
                <tr key={`${c.row_no}-${c.fact_type}`} className="border-t align-top">
                  <td className="p-2 font-mono">{c.row_no}</td>
                  <td className="p-2 font-mono">{c.fact_type}</td>
                  <td className="p-2 font-mono">{c.tenant_node_id ? c.tenant_node_id.slice(0, 8) : "—"}</td>
                  <td className="p-2 text-muted-foreground">{c.effective_at ? new Date(c.effective_at).toLocaleString() : "—"}</td>
                  <td className="p-2 font-mono max-w-xs truncate" title={JSON.stringify(c.incoming_value)}>{incoming}</td>
                  <td className="p-2 font-mono max-w-xs truncate" title={JSON.stringify(c.existing_value ?? { hash: c.existing_value_hash })}>{existing}</td>
                  <td className="p-2 font-mono" title={c.existing_canonical_id}>{c.existing_canonical_id.slice(0, 8)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td className="p-4 text-center text-muted-foreground" colSpan={7}>No rows match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type QuarantineSortKey = "row_no" | "fact_type" | "column" | "tenant_node_id";

function quarantineErrorKinds(q: QuarantinePreview): string[] {
  return q.errors.map((e) => String((e as { kind?: unknown }).kind ?? "error"));
}

function QuarantinePreviewTable({
  rows,
  totalCount,
  onDownload,
  onRetry,
  retryingRow,
  canRetry,
}: {
  rows: QuarantinePreview[];
  totalCount: number;
  onDownload: (format: ReportFormat) => void;
  onRetry?: (rowNo: number) => void;
  retryingRow?: number | null;
  canRetry?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [factType, setFactType] = useState<string>("__all__");
  const [errorKind, setErrorKind] = useState<string>("__all__");
  const [sortKey, setSortKey] = useState<QuarantineSortKey | null>("row_no");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const factTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.fact_type))).sort(),
    [rows],
  );
  const errorKinds = useMemo(
    () => Array.from(new Set(rows.flatMap(quarantineErrorKinds))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (factType !== "__all__" && r.fact_type !== factType) return false;
      if (errorKind !== "__all__" && !quarantineErrorKinds(r).includes(errorKind)) return false;
      if (!q) return true;
      return (
        r.fact_type.toLowerCase().includes(q) ||
        r.column.toLowerCase().includes(q) ||
        String(r.row_no).includes(q) ||
        (r.tenant_node_id ?? "").toLowerCase().includes(q) ||
        JSON.stringify(r.raw_value).toLowerCase().includes(q) ||
        JSON.stringify(r.errors).toLowerCase().includes(q)
      );
    });
    if (sortKey) {
      const k = sortKey;
      const dir = sortDir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => cmp(a[k], b[k]) * dir);
    }
    return out;
  }, [rows, query, factType, errorKind, sortKey, sortDir]);

  const onSort = (k: QuarantineSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const clearFilters = () => { setQuery(""); setFactType("__all__"); setErrorKind("__all__"); };
  const hasFilters = query !== "" || factType !== "__all__" || errorKind !== "__all__";

  return (
    <section className="border rounded-md overflow-hidden">
      <div className="p-3 bg-muted/50 font-medium text-sm flex flex-wrap items-center justify-between gap-2">
        <span>
          Quarantined rows ({filtered.length}
          {filtered.length !== rows.length ? ` filtered of ${rows.length}` : ""}
          {totalCount > rows.length ? ` · ${rows.length} of ${totalCount}` : ""})
        </span>
        <DownloadFormatMenu label="Quarantine" onDownload={onDownload} />

      </div>
      <div className="p-3 flex flex-wrap items-center gap-2 border-b bg-background">
        <Input
          placeholder="Search row / fact / column / value / error…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 max-w-xs text-xs"
        />
        <Select value={factType} onValueChange={setFactType}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="Fact type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All fact types</SelectItem>
            {factTypes.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={errorKind} onValueChange={setErrorKind}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="Error kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All error kinds</SelectItem>
            {errorKinds.map((k) => (
              <SelectItem key={k} value={k}>{k}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <SortHeader<QuarantineSortKey> label="row" col="row_no" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader<QuarantineSortKey> label="fact_type" col="fact_type" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader<QuarantineSortKey> label="column" col="column" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortHeader<QuarantineSortKey> label="tenant_node" col="tenant_node_id" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <th className="p-2">raw_value</th>
              <th className="p-2">reason</th>
              <th className="p-2">error kinds</th>
              {onRetry && <th className="p-2 text-right">action</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((q) => {
              const rawText = formatRawCell(q.raw_value);
              const reasonText = humanizeErrors(q.errors);
              const kinds = quarantineErrorKinds(q).join(", ");
              return (
                <tr key={`${q.row_no}-${q.fact_type}-${q.column}`} className="border-t align-top">
                  <td className="p-2 font-mono">{q.row_no}</td>
                  <td className="p-2 font-mono">{q.fact_type}</td>
                  <td className="p-2 font-mono">{q.column}</td>
                  <td className="p-2 font-mono">{q.tenant_node_id ? q.tenant_node_id.slice(0, 8) : "—"}</td>
                  <td className="p-2 font-mono max-w-xs truncate" title={JSON.stringify(q.raw_value)}>{rawText}</td>
                  <td className="p-2 max-w-sm text-amber-700 dark:text-amber-300" title={JSON.stringify(q.errors)}>
                    {reasonText}
                  </td>
                  <td className="p-2 font-mono text-xs text-muted-foreground">{kinds}</td>
                  {onRetry && (
                    <td className="p-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!canRetry || retryingRow !== null}
                        onClick={() => onRetry(q.row_no)}
                        title="Re-run this row against the current mapping"
                      >
                        {retryingRow === q.row_no ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Retry mapping"
                        )}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td className="p-4 text-center text-muted-foreground" colSpan={onRetry ? 8 : 7}>No rows match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
