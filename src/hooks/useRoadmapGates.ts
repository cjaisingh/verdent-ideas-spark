import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PhaseGate {
  phase_id: string;
  phase_key: string;
  phase_status: string;
  total_tasks: number;
  open_tasks: number;
  qa_total: number;
  qa_pass: number;
  night_high_open: number;
  pending_signoffs: number;
  structural_ok: boolean;
  qa_ok: boolean;
  night_ok: boolean;
  approvals_ok: boolean;
  all_ok: boolean;
  blockers: Record<string, number>;
}

export function useRoadmapGates() {
  const [gates, setGates] = useState<Map<string, PhaseGate>>(new Map());

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("roadmap_phase_gate_status" as never)
        .select("*");
      if (!active || error || !data) return;
      const m = new Map<string, PhaseGate>();
      for (const row of data as PhaseGate[]) m.set(row.phase_id, row);
      setGates(m);
    };
    load();
    const ch = supabase
      .channel("roadmap-gates")
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_tasks" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "qa_checks" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_queue" }, load)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, []);

  return gates;
}
