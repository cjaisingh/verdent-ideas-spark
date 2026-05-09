import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, RefreshCcw, BookOpen, ArrowLeft } from "lucide-react";

type Lesson = {
  id: string;
  category: string;
  severity: string;
  title: string;
  recommendation: string;
  evidence: any[];
  status: "proposed" | "applied" | "deferred" | "rejected" | "reopened";
  created_at: string;
  updated_at: string;
  source_window_start: string | null;
  source_window_end: string | null;
};

const STATUSES = ["proposed", "applied", "deferred", "rejected"] as const;
const sevColor: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/80 text-destructive-foreground",
  medium: "bg-amber-500 text-white",
  low: "bg-muted text-muted-foreground",
};

export default function LessonsLoop() {
  const [rows, setRows] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<typeof STATUSES[number]>("proposed");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("lessons")
      .select("*").order("created_at", { ascending: false }).limit(200);
    setRows((data as Lesson[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("lessons-loop")
      .on("postgres_changes", { event: "*", schema: "public", table: "lessons" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((r) => r.status === tab)
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.recommendation.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  }, [rows, tab, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const runSynthesis = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("lessons-synthesize", { body: {} });
      if (error) throw error;
      toast.success(`Synthesis complete: +${data?.inserted ?? 0} / ~${data?.updated ?? 0}`);
      load();
    } catch (e: any) { toast.error(e.message ?? "failed"); }
    finally { setRunning(false); }
  };

  const updateStatus = async (l: Lesson, status: Lesson["status"]) => {
    const patch: any = { status };
    if (status === "applied") { patch.applied_at = new Date().toISOString(); }
    const { error } = await supabase.from("lessons").update(patch).eq("id", l.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("lesson_events").insert({
      lesson_id: l.id, event_type: `status:${status}`,
      actor_label: "operator", payload: { from: l.status, to: status },
    });
    toast.success(`Marked ${status}`);
    load();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><BookOpen className="h-5 w-5" /> Lessons Loop</h1>
          <p className="text-sm text-muted-foreground">
            Weekly AI synthesis of operational signals into durable rules.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/morning-review"><ArrowLeft className="h-4 w-4 mr-1" /> Morning Review</Link>
          </Button>
          <Button onClick={runSynthesis} disabled={running} size="sm">
            {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
            Synthesize now
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>{s} ({counts[s] ?? 0})</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Input placeholder="Search title, category, recommendation…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />

      {loading ? (
        <div className="text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-8 text-sm text-muted-foreground text-center">No {tab} lessons.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((l) => (
            <Card key={l.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base">{l.title}</CardTitle>
                  <div className="flex gap-2 items-center">
                    <Badge className={sevColor[l.severity] ?? "bg-muted"}>{l.severity}</Badge>
                    <Badge variant="outline">{l.category}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{l.recommendation}</p>
                {l.evidence?.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{l.evidence.length} evidence ref(s)</summary>
                    <pre className="bg-muted/40 p-2 rounded mt-2 overflow-x-auto">{JSON.stringify(l.evidence, null, 2)}</pre>
                  </details>
                )}
                {tab === "proposed" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateStatus(l, "applied")}>Apply</Button>
                    <Button size="sm" variant="outline" onClick={() => updateStatus(l, "deferred")}>Defer</Button>
                    <Button size="sm" variant="ghost" onClick={() => updateStatus(l, "rejected")}>Reject</Button>
                  </div>
                )}
                {tab !== "proposed" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateStatus(l, "proposed")}>Reopen</Button>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  Created {new Date(l.created_at).toLocaleString()}
                  {l.source_window_start && ` · window ${l.source_window_start.slice(0, 10)} → ${l.source_window_end?.slice(0, 10)}`}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
