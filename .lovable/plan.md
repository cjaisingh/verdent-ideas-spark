## Goal

Make the "Untested" list on `/roadmap/gate-diagnostics` self-explanatory: for every pending judgement row, show **why** it has no automated answer and **what evidence** the operator should attach before flipping Pass/Fail.

Frontend-only — no schema changes. Uses fields already on `qa_checks` (`kind`, `probe`, `criterion`, `note`).

## Changes (single file: `src/pages/GateDiagnostics.tsx`)

### 1. Helper: classify why a row is pending

```ts
function pendingReason(q: QaCheck): { why: string; evidence: string } {
  if (q.kind === "judgement") return {
    why: "Human judgement check — no automated probe exists by design.",
    evidence: "Operator decision: paste the artefact link, screenshot, or 1-line rationale into the note, then click Pass or Fail.",
  };
  if (q.kind === "automated" && !q.probe) return {
    why: "Marked automated but no probe SQL/endpoint is registered.",
    evidence: "Either add a probe in qa_checks.probe, or treat as judgement: attach evidence and override.",
  };
  if (q.probe && !q.last_checked_at) return {
    why: "Probe defined but never run by qa-validate cron.",
    evidence: "Wait for next 30-min cron tick, or run qa-validate manually. Override only if the cron is known broken.",
  };
  return {
    why: "No status recorded yet.",
    evidence: "Provide a one-line rationale in the note before overriding.",
  };
}
```

### 2. QA section header explainer

Above the Failing/Untested lists, add a muted helper line that links to `/roadmap/qa-audit`:

> Pending rows have no automated verdict. Each row below shows why it's pending and what evidence to attach before you flip it.

### 3. Per-row "why pending" block

Replace the current one-line `qaUnknown` rendering with a 2-line block per row:

```
[judgement] criterion text
  why:      Human judgement check — no automated probe exists by design.
  evidence: Paste artefact link or 1-line rationale into the note, then Pass/Fail.
  [probe: <q.probe>]   ← only if probe exists
  [last note: <q.note>] ← only if note exists
  <JudgementButtons q={q} />
```

Styling: keep the existing `<li>` muted style; render `why` / `evidence` as small `text-[11px]` lines under the criterion. Cap the visible list at 10 (existing behaviour) with the "… N more" tail.

### 4. Same treatment for `qaFailed`

Failing rows get a smaller hint: `evidence: confirm the probe failure is real before flipping back to pass — paste your reasoning into the note`.

## Out of scope

- No DB columns added; `kind`/`probe` already drive the classification.
- No changes to `JudgementButtons`, the bulk-close action, the audit log, or the Ownership collapsible.
- No edits to cron / edge functions.

## Verification

- Open `/roadmap/gate-diagnostics`, expand phases 1, 3, 4 — every Untested row shows "why" + "evidence".
- Rows where `kind=judgement` show the human-judgement copy.
- Rows where `kind=automated` and `probe IS NULL` show the missing-probe copy.
- Existing Pass/Fail buttons still flip status and the audit log still records the change.
