# Runbook: Observability Freshness

Operator-facing runbook for the cron / edge-fn / table freshness detector and the session-lifecycle that keeps it honest. Pair with [`docs/session-lifecycle.md`](../session-lifecycle.md) and the [observability registry alerts](../../mem/features/observability-registry-alerts.md) memory.

---

## 1. Session lifecycle (recap)

Every working session against AWIP Core opens and closes through two idempotent edge functions:

| Phase | Action | Endpoint | Source tag |
|---|---|---|---|
| Start | Read `mem/index.md`, scan open `sentinel_findings` (24h) and `discussion_actions` | — | — |
| During | Post the plan's **Out of scope** footer | `plan-footer-ingest` | `plan_footer` |
| End | Post session summary (incl. mid-flight `out_of_scope[]`) | `session-summary-log` | `session_summary` |

Both writers fan out to `discussion_actions` via `recordOutOfScope()` with a stable `source_ref` (`plan:<id>` / `session:<id>`) so re-POSTing is safe. The `out_of_scope_stale` sentinel (medium) escalates anything left `open` >14 d.

Verify a session closed cleanly:

```sql
select source, count(*)
from discussion_actions
where created_at > now() - interval '1 day'
  and source in ('plan_footer','session_summary')
group by 1;
```

---

## 2. Detector data sources

The freshness detector is the view `public.v_observability_registry_status`, surfaced on `/admin/observability-registry`, `/admin/freshness-dashboard`, and by the `observability_stale_surface` / `observability_missing_watcher` sentinel checks.

Per surface kind, "last seen" is computed from:

| `surface_kind` | Source(s) | Notes |
|---|---|---|
| `cron` | `cron.job_run_details` (via `public.observability_cron_last_seen()` SECURITY DEFINER) **UNION** `automation_runs.job` | The union closes the long-standing gap where `automation_runs.job` carries the **function** name while `cron.job_run_details.jobname` carries the **schedule** name. Both are tried; whichever is fresher wins. |
| `edge_fn` | `edge_request_logs.function_name`, last 14 d | Function silence ⇒ `stale` even if `last_seen_at` is null. |
| `table` | Hard-listed only (currently `resolver_decisions`) | Unknown table surfaces resolve to `status='unknown'` rather than `stale` so adding a registry row never instantly fires a false positive. |

### Threshold

`stale` fires when `now() - last_seen_at > expected_cadence_minutes × stale_multiplier` per row.

- `stale_multiplier` is a column on `observability_registry`. Default `3`.
- Long-cadence rows are seeded tighter: `scheduled-deep-audit-monthly` and `scheduled-quarterly-review-open` use `1.25` (≈ 37 d / 135 d) so they alert before drifting weeks.
- To adjust a surface, `update observability_registry set stale_multiplier = <n> where surface_id = '<id>';` — no code change required.

### Status codes

| `status` | Meaning | Sentinel kind | Severity |
|---|---|---|---|
| `ok` | Within threshold | — | — |
| `stale` | Past threshold OR null last_seen for cron/edge_fn/`resolver_decisions` | `observability_stale_surface` | medium |
| `missing-watcher` | `watcher_kinds` is empty | `observability_missing_watcher` | high → Telegram |
| `unknown` | Table surfaces not on the hard-list | — | — |

---

## 3. Interpreting the legitimate stale signals

After the 2026-05-22 C1 detector fix auto-resolved 11 false positives, three rows remained genuinely `stale`. Each is legitimate and has its own meaning.

### 3.1 `scheduled-deep-audit-monthly` (cron)

- Cadence 43 200 min (30 d); multiplier 1.25 ⇒ alerts at ≈ 37 d.
- Fires when the monthly platform audit hasn't logged a run since the previous calendar month.
- Action: check `cron.job_run_details` for the job, confirm `AWIP_SERVICE_TOKEN` is valid, run `deep-audit-runner` manually if the next scheduled tick is more than 24 h away. Do **not** loosen the multiplier — that hides a real failure.

### 3.2 `scheduled-quarterly-review-open` (cron)

- Cadence 43 200 min; multiplier 1.25 ⇒ alerts at ≈ 135 d.
- Expected to be `ok` between Jan/Apr/Jul/Oct 1 firings; `stale` outside that window means a quarter boundary was missed.
- Action: trigger `quarterly-review-open` manually; it's idempotent (one `discussion_action` per quarter), so a duplicate kick is safe.

### 3.3 ~~`session-bootstrap`~~ — removed 2026-05-22

The registry row was dropped: no caller existed in the codebase, and the session lifecycle is already enforced via `plan-footer-ingest` and `session-summary-log` (both observable). If a real `session-bootstrap` endpoint ever gets built, re-insert with `withLogger` and a real cadence; until then, treat its absence as correct.

---

## 4. Where to look

| What | Where |
|---|---|
| Live status snapshot | `/admin/observability-registry` |
| 14-day cron heatmap + bootstrap timeline | `/admin/freshness-dashboard` |
| Sentinel findings | `/admin/sentinel` filtered by `kind in ('observability_stale_surface','observability_missing_watcher')` |
| Threshold config | `select surface_id, expected_cadence_minutes, stale_multiplier from observability_registry order by surface_kind, surface_id;` |
| Raw cron history | `cron.job_run_details` (last 60 d via the helper) and `automation_runs` (last 180 d in the view) |

---

## 5. Change log

- 2026-05-22 — C1 detector fix: cron sources now union `cron.job_run_details` + `automation_runs.job`; table surfaces hard-listed; `stale_multiplier` column added (default 3, monthly/quarterly seeded at 1.25).
