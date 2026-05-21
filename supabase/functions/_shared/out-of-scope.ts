// Shared writer that turns "Out of scope" bullets (from a plan footer or a
// session summary) into idempotent public.discussion_actions rows.
//
// Idempotency is enforced by the partial unique index
//   uniq_discussion_actions_autolog (source, source_ref, title)
// shipped in migration 20260521_out_of_scope_autolog.
//
// We deliberately keep the API tiny — callers pass the bullet strings, the
// origin tag and a stable ref. Everything else (status, risk, source) is
// fixed by this module so the observability contract holds across callers.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type OutOfScopeSource = "plan_footer" | "session_summary";

export type RecordOutOfScopeArgs = {
  items: string[];
  source: OutOfScopeSource;
  /** Stable reference, e.g. `plan:<uuid>` or `session:<uuid>`. */
  source_ref: string;
  /** Used for both the discussion_actions.priority and risk fields. */
  default_priority?: "low" | "med" | "high";
  /** Optional UUID stored as subject_id; defaults to a deterministic hash of source_ref. */
  subject_id?: string;
};

export type RecordOutOfScopeResult = {
  parsed_count: number;
  created: Array<{ id: string; title: string }>;
  skipped: string[];
};

const MAX_TITLE_LEN = 240;

function normaliseTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LEN);
}

// Deterministic UUIDv5-ish from a string so duplicate posts collapse onto
// the same subject_id. Uses SHA-1 → first 16 bytes → RFC4122 v5 layout.
async function refToUuid(ref: string): Promise<string> {
  const data = new TextEncoder().encode(ref);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  const b = hash.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC4122 variant
  const hex = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function recordOutOfScope(
  sb: SupabaseClient,
  args: RecordOutOfScopeArgs,
): Promise<RecordOutOfScopeResult> {
  const items = (args.items ?? [])
    .map(normaliseTitle)
    .filter((t) => t.length > 0);

  const unique = Array.from(new Set(items));
  const subjectId = args.subject_id ?? await refToUuid(args.source_ref);
  const priority = args.default_priority ?? "med";

  const created: Array<{ id: string; title: string }> = [];
  const skipped: string[] = [];

  for (const title of unique) {
    const { data, error } = await sb
      .from("discussion_actions")
      .insert({
        subject_type: args.source,        // 'plan_footer' | 'session_summary'
        subject_id: subjectId,
        title,
        details:
          `Auto-logged from ${args.source} (${args.source_ref}). ` +
          `Review and either action, demote, or close with reason.`,
        status: "open",
        priority,
        risk: priority,
        source: args.source,
        source_ref: args.source_ref,
        night_eligible: false,
      })
      .select("id, title")
      .single();

    if (error) {
      // Unique-violation = already logged from this source_ref — that's the happy
      // path for re-posts. Anything else bubbles up.
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        skipped.push(title);
        continue;
      }
      throw error;
    }
    created.push({ id: data.id, title: data.title });
  }

  return { parsed_count: unique.length, created, skipped };
}

// ---------- Markdown parser ----------

const HEADING_RE = /^\s{0,3}(#{1,4})\s+(.+?)\s*$/;
const OUT_OF_SCOPE_RE =
  /^(out\s*of\s*scope|not\s*in\s*scope|deferred|won['’]?t\s*do|won['’]?t\s*ship)(\b.*)?$/i;
const BULLET_RE = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(.+?)\s*$/;

/**
 * Pull bullet items out of any heading whose text matches the
 * out-of-scope pattern. Heading match wins until the next heading
 * of equal-or-higher level. Returns the raw bullet strings.
 */
export function parseOutOfScope(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let capturing = false;
  let captureLevel = 0;

  for (const line of lines) {
    const h = HEADING_RE.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      if (OUT_OF_SCOPE_RE.test(text)) {
        capturing = true;
        captureLevel = level;
        continue;
      }
      if (capturing && level <= captureLevel) {
        capturing = false;
      }
      continue;
    }
    if (!capturing) continue;
    const b = BULLET_RE.exec(line);
    if (b) out.push(b[1].trim());
  }
  return out;
}
