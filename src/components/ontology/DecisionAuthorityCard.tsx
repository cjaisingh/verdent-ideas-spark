import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Rule = {
  entity: string;
  field: string;
  source: string;
  precedence: number;
  weight: number;
  override_policy: "hard" | "operator_only" | "soft";
  notes: string | null;
};

const policyTone: Record<Rule["override_policy"], string> = {
  hard: "destructive",
  operator_only: "default",
  soft: "secondary",
};

export function DecisionAuthorityCard() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("decision_authorities")
        .select("entity,field,source,precedence,weight,override_policy,notes")
        .order("entity", { ascending: true })
        .order("precedence", { ascending: true });
      if (cancelled) return;
      if (error) setError(error.message);
      else setRules((data ?? []) as Rule[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Group by entity
  const grouped: Record<string, Rule[]> = {};
  (rules ?? []).forEach((r) => {
    (grouped[r.entity] ||= []).push(r);
  });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Decision authority
          <Badge variant="outline" className="font-normal">
            v0 · rules only
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Per entity, who wins when sources disagree. Lower precedence wins. Rules ship as
          seed rows; change via migration + CHANGELOG (see <code>docs/decision-authority.md</code>).
          Claims pipeline lands in W7.2.
        </p>
      </CardHeader>
      <CardContent>
        {error && <div className="text-sm text-destructive">Failed to load rules: {error}</div>}
        {!error && rules === null && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {!error && rules?.length === 0 && (
          <div className="text-sm text-muted-foreground">No rules seeded.</div>
        )}
        <div className="space-y-4">
          {Object.entries(grouped).map(([entity, list]) => (
            <div key={entity}>
              <div className="text-sm font-semibold mb-1 flex items-center justify-between">
                <span>{entity}</span>
                <a
                  href={`/governance?kind=entity&ref=${encodeURIComponent(entity)}`}
                  className="text-xs text-primary hover:underline font-normal"
                >
                  View governance chain →
                </a>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-3 font-normal">#</th>
                      <th className="py-1 pr-3 font-normal">Source</th>
                      <th className="py-1 pr-3 font-normal">Field</th>
                      <th className="py-1 pr-3 font-normal">Weight</th>
                      <th className="py-1 pr-3 font-normal">Override</th>
                      <th className="py-1 pr-3 font-normal">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="py-1 pr-3 font-mono">{r.precedence}</td>
                        <td className="py-1 pr-3 font-mono">{r.source}</td>
                        <td className="py-1 pr-3 font-mono">{r.field}</td>
                        <td className="py-1 pr-3 font-mono">{Number(r.weight).toFixed(2)}</td>
                        <td className="py-1 pr-3">
                          <Badge
                            variant={policyTone[r.override_policy] as never}
                            className="text-[10px]"
                          >
                            {r.override_policy}
                          </Badge>
                        </td>
                        <td className="py-1 pr-3 text-muted-foreground">{r.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
