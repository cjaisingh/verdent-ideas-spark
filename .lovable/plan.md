# External audit triage

Source: `cjaisingh/verdent-ideas-spark` — 19 open issues, all bug/audit findings.

## Tier 1 — Critical (fix first, all small surgical patches)

| # | Title | Fix |
|---|---|---|
| #9 | Cross-tenant capability event leak in `GET /events/recent` | Add `.eq("tenant_id", tenantId)` to the `cq` (capability_events) query in `awip-api/index.ts` ~L1085. |
| #10 | IDOR on approval routes — any module can decide another tenant's approvals | Add owner/tenant check in `getApproval` + `decideApproval` (~L1433–1528). |
| #11 | **W9.0 broken** — HMAC prefix mismatch, every ingest callback returns 401 | Strip `sha256=` prefix before HMAC compare in `ingest-callback/index.ts` ~L85. Verify against actual implementation — our callback uses `x-approval-signature` (bare hex), so this needs cross-check before patch. |
| #12 | **W9.0 broken** — `ingested-files` bucket never created, every upload fails | New migration: `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (...) ON CONFLICT DO NOTHING`. |

## Tier 2 — High (security + correctness)

| # | Title | Fix area |
|---|---|---|
| #13 | `ingestOkrTree` non-atomic — duplicate trees on retry | Wrap in transaction or single RPC; honour `Idempotency-Key`. |
| #14 | `supersedeOkr` ignores update result — old + new both active | Check rowcount; rollback on 0. |
| #15 | `claim_scheduled_jobs` never sets `status='running'` — double-execution | Add `UPDATE … SET status='running' WHERE id = ANY(...)` inside the SECURITY DEFINER function. |
| #16 | PostgREST filter injection via unsanitised `?search=` | Reject/escape `,()` in `search` param; use parameterised RPCs. |
| #17 | Module token can inject capability events for any module | Check `owning_module` from token matches body's `owning_module` in `/capabilities/register`. |
| #18 | `x-copilot-agent` header accepted from any caller — agent scope bypass | Verify header against the calling principal's allowed agents. |
| #19 | Timing attack on service token — `===` comparison | Replace with constant-time compare (`crypto.timingSafeEqual` via Web Crypto). |

## Tier 3 — Medium/Low (defer to a second batch)

#20 resolver view typo · #21 cross-tenant idempotency collision in `raw_records` · #22 `source_mappings` unique constraint missing `tenant_id` · #23 W9.0 dedup index doesn't cover null `engagement_id` (real — partial index `WHERE engagement_id IS NOT NULL` confirmed) · #24 duplicate realtime channels · #25 stale-closure in EventStream · #26 empty `kind` in AdminScheduler · #27 idempotency body-hash missing for promote/ack-warnings.

## Execution shape

1. **Verify-first pass** (read-only, no patches): cross-check each Tier-1/2 finding against current code before patching — some may be stale post W7/W8/W9.0 work. Issues #11 and #12 specifically need verification against the W9.0 code we just shipped.
2. **Tier 1 patches** (1 migration + ~4 small code edits in `awip-api/index.ts` and `ingest-callback/index.ts`).
3. **Tier 2 patches** (mix of edits and 1 SQL function patch for `claim_scheduled_jobs`).
4. **Per fix**: close the GitHub issue with a comment linking to the commit; update CHANGELOG under a new "Security/audit fixes" entry.
5. **Defer Tier 3** to a follow-up `discussion_action` so the critical/high work isn't blocked.

## Out of scope

- Tier 3 fixes (separate batch).
- Re-running the external audit (we only act on the findings already filed).
- Any new feature work.

## Confirm before I start

- OK to do Tier 1 + Tier 2 in one session (~11 issues)?
- Or Tier 1 only first, then review before Tier 2?
- Close issues automatically via the GitHub API as each fix lands, or leave them open for you to close?
