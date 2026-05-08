// Pure time helpers — local-time formatting and window membership.

// Returns HH:MM and YYYY-MM-DD in the configured zone, falling back to UTC.
export function localParts(now: Date, tz: string) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).formatToParts(now);
    const get = (k: string) => fmt.find((p) => p.type === k)?.value ?? "";
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      hhmm: `${get("hour")}:${get("minute")}`,
    };
  } catch {
    return {
      date: now.toISOString().slice(0, 10),
      hhmm: now.toISOString().slice(11, 16),
    };
  }
}

export function inWindow(hhmm: string, start: string, end: string) {
  if (start === end) return false;
  return start < end ? (hhmm >= start && hhmm < end) : (hhmm >= start || hhmm < end);
}
