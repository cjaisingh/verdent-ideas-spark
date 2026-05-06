import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Pin, PinOff, Trash2, Plus, RefreshCw, CheckCircle2, Circle, Archive, Search } from "lucide-react";

type Kind = "thought" | "issue" | "research" | "suggestion" | "todo";
type Status = "open" | "in_progress" | "resolved" | "archived";

type Entry = {
  id: string;
  kind: Kind;
  title: string;
  body: string | null;
  tags: string[];
  status: Status;
  pinned: boolean;
  author: string | null;
  created_at: string;
  updated_at: string;
};

const KINDS: { value: Kind; label: string; tone: string }[] = [
  { value: "thought", label: "Thought", tone: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  { value: "issue", label: "Issue", tone: "bg-destructive/10 text-destructive border-destructive/30" },
  { value: "research", label: "Research", tone: "bg-violet-500/10 text-violet-600 border-violet-500/30" },
  { value: "suggestion", label: "Suggestion", tone: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  { value: "todo", label: "To-do", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
];
const kindMeta = (k: Kind) => KINDS.find((x) => x.value === k)!;

const STATUS_OPTS: Status[] = ["open", "in_progress", "resolved", "archived"];

const Notebook = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterKind, setFilterKind] = useState<Kind | "all">("all");
  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [q, setQ] = useState("");

  const [newKind, setNewKind] = useState<Kind>("thought");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTags, setNewTags] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notebook_entries")
      .select("*")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Failed to load notebook", description: error.message, variant: "destructive" });
      return;
    }
    setEntries((data ?? []) as Entry[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("notebook_feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "notebook_entries" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const create = async () => {
    if (!newTitle.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const tags = newTags.split(",").map((t) => t.trim()).filter(Boolean);
    const { error } = await supabase.from("notebook_entries").insert({
      kind: newKind,
      title: newTitle.trim(),
      body: newBody.trim() || null,
      tags,
      author: u.user?.email ?? null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setNewTitle("");
    setNewBody("");
    setNewTags("");
    toast({ title: "Saved" });
  };

  const update = async (id: string, patch: Partial<Entry>) => {
    const { error } = await supabase.from("notebook_entries").update(patch).eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this entry?")) return;
    const { error } = await supabase.from("notebook_entries").delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
  };

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return entries.filter((e) => {
      if (filterKind !== "all" && e.kind !== filterKind) return false;
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      if (ql && !e.title.toLowerCase().includes(ql) && !(e.body ?? "").toLowerCase().includes(ql) && !e.tags.some(t => t.toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [entries, filterKind, filterStatus, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length };
    for (const k of KINDS) c[k.value] = entries.filter((e) => e.kind === k.value).length;
    return c;
  }, [entries]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
      {/* Compose */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> New entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={newKind} onValueChange={(v) => setNewKind(v as Kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <Textarea placeholder="Details (markdown ok)" value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={6} />
            <Input placeholder="tags, comma, separated" value={newTags} onChange={(e) => setNewTags(e.target.value)} />
            <Button onClick={create} disabled={saving} className="w-full">
              {saving ? "Saving…" : "Add to notebook"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Filter</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-7" placeholder="Search title, body, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setFilterKind("all")} className={`text-xs px-2 py-1 rounded border ${filterKind === "all" ? "bg-secondary" : "border-border text-muted-foreground"}`}>
                All ({counts.all ?? 0})
              </button>
              {KINDS.map((k) => (
                <button key={k.value} onClick={() => setFilterKind(k.value)} className={`text-xs px-2 py-1 rounded border ${filterKind === k.value ? k.tone : "border-border text-muted-foreground"}`}>
                  {k.label} ({counts[k.value] ?? 0})
                </button>
              ))}
            </div>
            <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as Status | "all")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="w-full">
              <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Notebook</h1>
          <span className="text-xs text-muted-foreground">{filtered.length} of {entries.length}</span>
        </div>

        {filtered.length === 0 && (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            {entries.length === 0 ? "Nothing here yet. Drop in a thought on the left." : "No entries match your filter."}
          </CardContent></Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((e) => {
            const meta = kindMeta(e.kind);
            return (
              <Card key={e.id} className={e.pinned ? "border-primary/40" : ""}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase ${meta.tone}`}>{meta.label}</span>
                    <h3 className="font-semibold text-sm flex-1">{e.title}</h3>
                    <button onClick={() => update(e.id, { pinned: !e.pinned })} title={e.pinned ? "Unpin" : "Pin"} className="text-muted-foreground hover:text-foreground">
                      {e.pinned ? <Pin className="h-3.5 w-3.5 fill-current" /> : <PinOff className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => remove(e.id)} title="Delete" className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {e.body && <p className="text-xs text-foreground/80 whitespace-pre-wrap">{e.body}</p>}
                  {e.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {e.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>)}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
                    <Select value={e.status} onValueChange={(v) => update(e.id, { status: v as Status })}>
                      <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                      {e.author ? ` · ${e.author}` : ""}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Notebook;
