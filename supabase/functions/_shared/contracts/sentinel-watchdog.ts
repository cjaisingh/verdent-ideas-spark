// Typed contract for the out-of-band sentinel watchdog.
//
// Why this exists: sentinel-tick runs ~22 silence detectors but cannot detect
// its own silence. On 2026-06-01 a stale AWIP_SERVICE_TOKEN 401'd sentinel-tick
// itself, so every alert built on top of it (gh_actions_watch_auth_failed,
// cron_auth_failures_burst, secrets_health_stale, Telegram fan-out) went silent
// in lockstep. The watchdog is a deliberately tiny, single-purpose edge fn with
// NO shared-secret coupling to sentinel-tick. It is unauthenticated by design —
// idempotent (heartbeat-only) with hour-bucket dedupe + 6h cooldown on alerts,
// and calls the Telegram connector gateway DIRECTLY (no telegram-send middleman),
// so neither AWIP_SERVICE_TOKEN nor any other rotating secret can silence it.
//
// See docs/sentinel.md and mem://features/sentinel-monitoring-coverage.

export type SentinelWatchdogTrigger = "cron" | "manual";

export type SentinelWatchdogInput = {
  trigger: SentinelWatchdogTrigger;
};

export type SentinelWatchdogReason =
  | "healthy"      // sentinel-tick ran successfully within window
  | "stale"        // ran, but more than STALE_THRESHOLD_MIN ago
  | "never_ran"    // no successful run in the lookback window
  | "deduped";     // would have alerted, but the same hour-bucket key was already used recently

export type SentinelWatchdogOutput = {
  ok: true;
  trigger: SentinelWatchdogTrigger;
  sentinel_last_run_at: string | null;
  minutes_silent: number | null;
  alerted: boolean;
  reason: SentinelWatchdogReason;
  alert_dedupe_key: string | null;
  top_failing_jobs: Array<{ job: string; status_code: number | null; count: number }>;
};

/** Sentinel-tick cadence is 15 min; we alert after 2× cadence of silence. */
export const STALE_THRESHOLD_MIN = 30;

/** Cooldown between identical alerts (hour-bucket dedupe key). */
export const ALERT_COOLDOWN_MIN = 6 * 60;

/** Lookback window when judging "never ran". */
export const NEVER_RAN_WINDOW_HOURS = 24;
