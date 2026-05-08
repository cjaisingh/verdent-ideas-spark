// /close — roll up shift digest from night_observations / night_task_audit.
import { json, type SbClient } from "./config.ts";

export async function closeShift(sb: SbClient) {
  const { data: shift } = await sb
    .from("night_shifts")
    .select("id")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!shift) return json({ error: "no_running_shift" }, 404);
  const shiftId = shift.id as string;

  const [{ data: obs }, { data: props }, { data: audits }] = await Promise.all([
    sb.from("night_observations").select("kind, severity").eq("shift_id", shiftId),
    sb.from("night_proposals").select("status").eq("shift_id", shiftId),
    sb.from("night_task_audit").select("audit_complete, worst_severity").eq("shift_id", shiftId),
  ]);

  const summary = {
    observations: obs?.length ?? 0,
    by_kind: (obs ?? []).reduce((a: Record<string, number>, o: any) => {
      a[o.kind] = (a[o.kind] ?? 0) + 1; return a;
    }, {}),
    failures: (obs ?? []).filter((o: any) => o.severity === "high").length,
    proposals_pending: (props ?? []).filter((p: any) => p.status === "pending").length,
    proposals_accepted: (props ?? []).filter((p: any) => p.status === "accepted").length,
    proposals_rejected: (props ?? []).filter((p: any) => p.status === "rejected").length,
    audits_complete: (audits ?? []).filter((a: any) => a.audit_complete).length,
    worst_per_task: (audits ?? []).reduce((a: Record<string, number>, x: any) => {
      const k = x.worst_severity ?? "info"; a[k] = (a[k] ?? 0) + 1; return a;
    }, {}),
  };

  await sb.from("night_shifts")
    .update({ status: "completed", ended_at: new Date().toISOString(), summary })
    .eq("id", shiftId);

  return json({ shift_id: shiftId, summary });
}
