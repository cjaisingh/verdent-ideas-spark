// Heuristic classifier for automation_runs errors.
// Maps a (status_code, message) pair to a likely root cause + remediation hint.

export type ErrorCause = {
  id: string;
  label: string;
  hint: string;
  fix?: { to: string; label: string };
};

const CAUSES: Record<string, ErrorCause> = {
  missing_service_token_header: {
    id: "missing_service_token_header",
    label: "Missing x-service-token header",
    hint:
      "The cron caller did not send `x-service-token`. Check the cron.schedule SQL — the `headers` jsonb must include the AWIP_SERVICE_TOKEN.",
  },
  token_mismatch: {
    id: "token_mismatch",
    label: "AWIP_SERVICE_TOKEN mismatch",
    hint:
      "The token sent by cron does not equal the edge env value. Run the cron-secrets check to compare fingerprints, then rotate one side.",
    fix: { to: "/admin#cron-secret-integrity", label: "Run integrity check" },
  },
  missing_env_secret: {
    id: "missing_env_secret",
    label: "Edge function env var missing",
    hint:
      "A required secret is not set in Lovable Cloud. Add it under Connectors → Lovable Cloud → Secrets.",
  },
  missing_db_secret: {
    id: "missing_db_secret",
    label: "app_secrets row missing",
    hint:
      "The cron job reads from `public.app_secrets` and the row is gone. The next secrets-health-check tick auto-syncs from env, or insert it manually.",
    fix: { to: "/admin", label: "Open app_secrets panel" },
  },
  unauthorized: {
    id: "unauthorized",
    label: "Unauthorized (401)",
    hint:
      "Either the JWT is invalid or the service token failed validation. Re-check the Authorization header or the x-service-token value.",
  },
  permission_denied: {
    id: "permission_denied",
    label: "Permission denied / RLS",
    hint:
      "The function is using the anon key or a JWT that lacks the operator role. Use SUPABASE_SERVICE_ROLE_KEY for system writes, or grant the role.",
  },
  rate_limited: {
    id: "rate_limited",
    label: "Rate limited (429)",
    hint:
      "Upstream provider rate limited the call. Reduce frequency, batch, or use a cheaper night model (already enforced 22:00–06:00 UTC).",
  },
  upstream_5xx: {
    id: "upstream_5xx",
    label: "Upstream 5xx",
    hint:
      "Provider returned a server error. Usually transient — check provider status page; the next cron tick will retry.",
  },
  network_failure: {
    id: "network_failure",
    label: "Network / fetch failure",
    hint:
      "The function could not reach an external service. Check provider status and DNS; transient errors auto-recover next tick.",
  },
  timeout: {
    id: "timeout",
    label: "Function timeout",
    hint:
      "The function exceeded the edge runtime timeout. Split the work, paginate, or run async with a queue.",
  },
  no_rows: {
    id: "no_rows",
    label: "No work to do",
    hint:
      "The job ran but found nothing to process. Often expected — only treat as error if the queue should not be empty.",
  },
  unknown: {
    id: "unknown",
    label: "Unclassified error",
    hint:
      "No heuristic matched. Open the row to read the full message and check edge function logs.",
  },
};

export function classifyError(
  job: string,
  status_code: number | null,
  message: string | null,
): ErrorCause {
  const m = (message ?? "").toLowerCase();

  if (m.includes("missing service token") || m.includes("x-service-token")) {
    return CAUSES.missing_service_token_header;
  }
  if (m.includes("mismatch") && m.includes("token")) return CAUSES.token_mismatch;
  if (m.includes("secrets_mismatch") || m.includes("mismatched")) return CAUSES.token_mismatch;
  if (m.includes("missing in env") || m.includes("env var") || m.includes("is missing in lovable cloud")) {
    return CAUSES.missing_env_secret;
  }
  if (m.includes("missing in db") || m.includes("app_secrets") && m.includes("missing")) {
    return CAUSES.missing_db_secret;
  }
  if (m.includes("permission denied") || m.includes("row-level security") || m.includes("rls")) {
    return CAUSES.permission_denied;
  }
  if (m.includes("rate limit") || status_code === 429) return CAUSES.rate_limited;
  if (m.includes("timeout") || m.includes("timed out")) return CAUSES.timeout;
  if (m.includes("fetch failed") || m.includes("network") || m.includes("enotfound") || m.includes("econnrefused")) {
    return CAUSES.network_failure;
  }
  if (m.includes("no candidates") || m.includes("no work") || m.includes("empty queue")) {
    return CAUSES.no_rows;
  }
  if (status_code === 401 || status_code === 403) return CAUSES.unauthorized;
  if (status_code !== null && status_code >= 500 && status_code < 600) return CAUSES.upstream_5xx;
  return CAUSES.unknown;
}
