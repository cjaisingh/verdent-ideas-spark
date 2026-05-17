// Captures unhandled browser errors and POSTs them to the frontend-errors edge function.
// Initialised once from main.tsx.
//
// We do NOT use the supabase client here — the function is intentionally a thin POST so we
// can report errors even when the supabase client itself failed to load.

import { supabase } from "@/integrations/supabase/client";

const ENDPOINT =
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/frontend-errors`;

const SESSION_REQUEST_ID = (() => {
  try {
    const k = "awip:request_id";
    const existing = sessionStorage.getItem(k);
    if (existing) return existing;
    const fresh = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    sessionStorage.setItem(k, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
})();

let lastSentKey = "";
let lastSentAt = 0;

type Payload = {
  message: string;
  stack?: string | null;
  source?: string | null;
  lineno?: number | null;
  colno?: number | null;
  kind: "error" | "unhandledrejection" | "boundary" | "console.error" | "console.warn";
  meta?: Record<string, unknown>;
};

// Guard to avoid recursion when we patch console.error and our own sender / fetch
// logs through console under the hood.
let SENDING = false;

async function send(p: Payload): Promise<void> {
  if (SENDING) return;
  // De-dupe identical errors fired in a 5s window (e.g. React re-render storms).
  const key = `${p.kind}:${p.message}:${p.source ?? ""}:${p.lineno ?? ""}`;
  const now = Date.now();
  if (key === lastSentKey && now - lastSentAt < 5000) return;
  lastSentKey = key;
  lastSentAt = now;

  SENDING = true;
  try {
    let userId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {/* ignore */}

    const body = JSON.stringify({
      ...p,
      url: window.location.href,
      user_id: userId,
      request_id: SESSION_REQUEST_ID,
    });

    try {
      // Prefer sendBeacon so the report survives navigation / unload.
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
      await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-request-id": SESSION_REQUEST_ID },
        body,
        keepalive: true,
      });
    } catch {/* never throw from the reporter */}
  } finally {
    SENDING = false;
  }
}

export function reportBoundaryError(err: unknown, info: { componentStack?: string }): void {
  const e = err instanceof Error ? err : new Error(String(err));
  void send({
    message: e.message || "Unknown boundary error",
    stack: e.stack ?? null,
    source: null,
    lineno: null,
    colno: null,
    kind: "boundary",
    meta: { component_stack: info.componentStack ?? null },
  });
}

export function installFrontendErrorCapture(): void {
  if ((window as unknown as { __awipErrCapture?: boolean }).__awipErrCapture) return;
  (window as unknown as { __awipErrCapture?: boolean }).__awipErrCapture = true;

  window.addEventListener("error", (ev) => {
    void send({
      message: ev.message || "Unknown error",
      stack: ev.error instanceof Error ? ev.error.stack ?? null : null,
      source: ev.filename ?? null,
      lineno: ev.lineno ?? null,
      colno: ev.colno ?? null,
      kind: "error",
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason: unknown = (ev as PromiseRejectionEvent).reason;
    const e = reason instanceof Error ? reason : new Error(String(reason));
    void send({
      message: e.message || "Unhandled promise rejection",
      stack: e.stack ?? null,
      source: null,
      lineno: null,
      colno: null,
      kind: "unhandledrejection",
    });
  });
}
