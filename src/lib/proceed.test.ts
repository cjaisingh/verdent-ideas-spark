import { describe, it, expect } from "vitest";
import { decideProceed } from "./proceed";

const okGate = {
  all_ok: true, structural_ok: true, qa_ok: true, night_ok: true, approvals_ok: true,
  open_tasks: 0, qa_total: 3, night_high_open: 0, pending_signoffs: 0,
};

describe("decideProceed", () => {
  it("returns request-signoff when all gates pass", () => {
    expect(decideProceed({ gate: okGate, nextTaskStatus: null }).action).toBe("request-signoff");
  });

  it("blocks signoff when one already pending", () => {
    const r = decideProceed({ gate: { ...okGate, pending_signoffs: 1 }, nextTaskStatus: null });
    expect(r.action).toBe("noop");
    expect(r.disabledReason).toMatch(/already/i);
  });

  it("close-sprint when sprint ready", () => {
    expect(decideProceed({ gate: { ...okGate, all_ok: false, structural_ok: false, open_tasks: 1 }, activeSprintReadyToClose: true }).action).toBe("close-sprint");
  });

  it("decide-approval when task in progress with pending approval", () => {
    expect(decideProceed({ nextTaskStatus: "in_progress", nextTaskHasPendingApproval: true }).action).toBe("decide-approval");
  });

  it("open-log when task in progress, no approval", () => {
    expect(decideProceed({ nextTaskStatus: "in_progress" }).action).toBe("open-log");
  });

  it("start-task when next is todo", () => {
    expect(decideProceed({ nextTaskStatus: "todo" }).action).toBe("start-task");
  });

  it("blocked", () => {
    expect(decideProceed({ nextTaskStatus: "blocked" }).action).toBe("noop");
  });

  it("noActivePhase", () => {
    expect(decideProceed({ noActivePhase: true }).action).toBe("noop");
  });

  it("phase not ready lists blockers", () => {
    const r = decideProceed({
      gate: { ...okGate, all_ok: false, structural_ok: false, qa_ok: false, qa_total: 0, open_tasks: 3 },
      nextTaskStatus: null,
    });
    expect(r.action).toBe("noop");
    expect(r.disabledReason).toMatch(/3 open/);
    expect(r.disabledReason).toMatch(/no QA/i);
  });
});
