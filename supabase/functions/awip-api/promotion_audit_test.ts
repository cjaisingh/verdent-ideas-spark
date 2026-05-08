import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildReport,
  type ObservationRow,
  type ProposalRow,
  type ShiftRow,
} from "./promotion_audit.ts";

const shift: ShiftRow = {
  id: "shift-1",
  started_at: "2026-05-08T22:00:00Z",
  ended_at: null,
  status: "running",
  window_start: "2026-05-08T22:00:00Z",
  window_end: "2026-05-09T06:00:00Z",
  summary: {
    tz: "UTC",
    window: "22:00-06:00",
    allowed_kinds: ["roadmap"],
    gates: {
      timezone: "UTC",
      window: "22:00-06:00",
      enabled: true,
      in_window: true,
      blackout_hit: false,
      allowed_kinds: ["roadmap"],
      blackout_dates: [],
    },
    skip_reasons: [],
    candidates_total: 3,
    candidates_selected: [
      { short_num: 11, title: "promote me", risk: "low", phase: "roadmap", suite: "roadmap" },
    ],
    candidates_skipped: [
      { short_num: 12, title: "risky", reason: "risk=high (auth)" },
    ],
  },
};

const accepted: ProposalRow = {
  id: "p-1",
  shift_id: "shift-1",
  status: "accepted",
  kind: "promote_job",
  rationale: "Audit: 5 steps · worst=low · qa pass",
  target_ref: { discussion_action_id: "task-1", short_num: 11 },
  payload: { worst_severity: "low", qa_passed: true },
  created_at: "2026-05-08T22:01:00Z",
  decided_at: "2026-05-09T07:30:00Z",
  decided_by: "ops@example.com",
};

const observations: ObservationRow[] = [
  {
    id: "o-1",
    shift_id: "shift-1",
    kind: "job_review",
    severity: "info",
    summary: "pulled #11: promote me",
    subject_ref: { discussion_action_id: "task-1", short_num: 11 },
    payload: {},
    created_at: "2026-05-08T22:01:00Z",
  },
  {
    id: "o-2",
    shift_id: "shift-1",
    kind: "job_review",
    severity: "low",
    summary: "audit_complete: worst=low qa_passed=true",
    subject_ref: { discussion_action_id: "task-1", short_num: 11 },
    payload: { steps: 5, worst_severity: "low", qa_passed: true },
    created_at: "2026-05-08T22:02:00Z",
  },
  {
    id: "o-3",
    shift_id: "shift-1",
    kind: "job_review",
    severity: "info",
    summary: "unrelated job",
    subject_ref: { discussion_action_id: "task-other" },
    payload: {},
    created_at: "2026-05-08T22:03:00Z",
  },
];

Deno.test("accepted proposal yields after.decision=accepted with audit_complete", () => {
  const r = buildReport(accepted, shift, observations);
  assertEquals(r.after.decision, "accepted");
  assertEquals(r.after.audit_complete?.worst_severity, "low");
  assertEquals(r.after.audit_complete?.qa_passed, true);
  assertEquals(r.after.audit_complete?.steps, 5);
  // Observations filtered to this task only (excludes task-other).
  assertEquals(r.after.observations.length, 2);
});

Deno.test("before block surfaces selected and skipped candidates verbatim", () => {
  const r = buildReport(accepted, shift, observations);
  assertEquals(r.before.legacy, false);
  assertEquals(r.before.candidates_total, 3);
  assertEquals(r.before.candidates_selected[0].short_num, 11);
  assertEquals(r.before.candidates_skipped[0].reason, "risk=high (auth)");
  assertEquals(r.before.gates?.enabled, true);
});

Deno.test("legacy shift without gates summary returns legacy=true and null gates", () => {
  const legacyShift: ShiftRow = { ...shift, summary: { tz: "UTC" } };
  const r = buildReport(accepted, legacyShift, observations);
  assertEquals(r.before.legacy, true);
  assertEquals(r.before.gates, null);
  assertEquals(r.before.candidates_selected.length, 0);
  assertEquals(r.before.candidates_skipped.length, 0);
});

Deno.test("missing audit_complete observation returns null instead of throwing", () => {
  const noComplete = observations.filter((o) => !o.summary.startsWith("audit_complete"));
  const r = buildReport(accepted, shift, noComplete);
  assertEquals(r.after.audit_complete, null);
  assert(r.after.observations.length >= 1);
});

Deno.test("rejected and pending proposals carry the correct decision", () => {
  const rejected: ProposalRow = { ...accepted, status: "rejected" };
  const pending: ProposalRow = { ...accepted, status: "pending", decided_at: null, decided_by: null };
  assertEquals(buildReport(rejected, shift, observations).after.decision, "rejected");
  assertEquals(buildReport(pending, shift, observations).after.decision, "pending");
});
