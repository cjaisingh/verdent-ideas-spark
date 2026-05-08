import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, FileSearch } from "lucide-react";
import PromotionAuditDrawer from "@/components/promotion/PromotionAuditDrawer";

type ProposalSummary = {
  id: string;
  shift_id: string;
  status: string;
  rationale: string | null;
  target_ref: any;
  payload: any;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
};

const decisionTone = (d: string) =>
  d === "accepted" ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
  : d === "rejected" ? "text-destructive border-destructive/30 bg-destructive/10"
  : "text-muted-foreground border-border bg-muted/20";

const fmt = (iso: string | null) =>
  !iso ? "—" : new Date(iso).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function PromotionAudits() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ProposalSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [decision, setDecision] = useState<"all" | "accepted" | "rejected" | "pending">("accepted");
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("night_proposals" as any)
        .select("id, shift_id, status, rationale, target_ref, payload, decided_at, decided_by, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      setRows((data as any) ?? []);
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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (decision !== "all" && r.status !== decision) return false;
      if (!q) return true;
      const blob = `${r.target_ref?.short_num ?? ""} ${r.rationale ?? ""} ${r.decided_by ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, filter, decision]);

  if (isAdmin === null) return <div className="text-sm text-muted-foreground p-6">Checking permissions…</div>;
  if (!isAdmin) {
    return (
      <div className="border border-destructive/50 rounded-md p-6 m-6">
        <h1 className="text-lg font-semibold mb-1">Admin only</h1>
        <p className="text-sm text-muted-foreground">
          You need the <code className="font-mono">admin</code> role to view promotion audits.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileSearch className="h-5 w-5" /> Promotion audits
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Before/after report for every operator-confirmed Night Agent promotion — gates, skip
            reasons, and the candidates that were considered.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter by short num, rationale, decider…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
          value={decision}
          onChange={(e) => setDecision(e.target.value as any)}
        >
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="pending">Pending</option>
          <option value="all">All decisions</option>
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
      </div>

      <div className="rounded-md border border-border divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No proposals match.</div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => setActiveId(r.id)}
              className="w-full text-left p-3 hover:bg-muted/40 flex items-center gap-3 text-sm"
            >
              <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${decisionTone(r.status)}`}>
                {r.status}
              </span>
              <span className="font-mono text-muted-foreground shrink-0">#{r.target_ref?.short_num ?? "?"}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate">{r.rationale ?? "—"}</span>
                <span className="block text-[10px] text-muted-foreground font-mono mt-0.5">
                  decided {fmt(r.decided_at)}{r.decided_by ? ` · ${r.decided_by}` : ""}
                </span>
              </span>
              {r.payload?.worst_severity && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  worst: {r.payload.worst_severity}
                </Badge>
              )}
            </button>
          ))
        )}
      </div>

      <PromotionAuditDrawer
        proposalId={activeId}
        onOpenChange={(o) => !o && setActiveId(null)}
      />
    </div>
  );
}
