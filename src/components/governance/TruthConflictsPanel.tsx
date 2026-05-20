// W7.2 — Truth conflicts triage panel.
// Lists rows from public.truth_conflicts (tied/near-tied competing claims)
// and deep-links each into ClaimsPanel via URL params so the operator can
// file a tie-breaking claim without copy-pasting UUIDs.
import { useEffect, useId, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, ArrowRight } from "lucide-react";
import { toast } from "sonner";

type Row = {
  entity: string;
  entity_id: string;
  field: string;
  top_source: string | null;
  top_score: number | null;
  next_source: string | null;
  next_score: number | null;
};

function gapPct(top: number | null, next: number | null) {
  if (!top || top <= 0 || next == null) return 0;
  return ((top - next) / top) * 100;
}

export function TruthConflictsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const channelId = useId();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("truth_conflicts" as never)
      .select("entity,entity_id,field,top_source,top_score,next_source,next_score");
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const sorted = ((data ?? []) as Row[]).sort((a, b) => {
      const ga = gapPct(a.top_score, a.next_score);
      const gb = gapPct(b.top_score, b.next_score);
      if (ga !== gb) return ga - gb;
      return a.entity.localeCompare(b.entity);
    });
    setRows(sorted);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`gov-conflicts-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "claims" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveHere = (r: Row) => {
    const params = new URLSearchParams(window.location.search);
    params.set("claim_entity", r.entity);
    params.set("claim_id", r.entity_id);
    params.set("claim_field", r.field);
    params.set("tiebreak", `${r.top_source ?? "?"}|${r.next_source ?? "?"}`);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    window.dispatchEvent(new CustomEvent("governance:claim-jump"));
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success("Copied");
  };

  const count = rows.length;
  const severity: "destructive" | "secondary" | "outline" =
    count >= 5 ? "destructive" : count >= 2 ? "secondary" : "outline";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            Unresolved truth conflicts
            <Badge variant={severity}>{count}</Badge>
          </span>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            No competing claims within 10%. Truth is unambiguous.
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => {
              const gap = gapPct(r.top_score, r.next_score);
              return (
                <li
                  key={`${r.entity}|${r.entity_id}|${r.field}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="font-mono text-sm">
                      {r.entity}.<span className="text-muted-foreground">{r.field}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono truncate max-w-[14rem]">
                        {r.entity_id}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => copy(r.entity_id)}
                        aria-label="Copy entity id"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className="font-mono">
                      {r.top_source} · {(r.top_score ?? 0).toFixed(2)}
                    </Badge>
                    <span className="text-muted-foreground">vs</span>
                    <Badge variant="outline" className="font-mono">
                      {r.next_source} · {(r.next_score ?? 0).toFixed(2)}
                    </Badge>
                    <span className="text-muted-foreground tabular-nums">
                      Δ {gap.toFixed(1)}%
                    </span>
                  </div>
                  <Button size="sm" variant="default" onClick={() => resolveHere(r)}>
                    Resolve <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
