// Persistent banner on /admin/ai-usage for unacknowledged credit_alerts rows.
// Shows most severe alert (100% beats 80%) for the current calendar month.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, OctagonAlert, X } from "lucide-react";
import { toast } from "sonner";

type Alert = {
  id: string;
  year_month: string;
  threshold_pct: number;
  projected_pct: number;
  burn_per_day: number;
  budget: number;
  fired_at: string;
  acknowledged_at: string | null;
};

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function BudgetAlertBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  async function load() {
    const { data } = await supabase
      .from("credit_alerts")
      .select("id,year_month,threshold_pct,projected_pct,burn_per_day,budget,fired_at,acknowledged_at")
      .eq("year_month", currentYearMonth())
      .is("acknowledged_at", null)
      .order("threshold_pct", { ascending: false });
    setAlerts((data ?? []) as Alert[]);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin_credit_alerts_banner")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "credit_alerts" },
        (payload) => {
          load();
          if (payload.eventType === "INSERT") {
            const row = payload.new as Alert;
            if (row.threshold_pct === 100) {
              toast.error(`Projected spend hit 100% of budget (${row.projected_pct.toFixed(0)}%).`);
            } else {
              toast.warning(`Projected spend hit 80% of budget (${row.projected_pct.toFixed(0)}%).`);
            }
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function dismiss(id: string) {
    const { error } = await supabase
      .from("credit_alerts")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else load();
  }

  if (alerts.length === 0) return null;

  // Most severe first (100 > 80).
  const top = alerts[0];
  const isCritical = top.threshold_pct === 100;

  return (
    <Alert variant={isCritical ? "destructive" : "default"} className={isCritical ? "" : "border-amber-500/40 bg-amber-500/5"}>
      {isCritical ? <OctagonAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
      <div className="flex items-start justify-between gap-4 w-full">
        <div className="flex-1">
          <AlertTitle>
            Projected month-end spend at {top.projected_pct.toFixed(0)}% of budget
            {isCritical ? " — you will overspend" : ""}
          </AlertTitle>
          <AlertDescription>
            Burn rate {top.burn_per_day.toFixed(1)} credits/day · budget {top.budget} · month {top.year_month}.
            {isCritical
              ? " Consider switching to Claude Max (£200 flat) or pausing Lovable until next cycle."
              : " Heads-up: at this pace you'll hit the budget before month-end."}
          </AlertDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => dismiss(top.id)} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Alert>
  );
}
