## Goal

Borrow the most useful idea from Hermes (capability-as-skill with a verify-check) and use it to give AWIP a nightly self-walkthrough. Pass/fail flows into the existing sentinel → morning-review → lessons pipeline, so failures become learning, not just alerts.

Cross-session recall (Hermes' FTS5-over-past-sessions trick) is **deferred** — logged as a todo, revisited once we have a stream of walkthrough data to recall over.

---

## Part A — Capability self-tests (schema + manifest)

Extend `public.capabilities` with one nullable JSONB column:

```text
verify  jsonb  -- null = no self-test declared
```

Shape (validated in edge function, not via CHECK constraint):

```json
{
  "kind": "http" | "sql" | "edge",
  "target": "/awip-api/okrs" | "select count(*) from capabilities" | "sentinel-tick",
  "method": "GET",                  // http only
  "expect": {
    "status": 200,                  // http
    "json_has": ["nodes"],          // http: keys present in JSON
    "min_rows": 1,                  // sql
    "max_ms": 5000                  // any
  },
  "auth": "service" | "none",
  "owner_module": "okr"
}
```

Operator-only RW; readable by `app-walkthrough` via service token.

Seed `verify` for the ~10 highest-value capabilities to start (OKR read, capability list, manifest event emit, RAG search, morning-review fetch, sentinel-tick fetch, deep-audit fetch, frontend-errors POST round-trip, gemini-tts smoke, awip-api auth check). The rest stay null and surface as "no self-test" coverage gaps.

## Part B — Probe sweep + self-test runner

New edge function: `app-walkthrough` (service-token auth).

Pipeline per run:

1. **Static route probes** — hardcoded list of `awip-api` endpoints + a handful of public page routes (`/`, `/roadmap`, `/overnight`, `/morning-review`, `/audits`, `/companion`). HEAD/GET, assert 200 + content-type.
2. **Capability self-tests** — for each capability with `verify is not null`, dispatch by `kind`:
   - `http` → fetch with optional service token, check status + `json_has` + latency.
   - `sql` → `awip_rag_search`-style SECURITY DEFINER helper `run_capability_sql_check(_sql, _min_rows)` that whitelists pure SELECTs and caps runtime; returns rowcount.
   - `edge` → invoke target function with `{ probe: true }`, expect 2xx.
3. **Aggregate** into a new table `walkthrough_runs` (id, started_at, finished_at, total, passed, failed, skipped, summary jsonb) and `walkthrough_checks` (run_id, kind, target, status, latency_ms, error, capability_id nullable). Operator-only RLS, realtime on.
4. **Failure → sentinel** — any failed check inserts a `sentinel_findings` row (`kind='walkthrough_failure'`, severity from check metadata, dedupe key = `target`).
5. **Lessons feed** — high-severity walkthrough failures land in the existing weekly `lessons-synthesize` window automatically (it already reads `sentinel_findings`).

Night-window model policy applies (already covered by `pickModel()` — walkthrough has no LLM calls in v1, so this is moot but worth noting for v2 if we add the AI visual sweep).

## Part C — Cron + UI

- New cron job `scheduled-app-walkthrough` at **02:15 UTC** (inside the night window, after night-agent-open at 22:00 and before close at 06:00). Uses `AWIP_SERVICE_TOKEN`.
- Add a card to the existing `AutomationPanel` on `/roadmap` showing last run + pass-rate + drill-down link.
- New page `/walkthrough` with run history, per-check breakdown, and a "Run now" button (operator-only, calls the edge function directly).
- On `CapabilityDetail.tsx`, add a "Self-test" section: shows current `verify` config, last result, edit form (operator-only). Capabilities without a verify show a yellow "no self-test" badge on the capability list.

## Part D — Docs + memory

- New `docs/app-walkthrough.md` covering: what runs, when, how to declare a verify-check, how to read failures.
- New memory file `mem://features/app-walkthrough` with the 5-step pipeline + table names + cron line for future-me.
- Update README "Automation" section + index Memories list.

## Part E — Todo for later (logged, not built)

- **Hermes-style cross-session recall**: index `night_observations`, `walkthrough_checks` failures, `sentinel_findings`, `lessons`, `roadmap_review_findings`, `discussion_actions` into `awip-rag`. Wire into morning-review + night-agent so they cite prior occurrences. Build after walkthrough has 2+ weeks of data.
- **AI visual sweep** (the "weekly Gemini judges screenshots" option): re-evaluate once probe coverage is good and we know what's still slipping through.
- **Hermes-style skill self-improvement**: when a verify-check flaps, auto-open a discussion_action proposing a fix to the check itself or the capability.

---

## Technical details

- Tables: `walkthrough_runs`, `walkthrough_checks` (both operator-only RLS, realtime). Column added: `capabilities.verify jsonb`.
- New helper RPC: `run_capability_sql_check(_sql text, _min_rows int)` — SECURITY DEFINER, regex-rejects anything that isn't a single `SELECT`, runs with `set local statement_timeout = '5s'`.
- Edge fn: `supabase/functions/app-walkthrough/index.ts` + `supabase/functions/app-walkthrough/probes.ts` (static probe list).
- Cron: insert via `supabase--insert` (per project convention — service token + URL are user-specific, not migration material).
- Idempotency: `Idempotency-Key: walkthrough:<run_id>` on any awip-api writes triggered by checks (none in v1, but pattern reserved).
- Frontend: `src/pages/Walkthrough.tsx`, `src/components/WalkthroughCard.tsx`, edits to `CapabilityDetail.tsx`, `Capabilities.tsx`, `AutomationPanel.tsx`. Channel names follow `mem://preferences/realtime-channel-naming` (per-mount UUID).
- Verification (per `mem://preferences/verification-discipline`): after deploy, I'll curl `app-walkthrough` once with the service token and report the actual run summary — not "should work".

## Out of scope (v1)

- Playwright e2e (blocked on git remote anyway).
- AI screenshot judging.
- Auto-fix of failing capabilities.
- RAG recall extension.
