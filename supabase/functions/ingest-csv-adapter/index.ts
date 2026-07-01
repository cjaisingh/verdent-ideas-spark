// W9.1 — ingest-csv-adapter
// First structured adapter implementing SOURCE_ADAPTER_CONTRACT. Pulls a
// CSV or XLSX out of the `ingested-files` bucket, applies the approved
// source_mappings.mapping JSON, and writes:
//   - one raw_records row (the file envelope)
//   - one staged_records row per (row × fact_type)
//   - canonical_facts inserts for rows that satisfy the precondition trio
//   - fact_conflicts inserts for value mismatches against live canonicals
//   - ingest_events for every row outcome
//
// Auth: operator JWT or AWIP_SERVICE_TOKEN. No anon access.
// Idempotency: (file_id, source_mapping_id) — second call returns
// deduped=true with the original batch counts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { withLogger } from "../_shared/logger.ts";
import {
  IngestCsvAdapterBody,
  CsvMappingSchema,
  parseCellValue,
  type CsvMapping,
  type IngestCsvAdapterConflictPreview,
  type IngestCsvAdapterQuarantinePreview,
  type IngestCsvAdapterResponse,
} from "../_shared/contracts/ingest-csv-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ---------- tiny CSV parser (RFC4180-ish, no streaming) ----------

function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(cur); cur = ""; continue; }
    if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    if (c === "\r") continue;
    cur += c;
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

// ---------- value hash ----------

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Postgres bytea literal `\\x...`
function hexToBytea(hex: string): string {
  return `\\x${hex}`;
}

// ---------- main ----------

