# Jobs board risk model

Every job on `/jobs` has two independent dimensions:

| Field | Meaning | Used for |
|---|---|---|
| `priority` | **When** to do it | Sort order on the board, day-shift triage |
| `risk` | **Blast radius if wrong** | Gating Night Agent autonomy |

## Risk rubric

| Tier | Examples | Night-shift? |
|---|---|---|
| **critical** | Auth, billing, RLS, prod data migrations, anything irreversible | **Never.** Hard-blocked at the DB. |
| **high** | Schema changes, edge-function contracts, cross-project surfaces, customer-visible UX | Only with a written override reason. |
| **med** | Internal pages, copy, non-destructive refactors, doc + small code touches | Yes. |
| **low** | Pure docs, comments, lint, semver-patch dep bumps | Yes. |

## Enforcement

A `BEFORE INSERT/UPDATE` trigger (`enforce_night_eligibility_by_risk`) on `discussion_actions`:

- `risk='critical'` → forces `night_eligible=false` and wipes `night_override_reason`.
- `risk='high'` → forces `night_eligible=false` unless `night_override_reason` is non-empty.
- `low`/`med` → no gate; override reason is auto-cleared (it's meaningless).

Risk changes and night overrides are written to `discussion_action_events` (`risk_changed`, `night_override`) and visible in the job drawer's Activity log.

## Editing

- **Job drawer** (`/jobs`, click a card): Risk select + override-reason textarea (high only) + moon toggle.
- **Discussion Actions pane** (right pane on most routes): risk dot + moon toggle. Moon greys out when blocked.

## Defaults

- New rows default to `risk='med'`.
- Existing rows backfilled to `med`.
- Future: AWIP-Reviews and the proposal extractor can suggest risk; operator confirms in the proposal review sheet.
