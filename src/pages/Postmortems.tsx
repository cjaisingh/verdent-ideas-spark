import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PostmortemDrawer, type PostmortemRow } from "@/components/postmortems/PostmortemDrawer";
import { toast } from "sonner";

type Filter = "draft" | "reviewed" | "all";

export default function Postmortems() {
  const [rows, setRows] = useState<PostmortemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("draft");
  const [selected, setSelected] = useState<PostmortemRow | null>(null);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    setLoading(true);
    const q = supabase.from("postmortems").select("*").order("created_at", { ascending: false });
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as unknown as PostmortemRow[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`postmortems-page-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "postmortems" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(
    () => filter === "all" ? rows : rows.filter((r) => r.status === filter),
    [rows, filter],
  );

  const draftCount = rows.filter((r) => r.status === "draft").length;

  const runNow = async () => {
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke("postmortem-generate", { body: {} });
    setGenerating(false);
    if (error) { toast.error(error.message); return; }
    const d = data as { drafted?: number; skipped?: number; candidates?: number };
    toast.success(`Generated: ${d?.drafted ?? 0} new, ${d?.skipped ?? 0} skipped, ${d?.candidates ?? 0} candidates`);
    load();
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Postmortems</h1>
          <p className="text-sm text-muted-foreground">
            AI-drafted reports for phases/sprints that passed their planned end date. Prose only — no enforcement.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runNow} disabled={generating}>
            {generating ? "Generating…" : "Generate now"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {filter === "draft" ? "Unreviewed drafts" : filter === "reviewed" ? "Reviewed" : "All"}
            <span className="ml-2 text-muted-foreground text-sm">({filtered.length})</span>
          </CardTitle>
          <div className="flex gap-1">
            {(["draft","reviewed","all"] as Filter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "ghost"}
                onClick={() => setFilter(f)}
              >
                {f}{f === "draft" && draftCount > 0 ? ` (${draftCount})` : ""}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No postmortems{filter !== "all" ? ` in '${filter}'` : ""}. Daily generator runs at 06:30 UTC.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Slipped</TableHead>
                  <TableHead>Days late</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => { setSelected(r); setOpen(true); }}
                  >
                    <TableCell className="font-medium">{r.subject_label}</TableCell>
                    <TableCell><Badge variant="outline">{r.subject_kind}</Badge></TableCell>
                    <TableCell>{r.slipped_on}</TableCell>
                    <TableCell>{r.days_late}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "draft" ? "default" : "secondary"}>{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PostmortemDrawer
        row={selected}
        open={open}
        onOpenChange={setOpen}
        onChanged={load}
      />
    </div>
  );
}
