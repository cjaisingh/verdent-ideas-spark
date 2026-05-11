import { supabase } from "@/integrations/supabase/client";

export type PlanItem = {
  id: string;
  block_id: string;
  ordinal: number;
  label: string;
  detail: string | null;
  source_kind: "sentinel_finding" | "discussion_action" | "cron" | "manual";
  source_ref: string | null;
  auto_done: boolean | null;
  manual_done: boolean;
  done_at: string | null;
  notes: string | null;
};

export type PlanBlock = {
  id: string;
  plan_id: string;
  ordinal: number;
  title: string;
  est_minutes: number | null;
  summary: string | null;
};

export type PlanCriterion = {
  label: string;
  source_kind?: string;
  source_ref?: string;
  met?: boolean;
};

export type Plan = {
  id: string;
  plan_date: string;
  title: string;
  notes: string | null;
  success_criteria: PlanCriterion[];
  status: "draft" | "active" | "archived";
  created_at: string;
  updated_at: string;
};

export const isItemDone = (i: PlanItem) => i.manual_done || i.auto_done === true;

export function sourceLink(kind: PlanItem["source_kind"], ref: string | null): string | null {
  if (!ref) return null;
  switch (kind) {
    case "sentinel_finding": return `/roadmap?finding=${ref}`;
    case "discussion_action": return `/jobs?action=${ref}`;
    case "cron": return `/admin/cron-health`;
    default: return null;
  }
}

export async function fetchActivePlan(): Promise<{
  plan: Plan | null;
  blocks: PlanBlock[];
  items: PlanItem[];
}> {
  const { data: plan } = await supabase
    .from("tomorrow_plans")
    .select("*")
    .eq("status", "active")
    .order("plan_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!plan) return { plan: null, blocks: [], items: [] };

  const { data: blocks } = await supabase
    .from("tomorrow_plan_blocks")
    .select("*")
    .eq("plan_id", plan.id)
    .order("ordinal");

  const blockIds = (blocks ?? []).map((b: any) => b.id);
  const { data: items } = blockIds.length
    ? await supabase
        .from("tomorrow_plan_items")
        .select("*")
        .in("block_id", blockIds)
        .order("ordinal")
    : { data: [] };

  return {
    plan: { ...(plan as any), success_criteria: ((plan as any).success_criteria ?? []) as PlanCriterion[] },
    blocks: (blocks ?? []) as PlanBlock[],
    items: (items ?? []) as PlanItem[],
  };
}
