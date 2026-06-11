import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CopilotAgent = {
  id: string;
  slug: string;
  name: string;
  wake_word: string;
  description: string | null;
  system_prompt: string;
  tts_voice: string;
  language: string;
  default_greeting: string;
  allowed_capability_ids: string[];
  allowed_tables: string[];
  max_risk: "low" | "medium" | "high";
  enabled: boolean;
  order: number;
};

export type AgentOverride = {
  id: string;
  user_id: string;
  agent_id: string;
  tts_voice: string | null;
  greeting: string | null;
  mic_gain: number | null;
  out_volume: number | null;
  noise_gate: number | null;
  enabled: boolean;
};

/**
 * Loads the shared agent catalog plus the operator's per-agent overrides,
 * subscribes to realtime changes on both, and exposes a helper to merge
 * an agent with its override.
 */
export function useCopilotAgents() {
  const [agents, setAgents] = useState<CopilotAgent[]>([]);
  const [overrides, setOverrides] = useState<AgentOverride[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);

      const [{ data: ags }, { data: ovs }] = await Promise.all([
        supabase.from("copilot_agents").select("*").order("order", { ascending: true }),
        uid
          ? supabase.from("copilot_agent_overrides").select("*").eq("user_id", uid)
          : Promise.resolve({ data: [] as AgentOverride[] }),
      ]);
      if (cancelled) return;
      setAgents((ags ?? []) as CopilotAgent[]);
      setOverrides((ovs ?? []) as AgentOverride[]);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime: keep the catalog and overrides fresh.
  useEffect(() => {
    const ch = supabase
      .channel(`copilot_agents_stream_${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "copilot_agents" }, async () => {
        const { data } = await supabase.from("copilot_agents").select("*").order("order", { ascending: true });
        setAgents((data ?? []) as CopilotAgent[]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "copilot_agent_overrides" }, async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from("copilot_agent_overrides")
          .select("*")
          .eq("user_id", user.id);
        setOverrides((data ?? []) as AgentOverride[]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const overrideByAgent = useMemo(() => {
    const m = new Map<string, AgentOverride>();
    for (const o of overrides) m.set(o.agent_id, o);
    return m;
  }, [overrides]);

  /** Effective agent = catalog row, with the user's override fields applied. */
  const effective = (agent: CopilotAgent) => {
    const o = overrideByAgent.get(agent.id);
    return {
      ...agent,
      tts_voice: o?.tts_voice ?? agent.tts_voice,
      default_greeting: o?.greeting ?? agent.default_greeting,
      _override: o ?? null,
    };
  };

  /** Upsert this user's override row for an agent. */
  const upsertOverride = async (agentId: string, patch: Partial<Omit<AgentOverride, "id" | "user_id" | "agent_id">>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");
    const existing = overrideByAgent.get(agentId);
    const row = {
      user_id: user.id,
      agent_id: agentId,
      tts_voice: existing?.tts_voice ?? null,
      greeting: existing?.greeting ?? null,
      mic_gain: existing?.mic_gain ?? null,
      out_volume: existing?.out_volume ?? null,
      noise_gate: existing?.noise_gate ?? null,
      enabled: existing?.enabled ?? true,
      ...patch,
    };
    const { error } = await supabase
      .from("copilot_agent_overrides")
      .upsert(row, { onConflict: "user_id,agent_id" });
    if (error) throw error;
  };

  return { agents, overrides, overrideByAgent, effective, upsertOverride, loaded, userId };
}
