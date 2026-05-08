import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type DemandRow = {
  id: string;
  name: string;
  status: string;
  owning_module: string | null;
  tenant_ids: string[];
  tenant_count: number;
  kr_count: number;
  active_kr_count: number;
};

type Tenant = { id: string; slug: string; name: string };
type SortKey = "active_kr_count" | "tenant_count" | "kr_count" | "name" | "status";
type SortDir = "asc" | "desc";
type PageSize = 50 | 200 | "all";

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const statusVariant = (s: string) => {
  if (s === "available") return "default" as const;
  if (s === "planned") return "secondary" as const;
  if (s === "unknown") return "destructive" as const;
  return "outline" as const;
};

const DemandTable = ({ paused, onError }: { paused: boolean; onError?: (msg: string) => void }) => {
  const [demand, setDemand] = useState<DemandRow[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [minActive, setMinActive] = useState<string>("0");
  const [sortKey, setSortKey] = useState<SortKey>("active_kr_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [pageSize, setPageSize] = useState<PageSize>(50);

  const loadDemand = async () => {
    try {
      const r = await fetch(`${FN}/capabilities/demand`, { headers: await authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "demand failed");
      setDemand(j.demand);
      setTenants(j.tenants ?? []);
    } catch (e) {
      onError?.((e as Error).message);
    }
  };

  useEffect(() => {
    loadDemand();
    if (paused) return;
    const id = setInterval(loadDemand, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    demand?.forEach((d) => s.add(d.status));
    return [...s].sort();
  }, [demand]);

  const filtered = useMemo(() => {
    if (!demand) return null;
    const min = parseInt(minActive, 10) || 0;
    let rows = demand.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (tenantFilter !== "all" && !d.tenant_ids.includes(tenantFilter)) return false;
      if (d.active_kr_count < min) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
  }, [demand, statusFilter, tenantFilter, minActive, sortKey, sortDir]);

  const paged = useMemo(() => {
    if (!filtered) return null;
    if (pageSize === "all") return filtered;
    return filtered.slice(0, pageSize);
  }, [filtered, pageSize]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" || key === "status" ? "asc" : "desc"); }
  };
  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const HeaderCell = ({ k, label, className = "" }: { k: SortKey; label: string; className?: string }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`text-left text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground transition ${className}`}
    >
      {label}{sortIndicator(k)}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Tenant</label>
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tenants</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Min active KRs</label>
          <Input
            type="number"
            min={0}
            value={minActive}
            onChange={(e) => setMinActive(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Show</label>
          <div className="flex gap-1 border border-border rounded-md p-0.5 h-10 items-center">
            {([50, 200, "all"] as const).map((n) => (
              <button
                key={n}
                onClick={() => setPageSize(n)}
                className={`px-2.5 py-1 text-xs rounded ${
                  pageSize === n
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Showing {paged?.length ?? 0} of {filtered?.length ?? 0} (total {demand?.length ?? 0})
        </div>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-muted/30">
          <HeaderCell k="name" label="Capability" className="col-span-4" />
          <HeaderCell k="status" label="Status" className="col-span-2" />
          <div className="col-span-2 text-xs uppercase tracking-wide text-muted-foreground">Module</div>
          <HeaderCell k="tenant_count" label="Tenants" className="col-span-1 text-right" />
          <HeaderCell k="active_kr_count" label="Active KRs" className="col-span-1 text-right" />
          <HeaderCell k="kr_count" label="Total KRs" className="col-span-2 text-right" />
        </div>
        <div className="divide-y divide-border max-h-[60vh] overflow-auto">
          {!paged && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
          {paged?.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No capabilities match.</div>
          )}
          {paged?.map((d) => (
            <Link
              key={d.id}
              to={`/capabilities/${encodeURIComponent(d.id)}`}
              className="grid grid-cols-12 gap-2 px-4 py-3 text-sm items-center hover:bg-muted/30 transition"
            >
              <div className="col-span-4">
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{d.id}</div>
              </div>
              <div className="col-span-2">
                <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
              </div>
              <div className="col-span-2 text-xs font-mono text-muted-foreground">
                {d.owning_module ?? "—"}
              </div>
              <div className="col-span-1 text-right tabular-nums">{d.tenant_count}</div>
              <div className="col-span-1 text-right tabular-nums font-medium">{d.active_kr_count}</div>
              <div className="col-span-2 text-right tabular-nums text-muted-foreground">{d.kr_count}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DemandTable;
