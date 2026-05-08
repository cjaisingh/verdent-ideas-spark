// Pure decision function for the "Proceed" button on /roadmap.
// No React, no Supabase — just inputs in, label/action/disabled out.

export type ProceedActionId =
  | "start-task"
  | "decide-approval"
  | "open-log"
  | "close-sprint"
  | "request-signoff"
  | "noop";

export interface ProceedDecision {
  label: string;
  action: ProceedActionId;
  /** When set, the button should render disabled with this tooltip. */
  disabledReason?: string;
  /** Human-readable explanation shown in the "?" popover. */
  why: string;
}

export interface ProceedInput {
  /** The active phase's gate row, if any. */
  gate?: {
    all_ok: boolean;
    structural_ok: boolean;
    qa_ok: boolean;
    night_ok: boolean;
    approvals_ok: boolean;
    open_tasks: number;
    qa_total: number;
    night_high_open: number;
    pending_signoffs: number;
  } | null;
  /** Status of the next-up task (todo / in_progress / blocked / review / done / wont_do). */
  nextTaskStatus?: string | null;
  /** True if the next-up task currently has a pending approval_queue row. */
  nextTaskHasPendingApproval?: boolean;
  /** True when every task in the active sprint is done|wont_do AND sprint is still active. */
  activeSprintReadyToClose?: boolean;
  /** True if there is no active phase at all. */
  noActivePhase?: boolean;
}

export function decideProceed(input: ProceedInput): ProceedDecision {
  const {
    gate,
    nextTaskStatus,
    nextTaskHasPendingApproval,
    activeSprintReadyToClose,
    noActivePhase,
  } = input;

  if (noActivePhase) {
    return {
      label: "No active phase",
      action: "noop",
      disabledReason: "Mark a phase active to enable Proceed.",
      why: "Proceed needs an active phase to know what to do next.",
    };
  }

  if (gate?.all_ok) {
    if ((gate.pending_signoffs ?? 0) > 0) {
      return {
        label: "Sign-off pending",
        action: "noop",
        disabledReason: "A phase sign-off approval is already in the queue.",
        why: "Decide the existing sign-off in the Approvals queue.",
      };
    }
    return {
      label: "Request phase sign-off",
      action: "request-signoff",
      why: "All gates pass: tasks complete, QA green, no high-severity night audits, no pending approvals.",
    };
  }

  if (activeSprintReadyToClose) {
    return {
      label: "Close sprint",
      action: "close-sprint",
      why: "Every task in this sprint is done or won't do — close the sprint to advance.",
    };
  }

  if (nextTaskStatus === "in_progress" && nextTaskHasPendingApproval) {
    return {
      label: "Decide approval",
      action: "decide-approval",
      why: "This task has a pending approval — operator decision required.",
    };
  }

  if (nextTaskStatus === "in_progress") {
    return {
      label: "Open work log",
      action: "open-log",
      why: "Task is in progress — log progress or close it out.",
    };
  }

  if (nextTaskStatus === "todo") {
    return {
      label: "Start task",
      action: "start-task",
      why: "Mark this task in progress and begin tracking the AI turn.",
    };
  }

  if (nextTaskStatus === "blocked") {
    return {
      label: "Task blocked",
      action: "noop",
      disabledReason: "Resolve the blocker first.",
      why: "The next-up task is blocked — unblock it before proceeding.",
    };
  }

  if (gate && !gate.all_ok) {
    const blockers: string[] = [];
    if (!gate.structural_ok) blockers.push(`${gate.open_tasks} open task(s)`);
    if (!gate.qa_ok) blockers.push(gate.qa_total === 0 ? "no QA checks defined" : "QA checks failing");
    if (!gate.night_ok) blockers.push(`${gate.night_high_open} high-severity night audit(s)`);
    if (!gate.approvals_ok) blockers.push(`${gate.pending_signoffs} pending sign-off(s)`);
    return {
      label: "Phase not ready",
      action: "noop",
      disabledReason: `Blockers: ${blockers.join(", ")}`,
      why: "Active phase still has open work — finish tasks or fix gates before sign-off.",
    };
  }

  return {
    label: "Nothing to do",
    action: "noop",
    disabledReason: "No next-up task in the active phase.",
    why: "Add a task or activate a sprint to populate Next up.",
  };
}
