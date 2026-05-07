// Built-in runbook templates. Selecting one pre-fills body + steps + tags.
// Steps are appended to whatever is in the current draft, so operators can
// stack templates (e.g. "Token rotation" + "Verify webhook") in one runbook.

export interface RunbookTemplateStep { title: string; detail?: string }
export interface RunbookTemplate {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  format: "markdown" | "yaml";
  body: string;
  steps: RunbookTemplateStep[];
}

export const RUNBOOK_TEMPLATES: RunbookTemplate[] = [
  {
    id: "webhook-failing",
    title: "Webhook failing",
    summary: "Outbound webhook (alert / Telegram gateway) is returning errors or timing out.",
    tags: ["incident", "webhook", "alerts"],
    format: "markdown",
    body: `## When to use
Alert webhook deliveries are failing (\`alert_log.delivered = false\`) or
\`telegram_gateway_logs.ok = false\` rate spikes.

## Verification
\`\`\`sql
SELECT job, reason, status_code, error, created_at
FROM alert_log
WHERE delivered = false
ORDER BY created_at DESC
LIMIT 20;
\`\`\`

## Escalation
If still failing after step 4 → page the on-call operator and disable the
offending job in \`alert_settings\`.
`,
    steps: [
      { title: "Confirm scope", detail: "Check alert_log + telegram_gateway_logs for the time window. Note status_code distribution (4xx vs 5xx vs timeout)." },
      { title: "Inspect target endpoint", detail: "curl the webhook URL with a minimal payload. Capture response headers + body." },
      { title: "Check secrets / token", detail: "Verify ALERT_WEBHOOK_URL / TELEGRAM_API_KEY are set and not rotated. Re-issue if needed." },
      { title: "Replay last failed event", detail: "Re-run the cron via supabase--curl_edge_functions or 'Run now' button on /roadmap." },
      { title: "Record outcome", detail: "Add a note to this runbook + create a roadmap_review_finding if recurring." },
    ],
  },
  {
    id: "rls-denial",
    title: "RLS denial",
    summary: "Operator or service hitting 'permission denied' / 'new row violates RLS' unexpectedly.",
    tags: ["security", "rls", "debug"],
    format: "markdown",
    body: `## When to use
A query that should succeed returns Postgres error \`42501\` (permission
denied) or \`42P17\` / \`PGRST301\` (RLS rejection) for an authenticated
operator or the service role.

## Reference
- \`has_role(_user_id, _role)\` — security definer, source of truth
- e2e RLS matrix: \`bun run test:rls-coverage\`
`,
    steps: [
      { title: "Capture the failing call", detail: "Grab the route, method, JWT subject (or service token id) and exact error code/message from api_call_logs or browser network tab." },
      { title: "Confirm role", detail: "SELECT * FROM user_roles WHERE user_id = '<uid>'; — operator/admin row present?" },
      { title: "Inspect the policy", detail: "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename='<table>'; — does USING/CHECK match the caller?" },
      { title: "Reproduce in isolation", detail: "psql as operator JWT (or anon) and run the minimal failing statement. Confirms it's RLS, not app logic." },
      { title: "Patch policy or caller", detail: "Either widen the policy via migration (with audit note) OR fix the caller to use the service-role edge function path." },
      { title: "Add a regression test", detail: "Append the case to e2e/rls-matrix.test.ts so the matrix catches it next time." },
    ],
  },
  {
    id: "token-rotation",
    title: "Token rotation",
    summary: "Rotate AWIP_SERVICE_TOKEN, TELEGRAM_API_KEY, or any cross-project secret.",
    tags: ["security", "secrets", "maintenance"],
    format: "markdown",
    body: `## When to use
Scheduled rotation, suspected leak, or a cron job auth-failing with
\`401\` against awip-api.

## Affected callers
- Cron: \`scheduled-code-review\`, \`qa-validate\`, \`record-test-run\`
- Cross-project clients hitting \`awip-api\` with \`x-awip-service-token\`
`,
    steps: [
      { title: "Generate new token", detail: "openssl rand -hex 32 — store the value in a password manager before pasting anywhere." },
      { title: "Stage in Lovable Cloud", detail: "Add the new value as AWIP_SERVICE_TOKEN_NEXT (don't replace yet). Edge functions can read both during cutover." },
      { title: "Update awip-api to accept both", detail: "Temporarily allow either token — deploy + verify cron jobs still 200." },
      { title: "Roll caller secrets", detail: "Update each caller (cron jobs, partner projects, GitHub Actions) to use the new token. Confirm logs show new token id." },
      { title: "Promote NEXT → primary", detail: "Move new value to AWIP_SERVICE_TOKEN, delete _NEXT. Remove the dual-accept code path." },
      { title: "Audit", detail: "INSERT a memory_audit_log row (scope='secrets', action='rotated'). Update security memory with rotation date." },
    ],
  },
  {
    id: "qa-probe-fail",
    title: "QA probe failing",
    summary: "qa_checks row flipped from pass → fail. Triage the underlying invariant.",
    tags: ["qa", "monitoring"],
    format: "markdown",
    body: `## When to use
\`qa-validate\` cron marked a probe as \`fail\` and the alert webhook fired.
Each probe maps to a one-line invariant in the QA matrix.
`,
    steps: [
      { title: "Identify probe + last_checked_at", detail: "SELECT phase_key, criterion, status, note, last_checked_at FROM qa_checks WHERE status='fail';" },
      { title: "Reproduce manually", detail: "Run the probe's underlying query/curl by hand to confirm it really fails (not just a flake)." },
      { title: "Decide: code bug or stale probe", detail: "Either fix the system OR update the probe definition in qa-validate if invariant changed intentionally." },
      { title: "Mark resolved", detail: "Re-run qa-validate; confirm row flips back to pass and alert_log shows recovery." },
    ],
  },
  {
    id: "cron-job-down",
    title: "Cron job down",
    summary: "Scheduled automation (code review / qa-validate / record-test-run) hasn't run on schedule.",
    tags: ["automation", "cron", "incident"],
    format: "markdown",
    body: `## When to use
\`automation_runs\` for a job is older than expected cadence (see
\`mem://features/automation\`).
`,
    steps: [
      { title: "Confirm gap", detail: "SELECT job, max(created_at) FROM automation_runs GROUP BY job; — compare against expected cadence." },
      { title: "Trigger manually", detail: "Use AutomationPanel 'Run now' OR curl with x-awip-service-token. Verify it 200s." },
      { title: "Check edge function logs", detail: "supabase--edge_function_logs for the job — look for auth failures, timeouts, or import errors." },
      { title: "Inspect schedule", detail: "Confirm the GitHub Actions / pg_cron schedule still exists and is enabled." },
      { title: "Backfill if needed", detail: "If the job is idempotent, run it for the missed window and document in CHANGELOG." },
    ],
  },
];
