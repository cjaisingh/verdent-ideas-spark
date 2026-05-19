import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Inbox, Send, RefreshCw, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Kind = "idea" | "research" | "suggestion" | "question" | "chat";

type Row = {
  id: string;
  created_at: string;
  chat_id: number;
  source: string;
  kind: Kind | null;
  kind_source: string | null;
  text: string | null;
  promoted_action_id: string | null;
  source_label: string | null;
  action_short_num: number | null;
  action_status: string | null;
};

const KINDS: Kind[] = ["idea", "research", "suggestion", "question", "chat"];
const ACTIONABLE = new Set<Kind>(["idea", "research", "suggestion"]);

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
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<string>("all");
  const [unpromotedOnly, setUnpromotedOnly] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [posting, setPosting] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("v_operator_inbox_24h" as any)
      .select("*")
      .limit(200);
    if (error) toast({ title: "Failed to load inbox", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const mountId = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`operator_inbox_stream_${mountId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "operator_messages" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterKind !== "all" && r.kind !== filterKind) return false;
    if (unpromotedOnly && (r.promoted_action_id || !ACTIONABLE.has(r.kind as Kind))) return false;
    return true;
  }), [rows, filterKind, unpromotedOnly]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { idea: 0, research: 0, suggestion: 0, question: 0, chat: 0, unpromoted: 0 };
    for (const r of rows) {
      if (r.kind) c[r.kind] = (c[r.kind] ?? 0) + 1;
      if (r.kind && ACTIONABLE.has(r.kind) && !r.promoted_action_id) c.unpromoted++;
    }
    return c;
  }, [rows]);

  async function setKind(id: string, kind: Kind | null) {
    const { data, error } = await supabase.functions.invoke("operator-inbox-ingest", {
      body: { message_id: id, kind },
    });
    if (error) {
      toast({ title: "Re-tag failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Re-tagged", description: `kind=${kind ?? "null"}${(data as any)?.promoted_action_id ? " · promoted" : ""}` });
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
    toast({ title: "Ingested", description: `kind=${(data as any)?.kind ?? "n/a"}${(data as any)?.promoted_action_id ? " · auto-promoted" : ""}` });
    load();
  }

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
          <span key={k} className={`px-2 py-1 rounded ${kindTone(k)}`}>{k}: {counts[k] ?? 0}</span>
        ))}
        <span className="px-2 py-1 rounded bg-red-500/15 text-red-600 dark:text-red-400">
          unpromoted: {counts.unpromoted}
        </span>
        <span className="text-muted-foreground ml-auto">last 24h · {rows.length} messages</span>
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

      <div className="flex gap-2 items-center">
        <Select value={filterKind} onValueChange={setFilterKind}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            {KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={unpromotedOnly} onChange={(e) => setUnpromotedOnly(e.target.checked)} />
          Unpromoted only
        </label>
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
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No messages in the last 24h.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="border-b hover:bg-muted/30 align-top">
                <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("en-GB")}
                </td>
                <td className="p-2 text-xs">
                  <Badge variant="outline">{r.source_label ?? r.source}</Badge>
                </td>
                <td className="p-2 max-w-xl">
                  <div className="whitespace-pre-wrap break-words">{r.text ?? <em className="text-muted-foreground">(no text)</em>}</div>
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
                    <div className="text-[10px] text-muted-foreground mt-1">{r.kind_source}</div>
                  )}
                </td>
                <td className="p-2 text-xs">
                  {r.promoted_action_id ? (
                    <Link to={`/jobs?action=${r.promoted_action_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      #{r.action_short_num ?? "?"} <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
