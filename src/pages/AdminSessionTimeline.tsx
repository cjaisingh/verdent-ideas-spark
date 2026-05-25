import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  RefreshCcw,
  FileText,
  GitCommit,
  Cpu,
  Loader2,
  ExternalLink,
  Repeat,
  AlertCircle,
} from "lucide-react";

type SessionRow = {
  id: string;
  session_id: string;
  agent: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number | null;
  goal: string | null;
  outcome: string;
  files_touched: string[];
  migrations_applied: string[];
  edge_fns_touched: string[];
  unresolved: string[];
  bootstrap_acknowledged: boolean;
};

type ActionRow = {
  id: string;
  short_num: number;
  title: string;
  status: string;
  priority: string;
  risk: string;
  source: string;
  source_ref: string | null;
  created_at: string;
};

type Grouped = {
  session: SessionRow;
  // Items deferred mid-session (source_ref = session:<summary.id>, source = session_summary)
  fromSession: ActionRow[];
  // Items declared up-front in the plan footer that was POSTed during this session window
  fromPlan: ActionRow[];
};

function statusTone(s: string) {
  switch (s) {
    case "open":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "in_progress":
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    case "done":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "blocked":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "skipped":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function priorityTone(p: string) {
  if (p === "high" || p === "critical")
    return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  if (p === "med") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function fmtDuration(mins: number | null) {
  if (mins == null) return "—";
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

const PAGE_SIZE = 25;

function isPartial(s: SessionRow): boolean {
  return (
    !s.bootstrap_acknowledged ||
    (Array.isArray(s.unresolved) && s.unresolved.length > 0) ||
    !s.outcome ||
    s.outcome.trim().length === 0
  );
}

export default function AdminSessionTimeline() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<string>("all");
  const [refreshTick, setRefreshTick] = useState(0);
  const [replayTarget, setReplayTarget] = useState<SessionRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const sQuery = supabase
        .from("session_summaries")
        .select(
          "id, session_id, agent, started_at, ended_at, duration_minutes, goal, outcome, files_touched, migrations_applied, edge_fns_touched, unresolved, bootstrap_acknowledged",
        )
        .order("started_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (agent !== "all") sQuery.eq("agent", agent);
      const { data: ss, error: sErr } = await sQuery;
      if (sErr) {
        console.error(sErr);
        if (!cancelled) setLoading(false);
        return;
      }
      const rows = (ss ?? []) as SessionRow[];

      const refs = rows.map((r) => `session:${r.id}`);
      let aRows: ActionRow[] = [];
      if (rows.length > 0) {
        const { data: aa } = await supabase
          .from("discussion_actions")
          .select(
            "id, short_num, title, status, priority, risk, source, source_ref, created_at",
          )
          .in("source", ["session_summary", "plan_footer"])
          .gte(
            "created_at",
            new Date(
              new Date(rows[rows.length - 1].started_at).getTime() - 60 * 60 * 1000,
            ).toISOString(),
          )
          .order("created_at", { ascending: false })
          .limit(1000);
        aRows = ((aa ?? []) as ActionRow[]).filter(
          (a) =>
            (a.source === "session_summary" && refs.includes(a.source_ref ?? "")) ||
            a.source === "plan_footer",
        );
      }

      if (!cancelled) {
        setSessions(rows);
        setActions(aRows);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [agent, refreshTick]);

  const agents = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => set.add(s.agent));
    return Array.from(set);
  }, [sessions]);

  const grouped: Grouped[] = useMemo(() => {
    return sessions.map((session) => {
      const start = new Date(session.started_at).getTime();
      const end = new Date(session.ended_at).getTime();
      const fromSession = actions.filter(
        (a) =>
          a.source === "session_summary" &&
          a.source_ref === `session:${session.id}`,
      );
      // Plan footers don't carry a back-pointer to the session, so approximate by
      // attributing plan_footer actions created within the session window.
      const fromPlan = actions.filter(
        (a) =>
          a.source === "plan_footer" &&
          new Date(a.created_at).getTime() >= start - 5 * 60 * 1000 &&
          new Date(a.created_at).getTime() <= end + 30 * 60 * 1000,
      );
      return { session, fromSession, fromPlan };
    });
  }, [sessions, actions]);

  return (
    <div className="container mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Session timeline</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Last {PAGE_SIZE} AWIP sessions. Each card shows promoted{" "}
            <code className="text-xs">discussion_actions</code> (deferred
            mid-flight via <code className="text-xs">session_summary</code>) and
            items declared up-front in the plan footer (
            <code className="text-xs">plan_footer</code>) created during the
            session window.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="bg-background border border-border rounded-md px-2 py-1 text-sm"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="all">All agents</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshTick((t) => t + 1)}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
        </div>
      )}

      {!loading && grouped.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No sessions yet. Sessions appear here once{" "}
            <code>session-summary-log</code> has been POSTed.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {grouped.map(({ session, fromSession, fromPlan }) => (
          <Card key={session.id} className="border-border">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span>{session.agent}</span>
                    <span className="text-muted-foreground font-normal">·</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {session.session_id.slice(0, 12)}
                    </span>
                  </CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {new Date(session.started_at).toLocaleString()} →{" "}
                    {new Date(session.ended_at).toLocaleString()} (
                    {fmtDuration(session.duration_minutes)})
                  </div>
                  {session.goal && (
                    <div className="text-sm mt-1">
                      <span className="text-muted-foreground">Goal: </span>
                      {session.goal}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {isPartial(session) && (
                    <Badge
                      variant="outline"
                      className="bg-amber-500/15 text-amber-300 border-amber-500/30"
                    >
                      <AlertCircle className="h-3 w-3 mr-1" />
                      partial
                    </Badge>
                  )}
                  {session.files_touched.length > 0 && (
                    <Badge variant="outline" className="font-normal">
                      <FileText className="h-3 w-3 mr-1" />
                      {session.files_touched.length} files
                    </Badge>
                  )}
                  {session.migrations_applied.length > 0 && (
                    <Badge variant="outline" className="font-normal">
                      <GitCommit className="h-3 w-3 mr-1" />
                      {session.migrations_applied.length} migrations
                    </Badge>
                  )}
                  {session.edge_fns_touched.length > 0 && (
                    <Badge variant="outline" className="font-normal">
                      <Cpu className="h-3 w-3 mr-1" />
                      {session.edge_fns_touched.length} edge fns
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setReplayTarget(session)}
                    title="Re-fan deferred items via session-replay (idempotent)"
                  >
                    <Repeat className="h-3.5 w-3.5 mr-1" />
                    Replay
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {session.outcome && (
                <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                  {session.outcome}
                </p>
              )}

              <ActionsList
                label="Deferred mid-flight"
                source="session_summary"
                items={fromSession}
                emptyHint="No mid-flight deferrals recorded."
              />
              <ActionsList
                label="Declared in plan footer"
                source="plan_footer"
                items={fromPlan}
                emptyHint="No plan-footer items attributed to this window."
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <ReplayDialog
        target={replayTarget}
        onClose={(refresh) => {
          setReplayTarget(null);
          if (refresh) setRefreshTick((t) => t + 1);
        }}
      />
    </div>
  );
}

function ReplayDialog({
  target,
  onClose,
}: {
  target: SessionRow | null;
  onClose: (refresh: boolean) => void;
}) {
  const [includeUnresolved, setIncludeUnresolved] = useState(true);
  const [extra, setExtra] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (target) {
      setIncludeUnresolved(true);
      setExtra("");
      setRunning(false);
    }
  }, [target?.id]);

  if (!target) return null;
  const unresolvedCount = target.unresolved?.length ?? 0;

  async function run() {
    setRunning(true);
    const extra_out_of_scope = extra
      .split("\n")
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
    const { data, error } = await supabase.functions.invoke("session-replay", {
      body: {
        summary_id: target!.id,
        include_unresolved: includeUnresolved,
        extra_out_of_scope,
      },
    });
    setRunning(false);
    if (error) {
      toast({
        title: "Replay failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    const r = (data as { replayed?: { created?: unknown[]; skipped?: unknown[] } })
      ?.replayed;
    toast({
      title: "Session replayed",
      description: `${r?.created?.length ?? 0} created · ${r?.skipped?.length ?? 0} already present (idempotent).`,
    });
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replay session</DialogTitle>
          <DialogDescription>
            Re-runs the deferral fan-out for{" "}
            <span className="font-mono text-xs">
              {target.session_id.slice(0, 12)}
            </span>
            . Idempotent — items already in <code>discussion_actions</code> will
            be skipped, not duplicated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={includeUnresolved}
              onCheckedChange={(v) => setIncludeUnresolved(!!v)}
              disabled={unresolvedCount === 0}
            />
            <span>
              Re-fan stored <code>unresolved[]</code>{" "}
              <span className="text-muted-foreground">
                ({unresolvedCount} item{unresolvedCount === 1 ? "" : "s"})
              </span>
            </span>
          </label>

          {unresolvedCount > 0 && includeUnresolved && (
            <ul className="text-xs text-muted-foreground space-y-1 ml-6 max-h-32 overflow-y-auto">
              {target.unresolved.map((u, i) => (
                <li key={i}>• {u}</li>
              ))}
            </ul>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Extra out-of-scope bullets (one per line)
            </label>
            <Textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="- Item to defer\n- Another follow-up"
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={running}>
            Cancel
          </Button>
          <Button onClick={run} disabled={running}>
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Repeat className="h-4 w-4 mr-2" />
            )}
            Replay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionsList({
  label,
  source,
  items,
  emptyHint,
}: {
  label: string;
  source: "session_summary" | "plan_footer";
  items: ActionRow[];
  emptyHint: string;
}) {
  const tone =
    source === "session_summary"
      ? "border-violet-500/30 bg-violet-500/5"
      : "border-sky-500/30 bg-sky-500/5";
  const chip =
    source === "session_summary"
      ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
      : "bg-sky-500/15 text-sky-300 border-sky-500/30";

  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Badge variant="outline" className={chip}>
            {source}
          </Badge>
          {label}
          <span className="text-muted-foreground/70">({items.length})</span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">{emptyHint}</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-2 text-sm py-1 border-b border-border/40 last:border-0"
            >
              <span className="text-muted-foreground font-mono text-xs shrink-0 mt-0.5">
                #{a.short_num}
              </span>
              <Link
                to={`/discussions?action=${a.id}`}
                className="flex-1 hover:underline truncate"
                title={a.title}
              >
                {a.title}
              </Link>
              <Badge variant="outline" className={`${statusTone(a.status)} shrink-0`}>
                {a.status}
              </Badge>
              <Badge
                variant="outline"
                className={`${priorityTone(a.priority)} shrink-0`}
              >
                {a.priority}
              </Badge>
              <ExternalLink className="h-3 w-3 text-muted-foreground/60 shrink-0 mt-1" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
