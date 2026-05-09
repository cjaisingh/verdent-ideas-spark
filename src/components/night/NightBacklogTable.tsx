import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Inbox, MessageSquare, Layers, ListTodo, AlertTriangle, Play, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type AuditRow = {
  id: string;
  short_num: number | null;
  title: string;
  priority: string;
  status: string;
  discussion_id: string | null;
  updated_at: string;
};

type PhaseRow = {
  id: string;
  phase_id: string;
  phase_key: string | null;
  status: string;
  requested_at: string;
  scheduled_for: string | null;
  model: string | null;
  requested_by: string | null;
};

type ProposalRow = {
  id: string;
  shift_id: string;
  kind: string;
  rationale: string | null;
  target_ref: any;
  created_at: string;
};

type SettingsRow = {
  night_agent_enabled: boolean;
  night_window_start: string;
  night_window_end: string;
  night_timezone: string;
  night_blackout_dates: any;
  night_allowed_kinds: any;
};

type BacklogItem = {
  key: string;
  source: "audit" | "phase" | "proposal";
  ref: string;
  title: string;
  meta: string;
  queuedAt: string;
  href?: string;
  blocked?: string;
  badgeTone: string;
};

const rel = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const fmtUtc = (d = new Date()) =>
  `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")} UTC`;

const inWindow = (settings: SettingsRow | null) => {
  if (!settings) return false;
  const now = new Date();
  const hm = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = settings.night_window_start.split(":").map(Number);
  const [eh, em] = settings.night_window_end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start > end ? hm >= start || hm < end : hm >= start && hm < end;
};

