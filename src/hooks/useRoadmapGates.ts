import { useEffect, useRef, useState } from "react";
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
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("roadmap_phase_gate_status" as never)
        .select("*");
      if (!activeRef.current || error || !data) return;
      const m = new Map<string, PhaseGate>();
      for (const row of data as PhaseGate[]) m.set(row.phase_id, row);
      setGates(m);
      setRefreshedAt(new Date());
    };

    const scheduleLoad = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 250);
    };

    load();

    const ch = supabase
      .channel("roadmap-gates")
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_tasks" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_phases" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "qa_checks" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_queue" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_observations" }, scheduleLoad)
      .subscribe();

    // Refetch when tab regains focus / visibility (catches missed events)
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleLoad();
    };
    window.addEventListener("focus", scheduleLoad);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      activeRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
      window.removeEventListener("focus", scheduleLoad);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { gates, refreshedAt };
}