Deno.serve(withLogger("ingest-csv-adapter", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const isService = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;

  let actorId: string | null = null;
  if (!isService) {
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
    actorId = u.user.id;
    const { data: isOp } = await userClient.rpc("has_role", { _user_id: actorId, _role: "operator" });
    const { data: isAd } = await userClient.rpc("has_role", { _user_id: actorId, _role: "admin" });
    if (!isOp && !isAd) return json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = IngestCsvAdapterBody.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const p = parsed.data;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // -------- load file + mapping --------

  const { data: file, error: fileErr } = await sb
    .from("ingested_files")
    .select("id, engagement_id, storage_path, filename, mime, size_bytes, sha256")
    .eq("id", p.file_id)
    .maybeSingle();
  if (fileErr || !file) return json({ error: "file_not_found" }, 404);

  const { data: mappingRow, error: mapErr } = await sb
    .from("source_mappings")
    .select("id, tenant_id, adapter_id, version, status, mapping")
    .eq("id", p.source_mapping_id)
    .maybeSingle();
  if (mapErr || !mappingRow) return json({ error: "mapping_not_found" }, 404);

  const precheckFailures: IngestCsvAdapterResponse["precheck_failures"] = [];
  if (mappingRow.status !== "approved") {
    precheckFailures.push({ reason: "mapping_not_approved" });
  }
  const piiMissing = p.pii_fields.find((f) => !f.basis);
  if (piiMissing) {
    precheckFailures.push({ reason: "pii_without_basis", column: piiMissing.column });
  }

  const mappingParsed = CsvMappingSchema.safeParse(mappingRow.mapping);
  if (!mappingParsed.success) {
    return json({ error: "invalid_mapping", detail: mappingParsed.error.flatten() }, 422);
  }
  const mapping: CsvMapping = mappingParsed.data;

  // -------- idempotency: (adapter_id, idempotency_key) on raw_records --------

  const idempotencyKey = `csv-adapter:${p.file_id}:${p.source_mapping_id}`;

  const retrySet = new Set(p.retry_row_nos ?? []);
  const isRetry = retrySet.size > 0;

  const { data: existingRaw } = await sb
    .from("raw_records")
    .select("id")
    .eq("adapter_id", mappingRow.adapter_id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingRaw && !isRetry) {
    // Replay counts from staged_records / canonical_facts.
    const [{ data: staged }, { data: promoted }, { data: conflicts }] = await Promise.all([
      sb.from("staged_records").select("staging_batch_id, validation_status, promoted_canonical_id, row_no, fact_type, tenant_node_id, effective_at, value, validation_errors, descriptors").eq("raw_record_id", existingRaw.id),
      sb.from("canonical_facts").select("id").eq("raw_record_id", existingRaw.id),
      sb.from("fact_conflicts").select("id, row_no, fact_type, tenant_node_id, incoming_value, existing_value, existing_canonical_id, staging_batch_id").eq("source_mapping_id", mappingRow.id),
    ]);
    const batchId = staged?.[0]?.staging_batch_id ?? crypto.randomUUID();
    const rowsStaged = staged?.length ?? 0;
    const rowsAutoPromoted = promoted?.length ?? 0;
    const rowsQuarantined = staged?.filter((s) => s.validation_status === "quarantined").length ?? 0;
    const quarantinePreview: IngestCsvAdapterQuarantinePreview[] = (staged ?? [])
      .filter((s) => s.validation_status === "quarantined")
      .slice(0, 50)
      .map((s) => ({
        row_no: s.row_no as number,
        fact_type: s.fact_type as string,
        column: (s.descriptors as { source_column?: string } | null)?.source_column ?? "",
        tenant_node_id: (s.tenant_node_id as string | null) ?? null,
        effective_at: (s.effective_at as string | null) ?? null,
        raw_value: s.value,
        errors: (s.validation_errors as Array<Record<string, unknown>>) ?? [],
      }));
    const conflictsPreview: IngestCsvAdapterConflictPreview[] = (conflicts ?? [])
      .filter((c) => c.staging_batch_id === batchId)
      .slice(0, 50)
      .map((c) => ({
        row_no: c.row_no as number,
        fact_type: c.fact_type as string,
        tenant_node_id: c.tenant_node_id as string,
        effective_at: "",
        incoming_value: c.incoming_value,
        existing_canonical_id: c.existing_canonical_id as string,
        existing_value_hash:
          (c.existing_value as { hash?: string } | null)?.hash ?? "",
        existing_value:
          (c.existing_value as { value?: unknown } | null)?.value,
      }));
    return json<IngestCsvAdapterResponse>({
      staging_batch_id: batchId,
      raw_record_id: existingRaw.id,
      rows_seen: rowsStaged,
      rows_staged: rowsStaged,
      rows_auto_promoted: rowsAutoPromoted,
      rows_quarantined: rowsQuarantined,
      conflicts_raised: conflicts?.length ?? 0,
      auto_promote_eligible: precheckFailures.length === 0,
      precheck_failures: precheckFailures,
      quarantine_preview: quarantinePreview,
      conflicts_preview: conflictsPreview,
      deduped: true,
      dry_run: false,
    });
  }

  if (isRetry && !existingRaw) {
    return json({ error: "batch_not_found_for_retry" }, 404);
  }

  // Retry mode: clear prior staged_records + fact_conflicts for the targeted
  // composite row_nos so the re-run writes fresh rows into the same batch.
  if (isRetry && p.staging_batch_id) {
    const rowNoList = [...retrySet];
    await sb.from("staged_records")
      .delete()
      .eq("staging_batch_id", p.staging_batch_id)
      .in("row_no", rowNoList);
    await sb.from("fact_conflicts")
      .delete()
      .eq("staging_batch_id", p.staging_batch_id)
      .in("row_no", rowNoList);
  }


  // -------- download bytes from storage --------

  const { data: blob, error: dlErr } = await sb.storage.from("ingested-files").download(file.storage_path);
  if (dlErr || !blob) return json({ error: "download_failed", detail: dlErr?.message }, 502);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // -------- parse rows into array-of-records --------

  let header: string[] = [];
  let dataRows: unknown[][] = [];
  try {
    if (mapping.kind === "csv") {
      const text = new TextDecoder().decode(bytes);
      const all = parseCsv(text, mapping.delimiter ?? ",");
      const hIdx = mapping.header_row - 1;
      if (all.length <= hIdx) throw new Error("missing_header_row");
      header = all[hIdx].map((s) => s.trim());
      dataRows = all.slice(hIdx + 1);
    } else {
      const wb = XLSX.read(bytes, { type: "array" });
      const sheetName = mapping.sheet ?? wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      if (!sheet) throw new Error(`sheet_not_found:${sheetName}`);
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
      const hIdx = mapping.header_row - 1;
      if (aoa.length <= hIdx) throw new Error("missing_header_row");
      header = (aoa[hIdx] as unknown[]).map((s) => String(s ?? "").trim());
      dataRows = aoa.slice(hIdx + 1) as unknown[][];
    }
  } catch (e) {
    return json({ error: "parse_failed", detail: String(e) }, 422);
  }

  if (dataRows.length > p.max_rows) {
    return json({ error: "max_rows_exceeded", rows_seen: dataRows.length, max_rows: p.max_rows }, 413);
  }

  const colIndex = (name: string): number => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const must = (name: string): number => {
    const i = colIndex(name);
    if (i < 0) throw new Error(`missing_column:${name}`);
    return i;
  };

  // Verify all required columns up front.
  try {
    if (mapping.tenant_node.by === "column" && mapping.tenant_node.column) must(mapping.tenant_node.column);
    if (mapping.effective_at.by === "column" && mapping.effective_at.column) must(mapping.effective_at.column);
    for (const f of mapping.facts) must(f.column);
  } catch (e) {
    return json({ error: "mapping_column_missing", detail: String(e) }, 422);
  }

  // -------- dry run short-circuit --------

  if (p.dry_run) {
    return json<IngestCsvAdapterResponse>({
      staging_batch_id: crypto.randomUUID(),
      raw_record_id: "00000000-0000-0000-0000-000000000000",
      rows_seen: dataRows.length,
      rows_staged: 0,
      rows_auto_promoted: 0,
      rows_quarantined: 0,
      conflicts_raised: 0,
      auto_promote_eligible: precheckFailures.length === 0,
      precheck_failures: precheckFailures,
      quarantine_preview: [],
      conflicts_preview: [],
      deduped: false,
      dry_run: true,
    });
  }

  // -------- insert raw_records (or reuse existing in retry mode) --------

  const stagingBatchId = isRetry && p.staging_batch_id
    ? p.staging_batch_id
    : crypto.randomUUID();
  let rawRecordId: string;
  if (isRetry && existingRaw) {
    rawRecordId = existingRaw.id;
  } else {
    const { data: rawIns, error: rawErr } = await sb
      .from("raw_records")
      .insert({
        tenant_id: mappingRow.tenant_id,
        adapter_id: mappingRow.adapter_id,
        source_kind: "file",
        source_id: file.id,
        received_at: new Date().toISOString(),
        payload: {
          file_id: file.id,
          filename: file.filename,
          sha256: file.sha256,
          rows: dataRows.length,
          mapping_version: mappingRow.version,
        },
        payload_hash: hexToBytea(file.sha256),
        bytes: file.size_bytes,
        idempotency_key: idempotencyKey,
        pii_declared: p.pii_fields,
      })
      .select("id")
      .single();
    if (rawErr || !rawIns) return json({ error: "raw_insert_failed", detail: rawErr?.message }, 500);
    rawRecordId = rawIns.id;
  }


  // -------- stage + promote / conflict / quarantine row-by-row --------

  let rowsStaged = 0;
  let rowsAutoPromoted = 0;
  let rowsQuarantined = 0;
  let conflictsRaised = 0;
  const quarantinePreview: IngestCsvAdapterQuarantinePreview[] = [];
  const conflictsPreview: IngestCsvAdapterConflictPreview[] = [];
  const blockAutoPromote = precheckFailures.length > 0;


  for (let r = 0; r < dataRows.length; r++) {
    const rowNo = r + 1;
    const row = dataRows[r];

    // Resolve tenant_node_id.
    let tenantNodeId: string | null = null;
    if (mapping.tenant_node.by === "fixed") {
      tenantNodeId = p.default_tenant_node_id ?? mapping.tenant_node.value ?? null;
    } else if (mapping.tenant_node.column) {
      const v = row[colIndex(mapping.tenant_node.column)];
      tenantNodeId = typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v.trim()) ? v.trim() : null;
    }

    // Resolve effective_at.
    let effectiveAt: string | null = null;
    if (mapping.effective_at.by === "fixed") {
      effectiveAt = mapping.effective_at.value ?? null;
    } else if (mapping.effective_at.by === "received_at") {
      effectiveAt = new Date().toISOString();
    } else if (mapping.effective_at.column) {
      const v = row[colIndex(mapping.effective_at.column)];
      const parsed = parseCellValue(v, "iso_date");
      effectiveAt = parsed.ok ? (parsed.value as string) : null;
    }

    for (const f of mapping.facts) {
      const compositeRowNo = rowNo * 1000 + mapping.facts.indexOf(f);
      if (isRetry && !retrySet.has(compositeRowNo)) continue;
      const cellRaw = row[colIndex(f.column)];
      const parsedCell = parseCellValue(cellRaw, f.parser);


      const errors: Array<Record<string, unknown>> = [];
      if (!tenantNodeId) errors.push({ kind: "tenant_node_unresolved" });
      if (!effectiveAt) errors.push({ kind: "effective_at_unresolved" });
      if (!parsedCell.ok) {
        if (f.required) errors.push({ kind: "parse_failed", column: f.column, reason: parsedCell.reason });
        else continue; // optional + empty/invalid → skip the fact for this row
      }

      const valuePayload = parsedCell.ok
        ? (f.unit ? { value: parsedCell.value, unit: f.unit } : { value: parsedCell.value })
        : { value: null, parser_error: !parsedCell.ok ? parsedCell.reason : null };
      const valueHashHex = await sha256Hex(JSON.stringify(valuePayload));

      const status = errors.length > 0 ? "quarantined" : "passed";

      const { error: stErr } = await sb.from("staged_records").insert({
        raw_record_id: rawRecordId,
        staging_batch_id: stagingBatchId,
        row_no: rowNo * 1000 + mapping.facts.indexOf(f), // composite key uniqueness
        source_mapping_id: mappingRow.id,
        tenant_id: mappingRow.tenant_id,
        tenant_node_id: tenantNodeId,
        descriptors: { source_column: f.column, parser: f.parser },
        fact_type: f.fact_type,
        value: valuePayload,
        value_hash: hexToBytea(valueHashHex),
        effective_at: effectiveAt ?? new Date(0).toISOString(),
        validation_status: status,
        validation_errors: errors,
      });
      if (stErr) {
        return json({ error: "stage_insert_failed", detail: stErr.message, row_no: rowNo }, 500);
      }
      rowsStaged++;

      if (status === "quarantined") {
        rowsQuarantined++;
        if (quarantinePreview.length < 50) {
          quarantinePreview.push({
            row_no: rowNo * 1000 + mapping.facts.indexOf(f),
            fact_type: f.fact_type,
            column: f.column,
            tenant_node_id: tenantNodeId,
            effective_at: effectiveAt,
            raw_value: cellRaw ?? null,
            errors,
          });
        }
        await sb.from("ingest_events").insert({
          event_type: "row_quarantined",
          tenant_id: mappingRow.tenant_id,
          subject_type: "staged_records",
          subject_id: rawRecordId,
          actor_id: actorId,
          auto: true,
          payload: { row_no: rowNo, fact_type: f.fact_type, errors },
        });
        continue;
      }

      // Precondition trio gate.
      if (blockAutoPromote) {
        precheckFailures.push({ reason: "validation_failed", column: f.column, row_no: rowNo });
        continue;
      }

      // Check for live canonical conflict.
      const { data: live } = await sb
        .from("canonical_facts")
        .select("id, value_hash")
        .eq("tenant_node_id", tenantNodeId!)
        .eq("fact_type", f.fact_type)
        .eq("effective_at", effectiveAt!)
        .is("superseded_by", null)
        .maybeSingle();

      if (live) {
        const liveHashHex = typeof live.value_hash === "string"
          ? (live.value_hash as string).replace(/^\\x/, "")
          : "";
        if (liveHashHex.toLowerCase() === valueHashHex.toLowerCase()) {
          // Same value — link staged row to existing canonical, no conflict.
          await sb.from("staged_records").update({ promoted_canonical_id: live.id })
            .eq("staging_batch_id", stagingBatchId).eq("row_no", rowNo * 1000 + mapping.facts.indexOf(f));
          continue;
        }
        const pairHashHex = await sha256Hex(JSON.stringify([live.value_hash, valuePayload]));
        const { error: cfErr } = await sb.from("fact_conflicts").insert({
          tenant_id: mappingRow.tenant_id,
          tenant_node_id: tenantNodeId,
          fact_type: f.fact_type,
          incoming_value: valuePayload,
          existing_value: { hash: liveHashHex },
          value_pair_hash: hexToBytea(pairHashHex),
          source_mapping_id: mappingRow.id,
          staging_batch_id: stagingBatchId,
          row_no: rowNo * 1000 + mapping.facts.indexOf(f),
          existing_canonical_id: live.id,
        });
        if (!cfErr) {
          conflictsRaised++;
          if (conflictsPreview.length < 50) {
            conflictsPreview.push({
              row_no: rowNo * 1000 + mapping.facts.indexOf(f),
              fact_type: f.fact_type,
              tenant_node_id: tenantNodeId!,
              effective_at: effectiveAt!,
              incoming_value: valuePayload,
              existing_canonical_id: live.id,
              existing_value_hash: liveHashHex,
            });
          }
          await sb.from("ingest_events").insert({
            event_type: "conflict_raised",
            tenant_id: mappingRow.tenant_id,
            subject_type: "fact_conflicts",
            subject_id: live.id,
            actor_id: actorId,
            auto: true,
            payload: { row_no: rowNo, fact_type: f.fact_type },
          });
        }
        continue;
      }

      // Promote to canonical_facts.
      const { data: canon, error: cErr } = await sb
        .from("canonical_facts")
        .insert({
          tenant_id: mappingRow.tenant_id,
          tenant_node_id: tenantNodeId,
          fact_type: f.fact_type,
          value: valuePayload,
          value_hash: hexToBytea(valueHashHex),
          effective_at: effectiveAt,
          raw_record_id: rawRecordId,
          source_mapping_id: mappingRow.id,
          staging_batch_id: stagingBatchId,
          staged_row_no: rowNo * 1000 + mapping.facts.indexOf(f),
          auto_promoted: true,
        })
        .select("id")
        .single();
      if (cErr || !canon) {
        // Treat as quarantine on promotion failure.
        rowsQuarantined++;
        if (quarantinePreview.length < 50) {
          quarantinePreview.push({
            row_no: rowNo * 1000 + mapping.facts.indexOf(f),
            fact_type: f.fact_type,
            column: f.column,
            tenant_node_id: tenantNodeId,
            effective_at: effectiveAt,
            raw_value: valuePayload,
            errors: [{ kind: "promote_failed", reason: cErr?.message ?? "unknown" }],
          });
        }
        await sb.from("ingest_events").insert({
          event_type: "row_quarantined",
          tenant_id: mappingRow.tenant_id,
          subject_type: "staged_records",
          subject_id: rawRecordId,
          actor_id: actorId,
          auto: true,
          payload: { row_no: rowNo, fact_type: f.fact_type, promote_error: cErr?.message ?? "unknown" },
        });
        continue;
      }
      rowsAutoPromoted++;
      await sb.from("staged_records").update({ promoted_canonical_id: canon.id })
        .eq("staging_batch_id", stagingBatchId).eq("row_no", rowNo * 1000 + mapping.facts.indexOf(f));
      await sb.from("ingest_events").insert({
        event_type: "row_promoted",
        tenant_id: mappingRow.tenant_id,
        subject_type: "canonical_facts",
        subject_id: canon.id,
        actor_id: actorId,
        auto: true,
        payload: { row_no: rowNo, fact_type: f.fact_type },
      });
    }
  }

  return json<IngestCsvAdapterResponse>({
    staging_batch_id: stagingBatchId,
    raw_record_id: rawRecordId,
    rows_seen: isRetry ? retrySet.size : dataRows.length,
    rows_staged: rowsStaged,
    rows_auto_promoted: rowsAutoPromoted,
    rows_quarantined: rowsQuarantined,
    conflicts_raised: conflictsRaised,
    auto_promote_eligible: !blockAutoPromote,
    precheck_failures: precheckFailures.slice(0, 50),
    quarantine_preview: quarantinePreview,
    conflicts_preview: conflictsPreview,
    deduped: false,
    dry_run: false,
    ...(isRetry ? { retried_row_nos: [...retrySet] } : {}),
  });
}));
