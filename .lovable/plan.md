## Revised plan for today (overnight diff applied)

### What changed since yesterday's draft

- ✅ **`overnight-phase-runner-15m` recovered** — ran 05:45 UTC, sentinel finding auto-resolved. Drop from the day.
- ⚠️ **`qa-validate` still flapping** — ran once at 22:00 UTC last night, then silent 495 min. Severity still **high**. Stays in Block 1.
- 🆕 **`lessons-synthesize` never run** — new low-severity sentinel finding (cadence 7d, hasn't fired since the last attempt yesterday at 05:00). Add to Block 1 as a quick triage.
- ⚠️ **`night-agent-close` did not run this morning** — `cron_last_seen` is still yesterday's timestamp. Not yet flagged by sentinel (cadence not in `SENTINEL_CADENCES`), but morning review shows it. Worth a 5-min look.
- The 2 in-progress jobs (TaskJanitor logging + 13-closed-tasks audit) are **unchanged** since May 8 — same priority.
- Open jobs count: still 15. AWIP-review intake (10 items from yesterday) is untouched.

### Block 1 — Day shift only (≈ 75 min): finish unbreaking the crons

1. **`qa-validate` — silent 495 min, ran 22:00 UTC then stopped.**
   - Pattern (one run, then nothing) suggests the cron schedule itself is wrong, not auth. Check `cron.job` row for `qa-validate` — may be set to daily instead of hourly.
   - If schedule is right, look at `automation_runs` for the 22:00 row — see whether it errored after insert.

2. **`night-agent-close` — last seen 2026-05-10 06:00, missed this morning.**
   - 5-minute check: `cron.job` schedule + last edge-function log. May be the same root cause as `qa-validate` (cron drift).

3. **`lessons-synthesize` — never run.**
   - Cadence is weekly (Mondays). Today **is** Monday. Either it'll fire later today (in which case the finding self-resolves) or the cron is missing. Confirm the schedule exists; do not panic-fix.

Exit criteria: `qa-validate` finding resolves on next sentinel tick OR a `discussion_action` is opened with the root cause. Night-agent-close runs tomorrow morning.

### Block 2 — Close the 2 stale in-progress jobs (≈ 2 h)

Unchanged from yesterday's plan, still the highest-leverage items:

- `dfba3284…` **Audit 13 closed tasks** — define checklist, attach to a roadmap task, close.
- `007b16bd…` **TaskJanitor: log closure reasons** — small edge-function change + `detail` jsonb field.

Both are `priority=high, risk=med, night_eligible=true` but have sat untouched for 3 days — day-shift them to closure rather than hoping the night agent picks them up.

### Block 3 — Two cheap audit closes (≈ 60 min)

- `26beccf8…` **Unverified live count of open security findings** — run security scan, paste count into resolution note, close.
- `7a61bdb5…` **Confirm `AWIP_SERVICE_TOKEN` in GitHub Actions** — no git remote yet, so reframe as "blocked: pending git remote", note in `mem://preferences/verification-discipline`, close.

### Block 4 — Trim the night queue (≈ 10 min)

Of the 9 night-eligible open jobs, two are not actually autonomous work and should be flipped off:

- `ed62d90f…` "Define process for operator to view workstation work streams" — design conversation.
- `8bdddd82…` "Define process for operator to monitor Lovable AI's current activity" — design conversation.

Leaves 7 small-but-real jobs for tonight's run.

### Explicitly NOT today

- `3b26bcbb…` urgent **SHA-pin GitHub Actions** — pure churn, no git remote. Defer to W6.
- `de472305…` **Scope accumulation beyond Phase 2** — needs a roadmap-level conversation, not a tomorrow task.
- Any `risk=high|critical` work — none in queue.

### End-of-day success check

- 0 open `high` sentinel findings (qa-validate resolved or owned).
- `night-agent-close` root cause known.
- 2 in-progress jobs → done.
- 2 audit jobs → resolved.
- Night queue ≤ 7 jobs, all genuinely autonomous.
- Tomorrow's morning review shows `stuck_jobs ≤ 2`.
