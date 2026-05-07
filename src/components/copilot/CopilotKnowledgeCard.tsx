import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Search } from "lucide-react";
import { toast } from "sonner";

type Hit = {
  chunk_id: string;
  doc_id: string;
  path: string;
  title: string;
  heading: string | null;
  content: string;
  rank: number;
};

export function CopilotKnowledgeCard() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ docs: number; chunks: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ count: d }, { count: c }] = await Promise.all([
        supabase.from("awip_docs").select("*", { count: "exact", head: true }),
        supabase.from("awip_doc_chunks").select("*", { count: "exact", head: true }),
      ]);
      setStats({ docs: d ?? 0, chunks: c ?? 0 });
    })();
  }, [hits]);

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("awip-rag/search", {
        body: { q, limit: 6 },
      });
      if (error) throw error;
      setHits((data?.results ?? []) as Hit[]);
    } catch (e: any) {
      toast.error(e.message ?? "Search failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <BookOpen className="size-4" /> Knowledge base
          </span>
          {stats && (
            <span className="text-xs font-normal text-muted-foreground">
              {stats.docs} docs · {stats.chunks} chunks
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          onSubmit={(e) => { e.preventDefault(); run(); }}
          className="flex gap-2"
        >
          <Input
            placeholder="Ask the AWIP knowledge base…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit" disabled={busy || !q.trim()}>
            <Search className="size-4 mr-1" /> {busy ? "…" : "Search"}
          </Button>
        </form>

        {hits.length > 0 && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {hits.map((h) => (
              <div key={h.chunk_id} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate">{h.title}</div>
                  <Badge variant="outline" className="text-[10px]">{h.rank.toFixed(3)}</Badge>
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {h.path}{h.heading ? ` › ${h.heading}` : ""}
                </div>
                <div className="text-xs whitespace-pre-wrap line-clamp-6">{h.content}</div>
              </div>
            ))}
          </div>
        )}

        {hits.length === 0 && stats?.docs === 0 && (
          <p className="text-xs text-muted-foreground">
            Knowledge base is empty. Run <code>bun scripts/ingest-awip-docs.ts</code> with{" "}
            <code>AWIP_SERVICE_TOKEN</code> set to populate it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
