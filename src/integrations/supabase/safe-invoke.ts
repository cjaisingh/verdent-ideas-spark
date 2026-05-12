import { supabase } from "./client";

/**
 * Wrapper around supabase.functions.invoke that captures transport-level
 * failures ("Failed to fetch", aborted preflight, TLS reset) into the
 * `client_error_log` table via the `client-error-beacon` edge function.
 *
 * Server-side errors (4xx/5xx with a response body) are already captured by
 * the `withLogger` middleware in `edge_request_logs`; this wrapper only
 * adds visibility for the cases where the request never reached the server.
 */
export async function safeInvoke<T = unknown>(
  functionName: string,
  options?: Parameters<typeof supabase.functions.invoke>[1],
): Promise<{ data: T | null; error: unknown }> {
  try {
    const res = await supabase.functions.invoke(functionName, options);
    return res as { data: T | null; error: unknown };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Best-effort beacon — never throw from the beacon path.
    try {
      void supabase.functions.invoke("client-error-beacon", {
        body: {
          function_name: functionName,
          message,
          url: typeof window !== "undefined" ? window.location.href : null,
          meta: { name: e instanceof Error ? e.name : null },
        },
      });
    } catch { /* ignore */ }
    return { data: null, error: e };
  }
}
