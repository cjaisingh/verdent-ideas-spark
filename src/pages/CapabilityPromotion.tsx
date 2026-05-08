import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { PromotionGateRow } from "@/components/promotion/PromotionGateRow";
import { PromoteDialog } from "@/components/promotion/PromoteDialog";
import { VerdictPill } from "@/components/promotion/VerdictPill";
import type { CapabilityPromotionStatus, PromotionStatusResponse } from "@/lib/promotion-gates-types";

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;

const callApi = async (path: string, init?: RequestInit) => {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  return fetch(`${FN}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
  });
};

const CapabilityPromotion = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [resp, setResp] = useState<PromotionStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [promoteTarget, setPromoteTarget] = useState<CapabilityPromotionStatus | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await callApi("/capabilities/promotion-status");
      const j = await r.json();
      if (!r.ok) {
        toast({ title: "Failed", description: j.error ?? `HTTP ${r.status}`, variant: "destructive" });
      } else {
        setResp(j as PromotionStatusResponse);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); return; }
      const { data } = await supabase.from("user_roles")
        .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      const ok = !!data;
      setIsAdmin(ok);
      if (ok) refresh();
    })();
  }, []);

  const modules = useMemo(() => {
    const set = new Set<string>();
    resp?.capabilities.forEach((c) => c.capability.owning_module && set.add(c.capability.owning_module));
    return Array.from(set).sort();
  }, [resp]);

  const filtered = useMemo(() => {
    if (!resp) return [];
    const q = filter.trim().toLowerCase();
    return resp.capabilities.filter((c) => {
      if (onlyBlocked && c.summary.promotable) return false;
      if (moduleFilter !== "all" && c.capability.owning_module !== moduleFilter) return false;
      if (!q) return true;
      return c.capability.id.toLowerCase().includes(q) || (c.capability.name ?? "").toLowerCase().includes(q);
    });
  }, [resp, filter, moduleFilter, onlyBlocked]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const promote = async (rationale: string) => {
    if (!promoteTarget) return;
    const r = await callApi(`/capabilities/${encodeURIComponent(promoteTarget.capability.id)}/promote`, {
      method: "POST",
      body: JSON.stringify({ ack_rationale: rationale || null }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast({ title: "Promotion failed", description: j.error ?? `HTTP ${r.status}`, variant: "destructive" });
    } else {
      toast({ title: "Promoted", description: `${promoteTarget.capability.id} → available` });
      setPromoteTarget(null);
      refresh();
    }
  };

  const ackWarnings = async (cap: CapabilityPromotionStatus) => {
    const rationale = window.prompt("Reason for acknowledging the warnings?");
    if (!rationale?.trim()) return;
    const gateKeys = cap.gates.filter((g) => g.verdict === "warn").map((g) => g.key);
    const r = await callApi(`/capabilities/${encodeURIComponent(cap.capability.id)}/ack-warnings`, {
      method: "POST",
      body: JSON.stringify({ rationale, gate_keys: gateKeys }),
    });
    const j = await r.json();
    if (!r.ok) toast({ title: "Ack failed", description: j.error ?? `HTTP ${r.status}`, variant: "destructive" });
    else { toast({ title: "Warnings acknowledged" }); refresh(); }
  };

  if (isAdmin === null) return <div className="text-sm text-muted-foreground">Checking permissions…</div>;
  if (!isAdmin) {
    return (
      <div className="border border-destructive/50 rounded-md p-6">
        <h1 className="text-lg font-semibold mb-1">Admin only</h1>
        <p className="text-sm text-muted-foreground">
          You need the <code className="font-mono">admin</code> role to view capability promotion status.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Capability promotion</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-capability Phase-3 maturity gates. Promote when no gate fails.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {resp && (
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Total" value={resp.summary.total} />
          <Stat label="Promotable" value={resp.summary.promotable} highlight />
          <Stat label="Blocked" value={resp.summary.blocked} />
          <Stat label="Already available" value={resp.summary.already_available} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter by id or name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
        >
          <option value="all">All modules</option>
          {modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyBlocked} onCheckedChange={(v) => setOnlyBlocked(!!v)} />
          Show only blocked
        </label>
      </div>

      <div className="border border-border rounded-md divide-y divide-border">
        {filtered.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No capabilities match.</div>
        )}
        {filtered.map((c) => {
          const open = expanded.has(c.capability.id);
          const topBlock = c.gates.find((g) => g.verdict === "fail") ?? c.gates.find((g) => g.verdict === "warn");
          const alreadyAvailable = c.capability.status === "available";
          return (
            <div key={c.capability.id} className="text-sm">
              <button
                onClick={() => toggle(c.capability.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 text-left"
              >
                {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.capability.name ?? c.capability.id}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{c.capability.status}</Badge>
                    {c.capability.owning_module && (
                      <span className="text-xs font-mono text-muted-foreground">{c.capability.owning_module}</span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground truncate">{c.capability.id}</div>
                  {topBlock && !open && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {topBlock.reason}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {c.summary.fail > 0 && <VerdictPill verdict="fail">{c.summary.fail} fail</VerdictPill>}
                  {c.summary.warn > 0 && <VerdictPill verdict="warn">{c.summary.warn} warn</VerdictPill>}
                  {c.summary.fail === 0 && c.summary.warn === 0 && <VerdictPill verdict="pass">all pass</VerdictPill>}
                </div>
              </button>
              {open && (
                <div className="px-3 pb-3 pl-10 space-y-1">
                  <div className="border border-border rounded-md p-3 bg-muted/10">
                    {c.gates.map((g) => <PromotionGateRow key={g.key} gate={g} />)}
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      size="sm"
                      disabled={!c.summary.promotable || alreadyAvailable}
                      onClick={() => setPromoteTarget(c)}
                    >
                      Promote to available
                    </Button>
                    {c.summary.warn > 0 && !alreadyAvailable && (
                      <Button size="sm" variant="outline" onClick={() => ackWarnings(c)}>
                        Acknowledge warnings
                      </Button>
                    )}
                    <Link to={`/capabilities/${encodeURIComponent(c.capability.id)}`}
                      className="text-xs text-muted-foreground hover:text-foreground ml-auto">
                      View capability →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <PromoteDialog
        open={!!promoteTarget}
        onOpenChange={(v) => !v && setPromoteTarget(null)}
        status={promoteTarget}
        onConfirm={promote}
      />
    </div>
  );
};

const Stat = ({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) => (
  <div className="border border-border rounded-md p-4">
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={`text-3xl font-semibold tabular-nums mt-1 ${highlight ? "text-primary" : ""}`}>{value}</div>
  </div>
);

export default CapabilityPromotion;
