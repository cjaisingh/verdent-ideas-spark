import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Inbox, Send, RefreshCw, ExternalLink, ChevronLeft, ChevronRight, ArrowUpCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Kind = "idea" | "research" | "suggestion" | "question" | "chat";
type SourceKind = "dm" | "group" | "channel" | "manual_paste";

type Row = {
  id: string;
  created_at: string;
  chat_id: number | null;
  source: string | null;
  direction: string | null;
  kind: Kind | null;
  kind_source: string | null;
  kind_confidence: number | null;
  text: string | null;
  promoted_action_id: string | null;
};

type ActionMeta = { id: string; short_num: number | null; status: string | null };

const KINDS: Kind[] = ["idea", "research", "suggestion", "question", "chat"];
const ACTIONABLE = new Set<Kind>(["idea", "research", "suggestion"]);
const SOURCES: SourceKind[] = ["dm", "group", "channel", "manual_paste"];
const PAGE_SIZE = 50;
const WINDOWS: Array<{ id: string; label: string; hours: number | null }> = [
  { id: "24h", label: "Last 24h", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", hours: 24 * 30 },
  { id: "all", label: "All time", hours: null },
];

function kindTone(k: Kind | null) {
  switch (k) {
    case "idea": return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "research": return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
    case "suggestion": return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "question": return "bg-purple-500/15 text-purple-600 dark:text-purple-400";
    case "chat": return "bg-muted text-muted-foreground";
    default: return "bg-muted text-muted-foreground";
  }
}

export default function OperatorInbox() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sourceLabels, setSourceLabels] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<Record<string, ActionMeta>>({});

  // Filters
  const [directionFilter, setDirectionFilter] = useState<string>("inbound"); // inbound | outbound | all
  const [kindFilter, setKindFilter] = useState<string>("all"); // all | <Kind> | untriaged
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [promotedFilter, setPromotedFilter] = useState<string>("all"); // all | promoted | unpromoted | actionable_unpromoted
  const [windowId, setWindowId] = useState<string>("7d");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [page, setPage] = useState(0);

  // Manual paste
  const [pasteText, setPasteText] = useState("");
  const [posting, setPosting] = useState(false);

  // Load source label map once
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("operator_inbox_sources")
        .select("chat_id,label")
        .limit(500);
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as Array<{ chat_id: number | string; label: string | null }>) {
        if (r.label) map[String(r.chat_id)] = r.label;
      }
      setSourceLabels(map);
    })();
  }, []);

  // Debounce text search
  useEffect(() => {
    const t = setTimeout(() => { setSearchDebounced(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [directionFilter, kindFilter, sourceFilter, promotedFilter, windowId]);

  const load = useCallback(async () => {
    setLoading(true);
    const w = WINDOWS.find((x) => x.id === windowId)!;
    const sinceISO = w.hours == null ? null : new Date(Date.now() - w.hours * 3600_000).toISOString();
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("operator_messages")
      .select("id,created_at,chat_id,source,direction,kind,kind_source,kind_confidence,text,promoted_action_id", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (sinceISO) q = q.gte("created_at", sinceISO);
    if (directionFilter !== "all") q = q.eq("direction", directionFilter);
    if (kindFilter === "untriaged") q = q.is("kind", null);
    else if (kindFilter !== "all") q = q.eq("kind", kindFilter);
    if (sourceFilter !== "all") q = q.eq("source", sourceFilter);
    if (promotedFilter === "promoted") q = q.not("promoted_action_id", "is", null);
    else if (promotedFilter === "unpromoted") q = q.is("promoted_action_id", null);
    else if (promotedFilter === "actionable_unpromoted") {
      q = q.is("promoted_action_id", null).in("kind", ["idea", "research", "suggestion"]);
    }
    if (searchDebounced) q = q.ilike("text", `%${searchDebounced}%`);

    const { data, error, count } = await q;
    if (error) toast({ title: "Failed to load inbox", description: error.message, variant: "destructive" });
    const list = (data ?? []) as Row[];
    setRows(list);
    setTotal(count ?? 0);

    // Hydrate promoted action metadata
    const ids = Array.from(new Set(list.map((r) => r.promoted_action_id).filter(Boolean) as string[]));
    if (ids.length) {
      const { data: ad } = await supabase
        .from("discussion_actions")
        .select("id,short_num,status")
        .in("id", ids);
      const map: Record<string, ActionMeta> = {};
      for (const a of (ad ?? []) as ActionMeta[]) map[a.id] = a;
      setActions(map);
    } else {
      setActions({});
    }
    setLoading(false);
  }, [page, directionFilter, kindFilter, sourceFilter, promotedFilter, windowId, searchDebounced, toast]);

  useEffect(() => { load(); }, [load]);

  // Realtime: reload on any change (current page will refresh)
  useEffect(() => {
    const mountId = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`operator_inbox_stream_${mountId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "operator_messages" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { idea: 0, research: 0, suggestion: 0, question: 0, chat: 0, untriaged: 0, unpromoted: 0 };
    for (const r of rows) {
      if (r.kind) c[r.kind] = (c[r.kind] ?? 0) + 1;
      else c.untriaged++;
      if (r.kind && ACTIONABLE.has(r.kind) && !r.promoted_action_id) c.unpromoted++;
    }
    return c;
  }, [rows]);

  const [busyId, setBusyId] = useState<string | null>(null);

  async function setKind(id: string, kind: Kind | null) {
    setBusyId(id);
    const { data, error } = await supabase.functions.invoke("operator-inbox-ingest", {
      body: { message_id: id, kind },
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Re-tag failed", description: error.message, variant: "destructive" });
      return;
    }
    const promoted = (data as { promoted_action_id?: string | null } | null)?.promoted_action_id;
    toast({ title: "Re-tagged", description: `kind=${kind ?? "null"}${promoted ? " · promoted" : ""}` });
    load();
  }

  async function promote(id: string) {
    setBusyId(id);
    const { data, error } = await supabase.functions.invoke("operator-inbox-ingest", {
      body: { message_id: id, action: "promote" },
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Promote failed", description: error.message, variant: "destructive" });
      return;
    }
    const promoted = (data as { promoted_action_id?: string | null } | null)?.promoted_action_id;
    toast({ title: "Promoted", description: promoted ? `→ action ${promoted.slice(0, 8)}` : "(no-op)" });
    load();
  }

  async function unpromote(id: string) {
    if (!confirm("Cancel the linked action and unlink it from this message?")) return;
    setBusyId(id);
    const { error } = await supabase.functions.invoke("operator-inbox-ingest", {
      body: { message_id: id, action: "unpromote" },
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Unpromote failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Unpromoted", description: "Linked action cancelled." });
    load();
  }

  async function submitPaste() {
    if (!pasteText.trim()) return;
    setPosting(true);
    const { data, error } = await supabase.functions.invoke("operator-inbox-ingest", {
      body: { text: pasteText, source: "manual_paste" },
    });
    setPosting(false);
    if (error) {
      toast({ title: "Paste failed", description: error.message, variant: "destructive" });
      return;
    }
    setPasteText("");
    const d = data as { kind?: string | null; promoted_action_id?: string | null } | null;
    toast({ title: "Ingested", description: `kind=${d?.kind ?? "n/a"}${d?.promoted_action_id ? " · auto-promoted" : ""}` });
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5" />
          <h1 className="text-2xl font-semibold">Operator inbox</h1>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      <Card className="p-3 flex flex-wrap gap-2 items-center text-xs">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter((kf) => (kf === k ? "all" : k))}
            className={`px-2 py-1 rounded ${kindTone(k)} ${kindFilter === k ? "ring-2 ring-primary" : ""}`}
          >
            {k}: {counts[k] ?? 0}
          </button>
        ))}
        <button
          onClick={() => setKindFilter((kf) => (kf === "untriaged" ? "all" : "untriaged"))}
          className={`px-2 py-1 rounded bg-muted ${kindFilter === "untriaged" ? "ring-2 ring-primary" : ""}`}
        >
          untriaged: {counts.untriaged}
        </button>
        <button
          onClick={() => setPromotedFilter((p) => (p === "actionable_unpromoted" ? "all" : "actionable_unpromoted"))}
          className={`px-2 py-1 rounded bg-red-500/15 text-red-600 dark:text-red-400 ${promotedFilter === "actionable_unpromoted" ? "ring-2 ring-primary" : ""}`}
        >
          actionable unpromoted: {counts.unpromoted}
        </button>
        <span className="text-muted-foreground ml-auto">
          {total.toLocaleString("en-GB")} total · page {page + 1}/{totalPages}
        </span>
      </Card>

      <Card className="p-3 space-y-2">
        <div className="text-sm font-medium">Manual paste</div>
        <Textarea
          rows={3}
          placeholder="Paste a Telegram/Discord/email message here — it'll be classified and promoted like inbound chat."
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={submitPaste} disabled={posting || !pasteText.trim()}>
            <Send className="h-4 w-4 mr-2" /> Ingest
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={directionFilter} onValueChange={setDirectionFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inbound">Inbound</SelectItem>
            <SelectItem value="outbound">Outbound (bot)</SelectItem>
            <SelectItem value="all">All directions</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="untriaged">Untriaged</SelectItem>
            {KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={promotedFilter} onValueChange={setPromotedFilter}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All promotion states</SelectItem>
            <SelectItem value="promoted">Promoted</SelectItem>
            <SelectItem value="unpromoted">Unpromoted</SelectItem>
            <SelectItem value="actionable_unpromoted">Actionable unpromoted</SelectItem>
          </SelectContent>
        </Select>
        <Select value={windowId} onValueChange={setWindowId}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search text…"
          className="h-8 text-xs w-56"
        />
      </div>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left p-2">When</th>
              <th className="text-left p-2">Source</th>
              <th className="text-left p-2">Text</th>
              <th className="text-left p-2">Kind</th>
              <th className="text-left p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No messages match the current filters.</td></tr>
            ) : rows.map((r) => {
              const label = (r.chat_id != null && sourceLabels[String(r.chat_id)]) || r.source || "—";
              const action = r.promoted_action_id ? actions[r.promoted_action_id] : null;
              return (
                <tr key={r.id} className="border-b hover:bg-muted/30 align-top">
                  <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("en-GB")}
                  </td>
                  <td className="p-2 text-xs">
                    <Badge variant="outline">{label}</Badge>
                    {r.source && r.source !== label && (
                      <div className="text-[10px] text-muted-foreground mt-1">{r.source}</div>
                    )}
                  </td>
                  <td className="p-2 max-w-xl">
                    <div className="whitespace-pre-wrap break-words">
                      {r.text ?? <em className="text-muted-foreground">(no text)</em>}
                    </div>
                  </td>
                  <td className="p-2">
                    <Select value={r.kind ?? "none"} onValueChange={(v) => setKind(r.id, v === "none" ? null : v as Kind)}>
                      <SelectTrigger className={`h-7 text-xs w-32 ${kindTone(r.kind)}`}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {r.kind_source && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {r.kind_source}{r.kind_confidence != null ? ` · ${(r.kind_confidence * 100).toFixed(0)}%` : ""}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {action ? (
                      <Link to={`/jobs?action=${action.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        #{action.short_num ?? "?"} <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : r.promoted_action_id ? (
                      <Link to={`/jobs?action=${r.promoted_action_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        link <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{showingFrom.toLocaleString("en-GB")}–{showingTo.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Prev
          </Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
