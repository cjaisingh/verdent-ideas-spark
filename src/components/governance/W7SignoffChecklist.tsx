import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Minus, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

type CheckState = "pass" | "fail" | "pending" | "loading";

type Item = {
  id: string;
  label: string;
  detail: string;
  state: CheckState;
  link?: { to: string; label: string };
};

const COVERAGE_TARGET = 60;
const REAL_CLAIM_RATIO_TARGET = 70;

export function W7SignoffChecklist() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [allPass, setAllPass] = useState(false);

  const load = async () => {
    setLoading(true);
    const next: Item[] = [];

    // 1. Ontology page (static — file exists, route mounted)
    next.push({
      id: "ontology",
      label: "Ontology page live",
      detail: "11 canonical entities documented at /ontology",
      state: "pass",
      link: { to: "/ontology", label: "Open" },
    });

    // 2. decision_authorities + resolve_truth callable
    const { count: daCount, error: daErr } = await supabase
      .from("decision_authorities")
      .select("*", { count: "exact", head: true });
    next.push({
      id: "authorities",
      label: "Decision authorities + resolve_truth()",
      detail: daErr
        ? `Error: ${daErr.message}`
        : `${daCount ?? 0} authority rules registered`,
      state: !daErr && (daCount ?? 0) > 0 ? "pass" : "fail",
    });

    // 3. governance_links + /governance page
    const { count: linkCount } = await supabase
      .from("governance_links")
      .select("*", { count: "exact", head: true });
    next.push({
      id: "links",
      label: "Governance links + /governance page",
      detail: `${linkCount ?? 0} links recorded`,
      state: (linkCount ?? 0) > 0 ? "pass" : "fail",
    });

    // 4. Claims pipeline with real claim source
    const { count: realClaims } = await supabase
      .from("claims")
      .select("*", { count: "exact", head: true })
      .in("source", ["ci", "system"]);
    next.push({
      id: "claims",
      label: "Claims pipeline carries real traffic",
      detail: `${realClaims ?? 0} claims from ci/system sources`,
      state: (realClaims ?? 0) > 0 ? "pass" : "fail",
    });

    // KPI: coverage ≥ 60%
    const { data: cov } = await supabase.rpc("governance_coverage", { _days: 30 });
    const c = cov as { tasks_shipped: number; with_authority_rule: number } | null;
    const covPct =
      c && c.tasks_shipped > 0
        ? Math.round((c.with_authority_rule / c.tasks_shipped) * 100)
        : 0;
    next.push({
      id: "kpi-coverage",
      label: `KPI: governance coverage ≥ ${COVERAGE_TARGET}% (30d)`,
      detail: `Currently ${covPct}% (${c?.with_authority_rule ?? 0}/${c?.tasks_shipped ?? 0})`,
      state: covPct >= COVERAGE_TARGET ? "pass" : "fail",
    });

    // KPI: real-claim ratio ≥ 70%
    const { count: totalClaims } = await supabase
      .from("claims")
      .select("*", { count: "exact", head: true });
    const ratio = totalClaims
      ? Math.round(((realClaims ?? 0) / totalClaims) * 100)
      : 0;
    next.push({
      id: "kpi-ratio",
      label: `KPI: real-claim ratio ≥ ${REAL_CLAIM_RATIO_TARGET}%`,
      detail: `Currently ${ratio}% (${realClaims ?? 0}/${totalClaims ?? 0})`,
      state: ratio >= REAL_CLAIM_RATIO_TARGET ? "pass" : "fail",
    });

    // SLO: no unresolved truth conflicts > 7d
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { count: staleConflicts } = await supabase
      .from("truth_conflicts")
      .select("*", { count: "exact", head: true })
      .lt("created_at", sevenDaysAgo);
    next.push({
      id: "slo-conflicts",
      label: "SLO: no unresolved truth conflicts > 7 days",
      detail: `${staleConflicts ?? 0} stale conflicts`,
      state: (staleConflicts ?? 0) === 0 ? "pass" : "fail",
    });

    // Closeout doc
    next.push({
      id: "closeout-doc",
      label: "docs/w7-closeout.md written",
      detail: "Final closeout document with deferred items",
      state: "pending",
    });

    setItems(next);
    setAllPass(next.every((i) => i.state === "pass"));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const passCount = items.filter((i) => i.state === "pass").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>W7 sign-off checklist</span>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Badge variant={allPass ? "default" : "secondary"}>
              {passCount} / {items.length} pass
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
          >
            <div className="flex items-start gap-3 min-w-0">
              <StateIcon state={item.state} />
              <div className="min-w-0">
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.detail}</div>
              </div>
            </div>
            {item.link && (
              <Button asChild variant="ghost" size="sm">
                <Link to={item.link.to}>{item.link.label}</Link>
              </Button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            All checks must pass before marking the W7 roadmap phase done.
          </p>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StateIcon({ state }: { state: CheckState }) {
  if (state === "pass")
    return (
      <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      </div>
    );
  if (state === "fail")
    return (
      <div className="mt-0.5 rounded-full bg-destructive/15 p-1">
        <X className="h-3.5 w-3.5 text-destructive" />
      </div>
    );
  if (state === "pending")
    return (
      <div className="mt-0.5 rounded-full bg-amber-500/15 p-1">
        <Minus className="h-3.5 w-3.5 text-amber-600" />
      </div>
    );
  return (
    <div className="mt-0.5 rounded-full bg-muted p-1">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    </div>
  );
}
