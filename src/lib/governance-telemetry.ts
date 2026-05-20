/**
 * Fire-and-forget UX telemetry for the /governance deep-link workflow.
 * Failures never surface to the operator — telemetry must not block the UI.
 */
import { supabase } from "@/integrations/supabase/client";

export type DeepLinkMissing = "entity" | "notebook" | "authority_rule";
export type DeepLinkEventType = "copy" | "open";

export type DeepLinkEvent = {
  event_type: DeepLinkEventType;
  task_id: string;
  missing: DeepLinkMissing;
  /** Where the event fired from. e.g. "uncovered_panel", "deeplink_url", "focus_event". */
  source?: string;
  payload?: Record<string, unknown>;
};

export async function trackGovernanceDeepLink(evt: DeepLinkEvent): Promise<void> {
  try {
    const { error } = await supabase.from("governance_deeplink_events").insert({
      event_type: evt.event_type,
      task_id: evt.task_id,
      missing: evt.missing,
      source: evt.source ?? "unknown",
      payload: evt.payload ?? {},
    });
    if (error) {
      // RLS rejection for non-operators is expected; swallow quietly.
      if (import.meta.env.DEV) {
        console.debug("[gov-deeplink] insert failed", error.message);
      }
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.debug("[gov-deeplink] insert threw", e);
    }
  }
}
