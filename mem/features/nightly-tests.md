---
name: Nightly tests workflow
description: nightly.yml runs unit + (gated) e2e at 02:00 UTC, reports to record-test-run; report failures never kill the job, e2e step gated on E2E_OPERATOR_EMAIL/PASSWORD secrets
type: feature
---

`.github/workflows/nightly.yml` runs every day at 02:00 UTC + on `workflow_dispatch`.

**Steps**:
1. Install + run unit suite (`vitest run`).
2. `Check e2e secrets` gate — sets `configured=true` only when both `E2E_OPERATOR_EMAIL` and `E2E_OPERATOR_PASSWORD` repo secrets exist.
3. `Run e2e tests` runs only when gate is true; env vars piped from secrets.
4. `Report to backend` POSTs each suite's JSON summary to `record-test-run` with `x-service-token: $AWIP_SERVICE_TOKEN`. Non-200 emits `::warning::` (401 → "rotate the secret" hint) but never fails the job.
5. JSON results uploaded as `nightly-test-results-<run_id>` artefact (7d).
6. `Fail job if any suite failed` is the only step that can red the job — based on `unit.outcome` / `e2e.outcome`.

**Operator secrets** (repo Settings → Secrets):
- `AWIP_SERVICE_TOKEN` — must match Lovable Cloud's `AWIP_SERVICE_TOKEN`. 401s land in `automation_runs` (job=`record-test-run`, status_code=401) with hint message.
- `E2E_OPERATOR_EMAIL` + `E2E_OPERATOR_PASSWORD` — optional; absent → e2e skipped cleanly.

**Why the report step is non-fatal**: A stale GitHub secret would otherwise hide real test outcomes behind a generic curl 22. Sentinel + `automation_runs` already alert on `record-test-run` 401s.
