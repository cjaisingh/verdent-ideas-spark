// Credits & Usage panel — manual ledger + token-derived proxy.
// Honest signal: manual = real credits; proxy = tokens × configurable rate.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AlertTriangle, Plus, Settings as SettingsIcon } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { AddCreditEntryDialog } from "./AddCreditEntryDialog";

type StepRow = {
  id: string;
  occurred_at: string;
  task_id: string | null;
  phase_id: string | null;
  step_label: string;
  source: "manual" | "proxy";
  credits: number;
  tokens_total: number | null;
  model: string | null;
  duration_ms: number | null;
  mode: string | null;
  note: string | null;
};

type PhaseRollup = {
  phase_id: string;
  phase_key: string;
  phase_title: string;
  manual_credits: number;
  proxy_credits: number;
  total_credits: number;
  manual_count: number;
  proxy_count: number;
};

type Settings = {
  proxy_rate_per_1k_tokens: number;
  monthly_budget_credits: number | null;
  alert_threshold_pct: number;
};

function fmtCredits(n: number): string {
  if (!n) return "0";
  if (n < 0.01) return n.toFixed(4);
  return n.toFixed(2);
}

export function CreditsUsagePanel() {
  const [steps, setSteps] = useState<StepRow[] | null>(null);
  const [phases, setPhases] = useState<PhaseRollup[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [s, p, cfg] = await Promise.all([
      supabase
        .from("v_credit_burn_per_step")
        .select("*")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .limit(1000),
      supabase.from("v_credit_burn_per_phase_30d").select("*"),
      supabase.from("credit_settings").select("*").eq("id", true).maybeSingle(),
    ]);
    if (s.error) toast.error(s.error.message);
    setSteps((s.data ?? []) as StepRow[]);
    setPhases((p.data ?? []) as PhaseRollup[]);
    if (cfg.data) {
      setSettings({
        proxy_rate_per_1k_tokens: Number(cfg.data.proxy_rate_per_1k_tokens),
        monthly_budget_credits: cfg.data.monthly_budget_credits,
        alert_threshold_pct: cfg.data.alert_threshold_pct,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Month-to-date totals
  const mtd = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    let manual = 0, proxy = 0;
    for (const r of steps ?? []) {
      if (r.occurred_at < start) continue;
      if (r.source === "manual") manual += Number(r.credits);
      else proxy += Number(r.credits);
    }
    return { manual, proxy, total: manual + proxy };
  }, [steps]);

  const budget = settings?.monthly_budget_credits ?? null;
  const burnPct = budget && budget > 0 ? (mtd.total / budget) * 100 : null;
  const overThreshold = burnPct !== null && settings && burnPct >= settings.alert_threshold_pct;

  // 30-day trend (per day, manual vs proxy)
  const trend = useMemo(() => {
    const m = new Map<string, { day: string; manual: number; proxy: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      m.set(d, { day: d, manual: 0, proxy: 0 });
    }
    for (const r of steps ?? []) {
      const day = r.occurred_at.slice(0, 10);
      const b = m.get(day);
      if (!b) continue;
      if (r.source === "manual") b.manual += Number(r.credits);
      else b.proxy += Number(r.credits);
    }
    return Array.from(m.values()).map((b) => ({
      day: b.day.slice(5),
      manual: Number(b.manual.toFixed(2)),
      proxy: Number(b.proxy.toFixed(2)),
    }));
  }, [steps]);

  return (
    <div className="space-y-6">
      {/* Honest banner */}
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
        <strong className="text-amber-600 dark:text-amber-400">Note:</strong>{" "}
        Lovable does not expose a credit-billing API. <em>Manual</em> rows are real credits you logged.
        <em> Proxy</em> rows are derived from work-log tokens × {fmtCredits(settings?.proxy_rate_per_1k_tokens ?? 0)} credits/1k tokens — a signal, not a real number.
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="MTD manual" value={fmtCredits(mtd.manual)} loading={loading} />
        <KpiCard label="MTD proxy" value={fmtCredits(mtd.proxy)} loading={loading} tone="muted" />
        <KpiCard label="MTD total" value={fmtCredits(mtd.total)} loading={loading} />
        <KpiCard
          label={budget ? `Budget ${budget}` : "Budget"}
          value={burnPct !== null ? `${burnPct.toFixed(0)}%` : "—"}
          loading={loading}
          tone={overThreshold ? "warn" : undefined}
          icon={overThreshold ? <AlertTriangle className="h-4 w-4" /> : undefined}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Log credits
        </Button>
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline">
              <SettingsIcon className="h-4 w-4 mr-2" /> Settings
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader><SheetTitle>Credits settings</SheetTitle></SheetHeader>
            <SettingsForm settings={settings} onSaved={() => { setSettingsOpen(false); load(); }} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader><CardTitle className="text-base">30-day trend</CardTitle></CardHeader>
        <CardContent className="h-[260px]">
          {loading && !steps ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Line type="monotone" dataKey="manual" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="proxy" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-phase rollup */}
      <Card>
        <CardHeader><CardTitle className="text-base">Top phases (30 days)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phase</TableHead>
                <TableHead className="text-right">Manual</TableHead>
                <TableHead className="text-right">Proxy</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(phases ?? []).length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No phase activity yet.</TableCell></TableRow>
              )}
              {(phases ?? []).map((p) => (
                <TableRow key={p.phase_id}>
                  <TableCell>
                    <div className="font-medium">{p.phase_title}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.phase_key}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCredits(Number(p.manual_credits))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmtCredits(Number(p.proxy_credits))}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{fmtCredits(Number(p.total_credits))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Per-step table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per build step ({(steps ?? []).length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">When</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead>Model</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(steps ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nothing in the last 30 days.</TableCell></TableRow>
              )}
              {(steps ?? []).slice(0, 200).map((r) => (
                <TableRow key={`${r.source}-${r.id}`}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.occurred_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate">{r.step_label}</TableCell>
                  <TableCell>
                    <Badge variant={r.source === "manual" ? "default" : "secondary"} className="text-[10px]">
                      {r.source}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCredits(Number(r.credits))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.tokens_total?.toLocaleString() ?? "—"}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{r.model ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(steps ?? []).length > 200 && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-t">
              Showing first 200 of {(steps ?? []).length}.
            </div>
          )}
        </CardContent>
      </Card>

      <AddCreditEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={load} />
    </div>
  );
}

function KpiCard({
  label, value, loading, tone, icon,
}: { label: string; value: string; loading?: boolean; tone?: "warn" | "muted"; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "warn" ? "text-amber-500" : tone === "muted" ? "text-muted-foreground" : ""
        }`}>
          {loading ? <Skeleton className="h-7 w-20" /> : value}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsForm({ settings, onSaved }: { settings: Settings | null; onSaved: () => void }) {
  const [rate, setRate] = useState(settings?.proxy_rate_per_1k_tokens.toString() ?? "0.05");
  const [budget, setBudget] = useState(settings?.monthly_budget_credits?.toString() ?? "");
  const [threshold, setThreshold] = useState(settings?.alert_threshold_pct.toString() ?? "80");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setRate(settings.proxy_rate_per_1k_tokens.toString());
    setBudget(settings.monthly_budget_credits?.toString() ?? "");
    setThreshold(settings.alert_threshold_pct.toString());
  }, [settings]);

  async function save() {
    const r = Number(rate);
    const b = budget.trim() === "" ? null : Number(budget);
    const t = Number(threshold);
    if (!Number.isFinite(r) || r < 0) return toast.error("Rate must be ≥ 0");
    if (b !== null && (!Number.isFinite(b) || b < 0)) return toast.error("Budget must be ≥ 0 or empty");
    if (!Number.isFinite(t) || t < 1 || t > 100) return toast.error("Threshold 1–100");
    setSaving(true);
    const { error } = await supabase
      .from("credit_settings")
      .update({
        proxy_rate_per_1k_tokens: r,
        monthly_budget_credits: b,
        alert_threshold_pct: t,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
    onSaved();
  }

  return (
    <div className="space-y-4 mt-4">
      <div>
        <Label>Proxy rate (credits per 1k tokens)</Label>
        <Input type="number" step="0.001" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
        <p className="text-xs text-muted-foreground mt-1">Set to 0 to hide the proxy series entirely.</p>
      </div>
      <div>
        <Label>Monthly budget (credits)</Label>
        <Input type="number" step="1" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Leave blank for no budget" />
      </div>
      <div>
        <Label>Alert threshold (%)</Label>
        <Input type="number" step="1" min="1" max="100" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
      </div>
      <Button onClick={save} disabled={saving} className="w-full">{saving ? "Saving…" : "Save"}</Button>
    </div>
  );
}
