import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decide } from "./index.ts";
import { ALERT_COOLDOWN_MIN, STALE_THRESHOLD_MIN } from "../_shared/contracts/sentinel-watchdog.ts";

const NOW = new Date("2026-06-01T12:00:00Z");

Deno.test("healthy when sentinel ran within window", () => {
  const r = decide({
    now: NOW,
    sentinelLastRunAt: new Date(NOW.getTime() - (STALE_THRESHOLD_MIN - 5) * 60_000),
    lastAlertKey: null,
    lastAlertAt: null,
  });
  assertEquals(r.reason, "healthy");
  assertEquals(r.shouldAlert, false);
});

Deno.test("stale → alert when threshold exceeded and no cooldown", () => {
  const r = decide({
    now: NOW,
    sentinelLastRunAt: new Date(NOW.getTime() - (STALE_THRESHOLD_MIN + 10) * 60_000),
    lastAlertKey: null,
    lastAlertAt: null,
  });
  assertEquals(r.reason, "stale");
  assertEquals(r.shouldAlert, true);
  assertEquals(r.alertKey, `sentinel-silent::stale::${NOW.toISOString().slice(0, 13)}`);
});

Deno.test("never_ran when no successful run in window", () => {
  const r = decide({
    now: NOW,
    sentinelLastRunAt: null,
    lastAlertKey: null,
    lastAlertAt: null,
  });
  assertEquals(r.reason, "never_ran");
  assertEquals(r.shouldAlert, true);
});

Deno.test("deduped when same hour-bucket key alerted within cooldown", () => {
  const sameHourKey = `sentinel-silent::stale::${NOW.toISOString().slice(0, 13)}`;
  const r = decide({
    now: NOW,
    sentinelLastRunAt: new Date(NOW.getTime() - (STALE_THRESHOLD_MIN + 10) * 60_000),
    lastAlertKey: sameHourKey,
    lastAlertAt: new Date(NOW.getTime() - (ALERT_COOLDOWN_MIN - 10) * 60_000),
  });
  assertEquals(r.reason, "deduped");
  assertEquals(r.shouldAlert, false);
});

Deno.test("re-alerts after cooldown elapses even on same key", () => {
  const sameHourKey = `sentinel-silent::stale::${NOW.toISOString().slice(0, 13)}`;
  const r = decide({
    now: NOW,
    sentinelLastRunAt: new Date(NOW.getTime() - (STALE_THRESHOLD_MIN + 10) * 60_000),
    lastAlertKey: sameHourKey,
    lastAlertAt: new Date(NOW.getTime() - (ALERT_COOLDOWN_MIN + 10) * 60_000),
  });
  assertEquals(r.reason, "stale");
  assertEquals(r.shouldAlert, true);
});
