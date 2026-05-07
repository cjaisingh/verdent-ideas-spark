/**
 * Realistic INSERT payloads per table.
 *
 * These satisfy NOT NULL / type / FK-shape constraints so when a client tries
 * to insert, the rejection reason is provably RLS (Postgres SQLSTATE 42501,
 * "new row violates row-level security policy") rather than a NOT NULL or
 * type-cast error that would mask whether the policy ran at all.
 *
 * If a new table is added, generate a fixture here too — `assertRlsDenied`
 * below will tell you when a fixture is wrong (it'll surface the real error).
 */

const FAKE_UUID = "00000000-0000-0000-0000-000000000001";
const FAKE_UUID_2 = "00000000-0000-0000-0000-000000000002";
const NOW = new Date().toISOString();

export const INSERT_FIXTURES: Record<string, Record<string, unknown>> = {
  activity_policies: { activity: "test:fixture", default_action: "approve" },
  alert_log: { reason: "fixture", job: "fixture-job", payload: {} },
  alert_settings: { id: true, webhook_url: "https://example.invalid/hook" },
  api_call_logs: {
    method: "GET",
    route: "/fixture",
    status_code: 200,
    request_summary: {},
    response_summary: {},
  },
  approval_queue: {
    activity: "test:fixture",
    intent_payload: {},
    risk: "low",
    status: "pending",
  },
  automation_runs: { job: "fixture-job", status: "ok", trigger: "manual", detail: {} },
  capabilities: { id: "fixture.cap", name: "Fixture Capability", version: "0.0.1" },
  capability_connectors: { capability_id: "fixture.cap", connector_name: "fixture" },
  capability_events: {
    capability_id: "fixture.cap",
    event_type: "manifest.updated",
    payload: {},
  },
  idempotency_keys: {
    key: "fixture-key",
    scope: "fixture",
    response: { ok: true },
  },
  memory_audit_log: {
    scope: "fixture",
    entry_key: "fixture",
    action: "added",
  },
  memory_settings: { id: true, auto_purge_enabled: false },
  notebook_entries: { title: "fixture", kind: "thought", status: "open", tags: [] },
  okr_measurements: { okr_node_id: FAKE_UUID, metric_name: "fixture_metric" },
  okr_node_events: {
    tenant_id: FAKE_UUID,
    okr_node_id: FAKE_UUID,
    event_type: "fixture.event",
    payload: {},
  },
  okr_nodes: {
    tenant_id: FAKE_UUID,
    title: "fixture node",
    kind: "objective",
    status: "draft",
    created_by: "human",
  },
  operator_messages: {
    chat_id: 1,
    direction: "in",
    raw: {},
  },
  qa_checks: {
    phase_key: "fixture",
    criterion: "fixture criterion",
    status: "unknown",
    kind: "judgement",
  },
  retention_settings: {
    table_name: "fixture_table",
    retention_days: 7,
    description: "fixture",
  },
  rethink_tasks: { topic: "fixture", status: "open", original_proposal: {} },
  roadmap_autolog_settings: { id: true },
  roadmap_autolog_skips: {
    source: "awip-api",
    reason: "fixture",
    request_meta: {},
  },
  roadmap_comments: {
    task_id: FAKE_UUID,
    author: "fixture",
    body: "fixture comment",
    kind: "comment",
  },
  roadmap_phases: { key: "fixture", title: "Fixture Phase", status: "planned" },
  roadmap_review_findings: {
    title: "fixture finding",
    reviewer_model: "fixture-model",
    severity: "info",
  },
  roadmap_sprints: {
    phase_id: FAKE_UUID,
    key: "fixture-sprint",
    title: "Fixture Sprint",
    status: "planned",
  },
  roadmap_task_activity: {
    task_id: FAKE_UUID,
    field: "status",
    new_value: "todo",
  },
  roadmap_tasks: {
    sprint_id: FAKE_UUID,
    key: "fixture-task",
    title: "Fixture Task",
    status: "todo",
  },
  roadmap_work_log: {
    task_id: FAKE_UUID,
    source: "manual",
    started_at: NOW,
    request_meta: {},
    response_meta: {},
  },
  role_change_audit: {
    actor_user_id: FAKE_UUID,
    target_user_id: FAKE_UUID_2,
    role: "operator",
    action: "granted",
  },
  telegram_gateway_logs: { endpoint: "/sendMessage", ok: false, attempt: 1 },
  tenants: { name: "Fixture Tenant", slug: "fixture-tenant" },
  test_runs: { suite: "fixture", status: "passed", detail: {} },
  user_roles: { user_id: FAKE_UUID, role: "operator" },
};

/**
 * Assert that a Supabase insert error is an RLS denial, not a constraint violation.
 * Postgres returns SQLSTATE 42501 for "new row violates row-level security policy"
 * and PostgREST surfaces it with code "42501" + a message containing "row-level security".
 *
 * Some tables have ALL policies with USING/WITH CHECK = false — PostgREST may
 * surface those as a slightly different shape, so we accept both.
 */
export function isRlsDenial(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42501") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("row-level security") ||
    msg.includes("violates row level security") ||
    msg.includes("permission denied")
  );
}
