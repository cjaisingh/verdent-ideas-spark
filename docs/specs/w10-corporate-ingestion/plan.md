# W10 — Corporate Knowledge Ingestion: Execution Plan

**Version:** 1.0 — 4 July 2026 — Status: Proposed. House plan.md style; the Stage 1+2 section is paste-ready as the live plan on start; later stages get their own plan.md on entry.

## Programme goal
Turn the W9 parsing pipeline into a governed corporate knowledge system: records lifecycle + approval trust boundary + document memory + Obsidian-style graph + CAD extraction + FM round-trip — six gated stages closing via four-gate sign-off as roadmap_phases w10-s1…s6.

## Programme non-goals
No geometry computation. No OAuth pulls until S2's gate (W9.4 parked). No cross-engagement corpus. No public API. No speculative FM connectors (one native, tenant-chosen; COBie covers the rest). No document authoring.

## Ways of working (restated once)
Contract-first; Idempotency-Key + body-hash everywhere; withLogger; events on every mutation (new streams doc_memory_events, graph_events, fm_push_events; extended ingested_file_events); sentinels + registry rows in the same PR as the surface; pickModel() + ai_usage_log, night window honoured; migrations only; approved mappings immutable; CHANGELOG + mem:// per landing; UK English.

## Setup (1–2 days, during R1)
Decide sidecar host (ADR-0011 §hosting, with a monthly cost estimate entered into the credit ledger — companion §7) since IFC/DWG containers co-locate with markitdown. Create the six roadmap_phases rows + Stage 1+2 tasks so /roadmap is live from day one.

## Stage 1+2 detailed plan (paste-ready)
**Goal:** every ingested file gets a records identity (class, revision chain, retention, legal hold) and a lifecycle with an approval trust boundary; backfill the corpus.
**Non-goals:** no memory/graph/CAD/FM (later stages); no LLM classification by default; no four-eyes enforcement while one operator; no deletions during the sweeper's two-week dry-run.
**Schema (2 migrations):** M1 records layer — retention_policies (seeded standard/contract/media/working); ingested_files + records_class/retention_policy/revision_of/revision_label/legal_hold/bytes_tier; legal_hold_audit + set_legal_hold SECURITY DEFINER; indexes (engagement, class), partial on hold, (revision_of). M2 lifecycle + trust — lifecycle enum + approved_by/at/approval_id; document_approval_policies seeded per spec; retrieval_contracts + min_approval_state default approved; new event kinds; match RPCs → _v2 with min_lifecycle (old as deprecating wrappers one release); partial unique on pending approval per file. GRANT + RLS operator/admin everywhere.
**Edge fns:** ingest-file — deterministic classifier, optional revision_of, revision_candidate response, storage quota (413 + 80% sentinel). ingest-callback — policy evaluation → auto_approved or approval row + pending_review. New records-retention-sweep (daily 03:10 UTC; dry-run flag app_secrets RECORDS_SWEEP_DRY_RUN default true; skips holds; never deletes rows; events). Lifecycle transitions via the approvals decide path + thin POST /ingest/files/:id/lifecycle for quarantine/supersede (operator JWT, Idempotency-Key). ingest-search resolves contract → min_lifecycle. Canonical gate: adapter auto-promote fourth condition + red-path e2e. Backfill script scripts/backfill-doc-lifecycle.ts (auto-rules; idempotent; batches of 500 with progress events; review-queue summary).
**UI:** ingest-health storage-tier card + lifecycle chips; file drawer class selector, revision banner, legal-hold toggle (admin), shared LifecycleBadge; /approvals inherits the new kind. No new routes.
**Observability:** sentinels retention_sweep_silent, legal_hold_delete_attempt (critical), document_review_backlog (med ≥25 >72h, high ≥100), unapproved_retrieval_attempt (high); CI scripts/check-retrieval-approval.ts wired into lint-and-typecheck.
**Docs + memory:** docs/features/ingestion.md § Records & lifecycle; docs/runbooks/records-retention.md; mem/features/doc-lifecycle.md (trust boundary default approved; sweeper never deletes rows; hold beats retention); mem/index.md one-liners; CHANGELOG per landing.
**Verification:** Deno unit (class map, policy evaluator, sweeper decision fn); e2e (lifecycle matrix; red-path canonical from unapproved must 4xx; min_lifecycle per contract incl. operator any; hold delete structurally blocked; two-tenant reads unchanged); manual (upload→pending→approve→retrievable; rev-2 supersede → rev-1 vanishes from agent retrieval; dry-run report sane). **Readiness gates:** S1 sign-off requires the first recorded restore drill (incl. held-file round-trip); S2 sign-off requires the executed DPA (or tenant-zero exception), the operator-absence runbook, and queue median ≤72h post-backfill.
**Technical notes:** token cost ≈ zero for S1+S2; the _v2 RPC swap is the riskiest change — wrapper week, watch deprecated_rpc_called, then drop; rollback SQL per migration in the runbook.

## Later-stage skeletons
**S3 (entry: S2 gate green):** schema+events → extractor (anchor quote-hash verification first, model second) → tray → RRF memory leg + hit_kind → revision supersession → fact bridge → KPI view. Risk: hallucinated anchors — hash-verified quotes + anchor-failure sentinel; extraction only proposes. Cost: per-file caps, night window, job broken out on ai-usage before first prod run.
**S4 (entry: S3 tray in use; parallel from schema onward):** schema+RPCs (+ADR-0010 bench stub) → structural edges (triggers, zero AI, instant value) → wikilink parser → mention scanner → suggested-edge UX → graph views → flagged retrieval leg. Risk: suggestion noise — per-pattern bulk ops, suggestion cap per document, kill patterns under 20% confirm-rate.
**S5 (entry: sidecar host live + R4 harness):** routing + honest-tier notices → IFC happy path on fixture → resolver keystone (GUID) with auto-bind dashboard → part_of edges + digests → DWG path → APS optional → fuzz + limits → viewer flagged last. Risks: malformed-file attack surface (unprivileged, per-file limits, fuzz in audit); resolver flooding (cap candidate creation per model run; conflict-band overflow pauses the run and pages).
**S6 (entry: S5 keystone proven; 6a/6b can start alongside S5 tail):** ontology contract + mapping governance → COBie import → COBie export (deterministic) → reconciliation loop (fm_external_id, source facet, export_pending) → one native connector, tenant-chosen. Risk: cross-tenant push — per-tenant creds via get_app_secret, tenant-from-token only, two-tenant FM e2e green before real credentials; first export against the tool's sandbox.

## Programme verification & close
Each stage: four-gate sign-off. Programme exit = S6 gate + PRD §9 criteria on the pilot + closing review entry + docs/w10-closeout.md (mirroring W7) restating the deferred list (W9.4 OAuth, Haystack/Brick, rerank) so nothing silently evaporates.

## First actions (this week, if approved)
1. Truth-up: create w10-s1…s6 phases + Stage 1+2 tasks. 2. Decide sidecar hosting (ADR-0011 §hosting) with a monthly cost line into the credit ledger. 3. Land M1 + deterministic classifier — smallest reviewable slice. 4. Start the sweeper in dry-run for two weeks of report history. 5. **Pilot tenant:** shortlist 3 candidates (or declare tenant-zero) as a discussion action with owner + date. 6. **Legal:** brief a solicitor on the DPA using the S1 retention seeds as the retention schedule — longest lead item, start now.