const NightBacklogTable = () => {
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [phases, setPhases] = useState<PhaseRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const [{ data: a }, { data: p }, { data: pr }, { data: s }] = await Promise.all([
      supabase
        .from("discussion_actions" as any)
        .select("id, short_num, title, priority, status, discussion_id, updated_at")
        .eq("night_eligible", true)
        .eq("status", "open")
        .order("updated_at", { ascending: false }),
      supabase
        .from("roadmap_phase_overnight_runs" as any)
        .select("id, phase_id, phase_key, status, requested_at, scheduled_for, model, requested_by")
        .in("status", ["queued", "running"])
        .order("requested_at", { ascending: false }),
      supabase
        .from("night_proposals" as any)
        .select("id, shift_id, kind, rationale, target_ref, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("memory_settings" as any)
        .select("night_agent_enabled, night_window_start, night_window_end, night_timezone, night_blackout_dates, night_allowed_kinds")
        .maybeSingle(),
    ]);
    setAudits((a as any) ?? []);
    setPhases((p as any) ?? []);
    setProposals((pr as any) ?? []);
    setSettings((s as any) ?? null);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("night_backlog")
      .on("postgres_changes", { event: "*", schema: "public", table: "discussion_actions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_phase_overnight_runs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_proposals" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "memory_settings" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const blackout =
    Array.isArray(settings?.night_blackout_dates) && (settings!.night_blackout_dates as string[]).includes(today);
  const agentDisabled = settings && !settings.night_agent_enabled;
  const windowOpen = inWindow(settings);

  const items: BacklogItem[] = useMemo(() => {
    const out: BacklogItem[] = [];
    audits.forEach((a) => {
      out.push({
        key: `audit-${a.id}`,
        source: "audit",
        ref: `#${a.short_num ?? "?"}`,
        title: a.title,
        meta: `priority ${a.priority}`,
        queuedAt: a.updated_at,
        href: a.discussion_id ? `/discussions/${a.discussion_id}#action-${a.short_num ?? ""}` : undefined,
        badgeTone: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
      });
    });
    phases.forEach((p) => {
      out.push({
        key: `phase-${p.id}`,
        source: "phase",
        ref: p.phase_key ?? p.phase_id.slice(0, 8),
        title: p.phase_key ? `Overnight phase ${p.phase_key}` : "Overnight phase run",
        meta: `${p.status}${p.model ? ` · ${p.model}` : ""}`,
        queuedAt: p.requested_at,
        href: p.phase_key ? `/roadmap?phase=${encodeURIComponent(p.phase_key)}` : "/roadmap",
        badgeTone: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
      });
    });
    proposals.forEach((p) => {
      out.push({
        key: `proposal-${p.id}`,
        source: "proposal",
        ref: `#${p.target_ref?.short_num ?? "?"}`,
        title: p.rationale ?? p.kind,
        meta: `kind ${p.kind}`,
        queuedAt: p.created_at,
        href: `#shift-${p.shift_id}`,
        badgeTone: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
      });
    });
    return out.sort((x, y) => +new Date(y.queuedAt) - +new Date(x.queuedAt));
  }, [audits, phases, proposals]);

  const runNow = async () => {
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/night-agent/open`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: "{}",
      });
      const text = await resp.text();
      toast({
        title: resp.ok ? `Night agent triggered (${resp.status})` : `Trigger failed (${resp.status})`,
        description: text.slice(0, 240),
        variant: resp.ok ? "default" : "destructive",
      });
    } catch (e) {
      toast({
        title: "Trigger failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  const totalCount = items.length;

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Inbox className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Night backlog</div>
          <div className="text-[11px] text-muted-foreground font-mono flex flex-wrap gap-x-3">
            <span>{totalCount} queued</span>
            <span>· {audits.length} audits</span>
            <span>· {phases.length} phases</span>
            <span>· {proposals.length} pending proposals</span>
            {settings && (
              <span>
                · window {settings.night_window_start}–{settings.night_window_end} {settings.night_timezone} · now {fmtUtc()}{" "}
                {windowOpen ? <span className="text-emerald-600 dark:text-emerald-400">(in window)</span> : <span>(out of window)</span>}
              </span>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={runNow} disabled={running}>
          <Play className="h-3 w-3 mr-1.5" />
          {running ? "Triggering…" : "Run night agent now"}
        </Button>
      </header>

      {(agentDisabled || blackout) && (
        <div className="px-4 py-2 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs border-b border-amber-500/30 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          {agentDisabled && <span>Night agent is disabled in memory_settings — backlog will not be processed.</span>}
          {blackout && <span>Today ({today}) is in the night blackout list.</span>}
        </div>
      )}

      {totalCount === 0 ? (
        <div className="p-6 text-sm text-muted-foreground space-y-3">
          <div className="font-medium text-foreground">Backlog is empty.</div>
          <div>Opening a shift right now would do nothing. Add work from any of these surfaces:</div>
          <ul className="space-y-1 text-xs">
            <li className="flex items-center gap-2">
              <MessageSquare className="h-3 w-3" />
              <Link to="/discussions" className="underline">Mark a discussion action <code className="font-mono">night_eligible</code></Link>
            </li>
            <li className="flex items-center gap-2">
              <Layers className="h-3 w-3" />
              <Link to="/roadmap" className="underline">Queue a roadmap phase ("Run overnight")</Link>
            </li>
            <li className="flex items-center gap-2">
              <ListTodo className="h-3 w-3" />
              <span>Pending proposals from prior shifts will appear here automatically.</span>
            </li>
          </ul>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left font-normal px-3 py-2 w-20">Source</th>
                <th className="text-left font-normal px-3 py-2 w-16">Ref</th>
                <th className="text-left font-normal px-3 py-2">Title</th>
                <th className="text-left font-normal px-3 py-2 w-40">Meta</th>
                <th className="text-left font-normal px-3 py-2 w-24">Queued</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it) => {
                const linkProps = it.href?.startsWith("#")
                  ? { href: it.href }
                  : null;
                return (
                  <tr key={it.key} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${it.badgeTone}`}>{it.source}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{it.ref}</td>
                    <td className="px-3 py-2 text-foreground">{it.title}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono text-[11px]">{it.meta}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono text-[11px]">{rel(it.queuedAt)}</td>
                    <td className="px-3 py-2">
                      {it.href && (
                        linkProps ? (
                          <a href={linkProps.href} className="text-muted-foreground hover:text-foreground inline-flex">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <Link to={it.href} className="text-muted-foreground hover:text-foreground inline-flex">
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default NightBacklogTable;
