/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * Regenerate with: bun run rls:generate
 * Verify in CI:    bun run rls:verify
 *
 * Source: pg_policies (tables) + pg_proc (SECURITY DEFINER fns) in the live
 * database. The e2e RLS matrix tests import from this file so adding a new
 * table or changing a policy automatically updates the test surface.
 *
 * Generated at: 2026-05-07T08:14:14.620Z
 */

export type Role = "anon" | "operator" | "admin";

export interface TablePosture {
  table: string;
  /** Roles whose SELECT policy USING clause permits read */
  read: Role[];
  /** Roles whose INSERT policy WITH CHECK permits insert */
  insert: Role[];
  /** ALL policy with USING=false / CHECK=false — direct client writes blocked */
  clientWriteBlocked: boolean;
  /** SELECT gated by auth.uid() = user_id (per-row owner read like user_roles) */
  selfRowOnly: boolean;
}

export const TABLE_POSTURE: TablePosture[] = [
  {
    "table": "activity_policies",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "alert_log",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "alert_settings",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "api_call_logs",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "approval_queue",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "automation_runs",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "capabilities",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "capability_connectors",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "capability_events",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "idempotency_keys",
    "read": [],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "memory_audit_log",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "memory_settings",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "notebook_entries",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "okr_measurements",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "okr_node_events",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "okr_nodes",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "operator_messages",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "qa_checks",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "retention_settings",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "rethink_tasks",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_autolog_settings",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_autolog_skips",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_comments",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_phases",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_review_findings",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_sprints",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_task_activity",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_tasks",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "roadmap_work_log",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "role_change_audit",
    "read": [
      "admin"
    ],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "telegram_gateway_logs",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "tenants",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [
      "admin",
      "operator"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": false
  },
  {
    "table": "test_runs",
    "read": [
      "admin",
      "operator"
    ],
    "insert": [],
    "clientWriteBlocked": true,
    "selfRowOnly": false
  },
  {
    "table": "user_roles",
    "read": [
      "admin"
    ],
    "insert": [
      "admin"
    ],
    "clientWriteBlocked": false,
    "selfRowOnly": true
  }
];

export const ALL_TABLES: string[] = TABLE_POSTURE.map((p) => p.table);

/** Tables readable by the operator role (and therefore admin too). */
export const OPERATOR_READ_TABLES: string[] = TABLE_POSTURE
  .filter((p) => p.read.includes("operator"))
  .map((p) => p.table);

/** Tables readable ONLY by admin (operator must be denied). */
export const ADMIN_ONLY_READ_TABLES: string[] = TABLE_POSTURE
  .filter((p) => p.read.includes("admin") && !p.read.includes("operator") && !p.selfRowOnly)
  .map((p) => p.table);

/** Tables where SELECT is gated to the row owner (auth.uid()=user_id). */
export const SELF_ROW_ONLY_TABLES: string[] = TABLE_POSTURE
  .filter((p) => p.selfRowOnly)
  .map((p) => p.table);

/** Tables where direct client INSERT is blocked even for operator (writes via edge fn / triggers). */
export const CLIENT_WRITE_BLOCKED: string[] = TABLE_POSTURE
  .filter((p) => p.clientWriteBlocked || p.insert.length === 0)
  .map((p) => p.table);

/** SECURITY DEFINER RPCs gated by has_role(_, 'operator'). */
export const OPERATOR_RPCS: string[] = [
  "purge_all_rows",
  "purge_expired_rows",
  "retention_stats"
];

/** SECURITY DEFINER RPCs gated by has_role(_, 'admin'). */
export const ADMIN_RPCS: string[] = [
  "grant_user_role",
  "list_users_with_roles",
  "revoke_user_role"
];

/** Other SECURITY DEFINER fns (triggers, has_role itself, bootstrap, etc.). */
export const OTHER_SECDEF_FNS: string[] = [
  "auto_purge_if_enabled",
  "bootstrap_first_operator",
  "has_role",
  "log_autolog_settings_change",
  "log_retention_settings_change",
  "log_roadmap_task_activity"
];
