import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Check, X, RotateCcw, Search } from "lucide-react";

type Entry = {
  id: string;
  slug: string | null;
  title: string;
  area: string;
  what: string;
  why: string;
  how_to_use: string;
  impact: string;
  status: "draft" | "published" | "dismissed";
  source_refs: Record<string, unknown>;
  shipped_at: string;
  published_at: string | null;
  model: string | null;
  created_at: string;
};

type Source = {
  id: string;
  kind: string;
  ref: string;
  entry_id: string | null;
  seen_at: string;
  dismissed: boolean;
};

const AREAS = ["schema", "edge", "ui", "cron", "policy", "docs"] as const;

function useEntries(status: Entry["status"]) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("whats_new_entries")
      .select("*")
      .eq("status", status)
      .order("shipped_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as Entry[]);
    setLoading(false);
  };
  useEffect(() => { void reload(); }, [status]);
  useEffect(() => {
    const ch = supabase
      .channel(`whats-new-entries-${status}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "whats_new_entries" }, () => void reload())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [status]);
  return { rows, loading, reload };
}

function DraftEditor({ entry, onChange }: { entry: Entry; onChange: (patch: Partial<Entry>) => void }) {
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-2">
        <Input value={entry.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title" />
        <Select value={entry.area} onValueChange={(v) => onChange({ area: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {(["what", "why", "how_to_use", "impact"] as const).map((k) => (
        <div key={k}>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">{k.replace("_", " ")}</label>
          <Textarea
            rows={k === "what" ? 3 : 2}
            value={entry[k]}
            onChange={(e) => onChange({ [k]: e.target.value } as Partial<Entry>)}
          />
        </div>
      ))}
    </div>
  );
}

function EntryCard({ entry, mode, onAction }: {
  entry: Entry;
  mode: "draft" | "published";
  onAction: (action: "publish" | "dismiss" | "regenerate" | "save" | "unpublish", patch?: Partial<Entry>) => void;
}) {
  const [local, setLocal] = useState(entry);
  useEffect(() => setLocal(entry), [entry.id]);
  const dirty = JSON.stringify(local) !== JSON.stringify(entry);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-base">{local.title}</CardTitle>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <Badge variant="outline">{local.area}</Badge>
              <span>{new Date(local.shipped_at).toLocaleString("en-GB")}</span>
              {local.model && <span className="opacity-60">· {local.model}</span>}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "draft" ? (
          <DraftEditor entry={local} onChange={(p) => setLocal({ ...local, ...p } as Entry)} />
        ) : (
          <div className="grid gap-3 text-sm">
            {(["what", "why", "how_to_use", "impact"] as const).map((k) => (
              <div key={k}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{k.replace("_", " ")}</div>
                <div className="whitespace-pre-wrap">{local[k] || <span className="opacity-40">—</span>}</div>
              </div>
            ))}
          </div>
        )}

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Source refs</summary>
          <pre className="mt-1 p-2 bg-muted rounded overflow-auto text-[11px]">
            {JSON.stringify(local.source_refs, null, 2)}
          </pre>
        </details>

        <div className="flex flex-wrap gap-2 pt-1">
          {mode === "draft" && (
            <>
              <Button size="sm" onClick={() => onAction("publish", dirty ? local : undefined)}>
                <Check className="h-3.5 w-3.5 mr-1" /> Publish
              </Button>
              {dirty && (
                <Button size="sm" variant="outline" onClick={() => onAction("save", local)}>
                  Save
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onAction("regenerate")}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Regenerate
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onAction("dismiss")}>
                <X className="h-3.5 w-3.5 mr-1" /> Dismiss
              </Button>
            </>
          )}
          {mode === "published" && (
            <Button size="sm" variant="outline" onClick={() => onAction("unpublish")}>
              Unpublish
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function WhatsNew() {
  const [tab, setTab] = useState<"drafts" | "published" | "sources">("drafts");
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<string>("all");

  const drafts = useEntries("draft");
  const published = useEntries("published");

  const [sources, setSources] = useState<Source[]>([]);
  const reloadSources = async () => {
    const { data } = await supabase
      .from("whats_new_sources")
      .select("*")
      .order("seen_at", { ascending: false })
      .limit(200);
    setSources((data ?? []) as Source[]);
  };
  useEffect(() => { if (tab === "sources") void reloadSources(); }, [tab]);

  const filteredPublished = useMemo(() => {
    let r = published.rows;
    if (areaFilter !== "all") r = r.filter((e) => e.area === areaFilter);
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((e) =>
        [e.title, e.what, e.why, e.how_to_use, e.impact].some((s) => s.toLowerCase().includes(q))
      );
    }
    return r;
  }, [published.rows, areaFilter, search]);

  const scan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("whats-new-draft", { body: {} });
      if (error) throw error;
      toast({ title: "Scan complete", description: `${(data as any)?.drafted ?? 0} new drafts` });
      void drafts.reload();
    } catch (e) {
      toast({ title: "Scan failed", description: String((e as Error).message), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleAction = async (
    entry: Entry,
    action: "publish" | "dismiss" | "regenerate" | "save" | "unpublish",
    patch?: Partial<Entry>,
  ) => {
    if (action === "regenerate") {
      // Clear sources for this entry then trigger scan; simplest: just delete the entry,
      // unmark sources, and scan.
      await supabase.from("whats_new_sources").update({ entry_id: null }).eq("entry_id", entry.id);
      await supabase.from("whats_new_entries").delete().eq("id", entry.id);
      await scan();
      return;
    }
    const update: Record<string, unknown> = { ...(patch ?? {}) };
    if (action === "publish") { update.status = "published"; update.published_at = new Date().toISOString(); }
    if (action === "dismiss") update.status = "dismissed";
    if (action === "save") { /* just save patch */ }
    if (action === "unpublish") update.status = "draft";
    const { error } = await supabase.from("whats_new_entries").update(update as never).eq("id", entry.id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
  };

  return (
    <div className="container max-w-5xl py-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">What's New</h1>
          <p className="text-sm text-muted-foreground">
            Auto-drafted change journal. Approve drafts to publish. No more in-chat walkthroughs.
          </p>
        </div>
        <Button onClick={scan} disabled={scanning} size="sm">
          {scanning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Scan now
        </Button>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="drafts">
            Drafts {drafts.rows.length > 0 && <Badge className="ml-2" variant="secondary">{drafts.rows.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="published">Published</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="drafts" className="space-y-3 mt-4">
          {drafts.loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!drafts.loading && drafts.rows.length === 0 && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">
              No drafts. Hit "Scan now" or wait for the 30-min cron.
            </CardContent></Card>
          )}
          {drafts.rows.map((e) => (
            <EntryCard key={e.id} entry={e} mode="draft" onAction={(a, p) => handleAction(e, a, p)} />
          ))}
        </TabsContent>

        <TabsContent value="published" className="space-y-3 mt-4">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search published entries…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All areas</SelectItem>
                {AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {filteredPublished.map((e) => (
            <EntryCard key={e.id} entry={e} mode="published" onAction={(a, p) => handleAction(e, a, p)} />
          ))}
          {filteredPublished.length === 0 && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">Nothing matches.</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr><th className="text-left p-2">Kind</th><th className="text-left p-2">Ref</th><th className="text-left p-2">Entry</th><th className="text-left p-2">Seen</th><th className="text-left p-2">Dismissed</th></tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="p-2"><Badge variant="outline">{s.kind}</Badge></td>
                      <td className="p-2 font-mono text-xs truncate max-w-[280px]">{s.ref}</td>
                      <td className="p-2 text-xs text-muted-foreground">{s.entry_id ? "linked" : "—"}</td>
                      <td className="p-2 text-xs">{new Date(s.seen_at).toLocaleString("en-GB")}</td>
                      <td className="p-2">
                        <Button
                          size="sm" variant="ghost"
                          onClick={async () => {
                            await supabase.from("whats_new_sources").update({ dismissed: !s.dismissed }).eq("id", s.id);
                            void reloadSources();
                          }}
                        >
                          {s.dismissed ? "undismiss" : "dismiss"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
