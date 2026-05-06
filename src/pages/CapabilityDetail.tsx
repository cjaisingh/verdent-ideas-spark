import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Tenant = { id: string; slug: string; name: string };

type Measurement = {
  metric_name: string;
  target: number | null;
  unit: string | null;
  cadence: string | null;
};

type KR = {
  id: string;
  title: string;
  status: string;
  version: number;
  created_at: string;
  tenant: Tenant | null;
  parent_title: string | null;
  measurement: Measurement | null;
};

type TenantSummary = Tenant & { kr_count: number; active_kr_count: number };

type Detail = {
  capability: { id: string; name: string; status: string; owning_module: string | null; description?: string | null };
  krs: KR[];
  tenants: TenantSummary[];
};

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;

const statusVariant = (s: string) => {
  if (s === "available") return "default" as const;
  if (s === "planned") return "secondary" as const;
  if (s === "unknown" || s === "superseded") return "destructive" as const;
  return "outline" as const;
};

const CapabilityDetail = () => {
  const { id } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        const r = await fetch(`${FN}/capabilities/${encodeURIComponent(id ?? "")}/demand-detail`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "failed");
        setData(j);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  if (error) {
    return <div className="text-sm text-destructive font-mono">{error}</div>;
  }
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const { capability, krs, tenants } = data;
  const activeCount = krs.filter((k) => k.status !== "superseded").length;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/control-plane" className="text-xs text-muted-foreground hover:text-foreground">
          ← Control plane
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{capability.name}</h1>
            <div className="text-xs font-mono text-muted-foreground mt-1">{capability.id}</div>
            {capability.description && (
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{capability.description}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={statusVariant(capability.status)}>{capability.status}</Badge>
            {capability.owning_module && (
              <span className="text-xs font-mono text-muted-foreground">{capability.owning_module}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Tenants" value={tenants.length} />
        <Stat label="Active KRs" value={activeCount} highlight />
        <Stat label="Total KRs" value={krs.length} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tenants driving demand
        </h2>
        <div className="border border-border rounded-md divide-y divide-border">
          {tenants.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No tenants currently require this.</div>
          )}
          {tenants.map((t) => (
            <Link
              key={t.id}
              to={`/tenants/${t.id}`}
              className="flex items-center gap-4 p-3 text-sm hover:bg-muted/30 transition"
            >
              <div className="flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs font-mono text-muted-foreground">{t.slug}</div>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {t.active_kr_count} active / {t.kr_count} total
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Key results requiring this capability
        </h2>
        <div className="border border-border rounded-md divide-y divide-border">
          {krs.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No KRs reference this capability yet.</div>
          )}
          {krs.map((k) => (
            <div
              key={k.id}
              className={`p-3 space-y-1 ${k.status === "superseded" ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-3">
                <Badge variant={statusVariant(k.status)} className="shrink-0">
                  {k.status}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{k.title}</div>
                  {k.parent_title && (
                    <div className="text-xs text-muted-foreground truncate">
                      under: {k.parent_title}
                    </div>
                  )}
                </div>
                {k.tenant && (
                  <Link
                    to={`/tenants/${k.tenant.id}`}
                    className="text-xs font-mono text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {k.tenant.slug}
                  </Link>
                )}
              </div>
              {k.measurement && (
                <div className="text-xs font-mono text-muted-foreground pl-[68px]">
                  {k.measurement.metric_name}
                  {k.measurement.target != null && ` · target ${k.measurement.target}${k.measurement.unit ?? ""}`}
                  {k.measurement.cadence && ` · ${k.measurement.cadence}`}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const Stat = ({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) => (
  <div className="border border-border rounded-md p-4">
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={`text-3xl font-semibold tabular-nums mt-1 ${highlight ? "text-primary" : ""}`}>
      {value}
    </div>
  </div>
);

export default CapabilityDetail;
