## Goal

Make "is this safe to let the Night Agent touch?" an explicit, structured decision instead of an operator hunch. Today `priority` is the only signal and it conflates "do soon" with "would hurt if wrong" — which is exactly the wrong knob to gate autonomy on.

## Proposal: add `risk`, gate night eligibility on it

### 1. New field: `discussion_actions.risk`

- Enum: `low | med | high | critical` (mirrors priority for muscle memory).
- Default `med` on insert (safe-ish middle).
- Separate from `priority`. Priority = when, risk = blast radius if wrong.
- Backfill: every existing row → `med`. Operator can re-tier from the drawer.

Rubric (shipped as tooltip + `docs/jobs-board.md`):

- **critical** — touches auth, billing, RLS, prod data migrations, or anything irreversible. Day shift, two-pair-of-eyes.
- **high** — schema changes, edge-function contracts, cross-project surfaces, customer-visible UX. Day shift.
- **med** — internal pages, copy, non-destructive refactors, doc updates with code touches. Night-shift OK.
- **low** — pure docs, comments, lint fixes, dependency bumps inside semver-patch. Night-shift OK.

### 2. Night-eligibility gate

- DB-level guard via trigger on `discussion_actions`:
  - If `risk in ('high','critical')` then force `night_eligible = false` on insert/update.
  - Operator can still flip the moon toggle, but the trigger reverts it and surfaces a toast: *"Risk = high — day shift only. Lower risk first."*
- Hard override path: a new column `night_override_reason text`. If set (non-empty), the trigger respects `night_eligible = true` even at high/critical and writes a `discussion_action_events` row of type `night_override`. Critical risk **never** overrides — that one is a hard no.
- Night Agent query stays `night_eligible = true` — the gate is enforced at write-time, so no edge-function changes needed.

### 3. Auto-classification on intake

- The proposal extractor (`ProposalReviewSheet` / `awip-reviews-pull` / quarterly opener) already picks `priority`. Extend the same prompt to also pick `risk` with the rubric above. Default to `med` if unsure.
- AWIP Reviews findings tagged severity `high`/`critical` map straight to `risk = high`/`critical` (severity ↔ risk is a clean mapping; severity ↔ priority is not).

### 4. UI surface

- **Job drawer** (`JobDetailsDrawer`): second badge next to priority, same select pattern. Tooltip shows the rubric.
- **Discussion Actions pane**: small colored dot before the priority chip — gray (low) → blue (med) → amber (high) → red (critical). Moon button greys out + tooltip "blocked by risk" when high/critical and no override.
- **Jobs page** (`/jobs`): risk column + filter, plus a "Night queue" pill showing how many of today's open jobs are night-eligible.
- **Audit log**: `risk_changed` and `night_override` events join the existing event stream.

### 5. Morning Review tie-in

Aggregate "high/critical risk jobs still open" into the morning brief so day shift sees the queue they own. No new cron — just one extra section in `morning-review`.

### Out of scope

- Touching `sentinel_findings.severity` or `/risk-dashboard` — those are platform-health risk, different concept, keep separate.
- Renaming `priority` (would churn 30+ files for no behavioral win).
- Auto-promoting risk based on file paths or diff size — too clever, save for later.

## Technical detail

Schema (one migration):

```sql
alter type job_risk add value if not exists ...  -- new enum
-- or text + check, matching how priority is stored today
alter table public.discussion_actions
  add column risk text not null default 'med',
  add column night_override_reason text;

alter table public.discussion_actions
  add constraint discussion_actions_risk_chk
  check (risk in ('low','med','high','critical'));

-- Trigger: enforce gate
create or replace function public.enforce_night_eligibility_by_risk()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.risk = 'critical' then
    new.night_eligible := false;          -- never overridable
    new.night_override_reason := null;
  elsif new.risk = 'high' and coalesce(new.night_override_reason,'') = '' then
    new.night_eligible := false;
  end if;
  return new;
end $$;

create trigger trg_enforce_night_eligibility
before insert or update on public.discussion_actions
for each row execute function public.enforce_night_eligibility_by_risk();
```

Files touched:

- `supabase/migrations/<new>.sql` — column, check, trigger, backfill (all rows → `med`).
- `src/components/discussions/JobDetailsDrawer.tsx` — risk select + tooltip + override input (when high).
- `src/components/discussions/ProposalReviewSheet.tsx` — risk on each proposal row.
- `src/components/panes/bodies/DiscussionActionsBody.tsx` — risk dot + disabled moon state.
- `src/pages/Jobs.tsx` — column + filter + night-queue pill.
- `supabase/functions/awip-reviews-pull/index.ts` — map severity → risk.
- `supabase/functions/awip-api/...` (extractor prompt) — add risk to schema.
- `docs/jobs-board.md` (new) — the rubric.
- `mem/features/night-agent.md` — note the new gate.
- `CHANGELOG.md`.

## Open questions

1. **Hard cap on critical** — agree critical is *never* night-shift, even with override?
2. **Default for new rows** — `med` (my recommendation) or `low`?
3. **Backfill** — bulk-set everything to `med`, or run a one-off AI pass over open jobs to guess risk from title/details? (I'd skip the AI pass — it'll mislabel and you'll spend more time correcting than just re-tiering as you encounter them.)
