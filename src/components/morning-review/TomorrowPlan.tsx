import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCcw, ExternalLink, Circle, Sparkles } from "lucide-react";
import {
  fetchActivePlan,
  isItemDone,
  sourceLink,
  type Plan,
  type PlanBlock,
  type PlanItem,
} from "@/lib/tomorrowPlan";

export default function TomorrowPlan() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [blocks, setBlocks] = useState<PlanBlock[]>([]);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetchActivePlan();
    setPlan(r.plan);
    setBlocks(r.blocks);
    setItems(r.items);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("tomorrow-plan-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tomorrow_plan_items" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tomorrow_plans" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const refresh = async () => {
    if (!plan) return;
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("tomorrow-plan-refresh", {
        body: { plan_id: plan.id },
      });
      if (error) throw error;
      toast.success("Plan refreshed from live data.");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const toggleManual = async (item: PlanItem, next: boolean) => {
    const { error } = await supabase
      .from("tomorrow_plan_items")
      .update({ manual_done: next })
      .eq("id", item.id);
    if (error) toast.error(error.message);
  };

  const archive = async () => {
    if (!plan) return;
    const { error } = await supabase
      .from("tomorrow_plans")
      .update({ status: "archived" })
      .eq("id", plan.id);
    if (error) toast.error(error.message);
    else toast.success("Plan archived.");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading plan…
      </div>
    );
  }

  if (!plan) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <Sparkles className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">No active plan yet.</p>
          <p className="text-xs text-muted-foreground">
            Insert a row into <code>tomorrow_plans</code> with status <code>active</code> to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalItems = items.length;
  const doneItems = items.filter(isItemDone).length;
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
  const crits = plan.success_criteria ?? [];
  const critsDone = crits.filter((c) => c.met).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{plan.title || "Tomorrow Plan"} · {plan.plan_date}</h2>
          {plan.notes && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{plan.notes}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{doneItems}/{totalItems} done · {pct}%</Badge>
          <Button onClick={refresh} disabled={refreshing} size="sm" variant="outline">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
            Refresh from live data
          </Button>
          {plan.status === "active" && (
            <Button onClick={archive} size="sm" variant="ghost">Mark complete</Button>
          )}
        </div>
      </div>

      <Progress value={pct} className="h-1.5" />

      <div className="space-y-4">
        {blocks.map((b) => {
          const blockItems = items.filter((i) => i.block_id === b.id);
          const blockDone = blockItems.filter(isItemDone).length;
          return (
            <Card key={b.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base">{b.title}</CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {b.est_minutes != null && <span>≈ {b.est_minutes}m</span>}
                    <Badge variant="secondary">{blockDone}/{blockItems.length}</Badge>
                  </div>
                </div>
                {b.summary && <p className="text-xs text-muted-foreground">{b.summary}</p>}
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {blockItems.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No items.</p>
                )}
                {blockItems.map((i) => (
                  <ItemRow key={i.id} item={i} onToggle={(v) => toggleManual(i, v)} />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Success criteria</CardTitle>
            <Badge variant="secondary">{critsDone}/{crits.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {crits.length === 0 ? (
            <p className="text-sm text-muted-foreground">None defined.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {crits.map((c, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  {c.met ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className={c.met ? "line-through text-muted-foreground" : ""}>{c.label}</div>
                    {c.source_ref && (
                      <div className="text-xs text-muted-foreground">
                        {c.source_kind} · {c.source_ref}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ItemRow({ item, onToggle }: { item: PlanItem; onToggle: (v: boolean) => void }) {
  const done = isItemDone(item);
  const auto = item.auto_done === true;
  const link = sourceLink(item.source_kind, item.source_ref);

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0">
      <Checkbox
        checked={item.manual_done}
        onCheckedChange={(v) => onToggle(Boolean(v))}
        className="mt-0.5"
        aria-label="Mark item complete"
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${done ? "line-through text-muted-foreground" : ""}`}>
          {item.label}
        </div>
        {item.detail && <div className="text-xs text-muted-foreground mt-0.5">{item.detail}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {auto && !item.manual_done && (
          <Badge variant="outline" className="text-[10px]">auto</Badge>
        )}
        {item.source_kind !== "manual" && (
          <Badge variant="secondary" className="text-[10px]">{item.source_kind.replace("_", " ")}</Badge>
        )}
        {link && (
          <Button asChild size="icon" variant="ghost" className="h-6 w-6">
            <Link to={link} aria-label="Open source"><ExternalLink className="h-3 w-3" /></Link>
          </Button>
        )}
      </div>
    </div>
  );
}
