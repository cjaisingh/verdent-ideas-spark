import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type EventRow = {
  id: string;
  source: "okr" | "capability";
  ref: string;
  tenant_id: string | null;
  event_type: string;
  payload: unknown;
  actor: string | null;
  created_at: string;
};

type SortKey = "active_kr_count" | "tenant_count" | "kr_count" | "name" | "status";
type SortDir = "asc" | "desc";

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

const ControlPlane = () => {
  const [demand, setDemand] = useState<DemandRow[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | "okr" | "capability">("all");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const lastSeen = useRef<string | null>(null);
  const [tgSending, setTgSending] = useState(false);
  const [chatIds, setChatIds] = useState<number[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string>("");
  const [botInfo, setBotInfo] = useState<{ username: string | null; first_name?: string; id?: number; url: string | null } | null>(null);
  const [botError, setBotError] = useState<{ message: string; status?: number; detail?: unknown; at: string } | null>(null);
  const [botLoading, setBotLoading] = useState(false);
  const botFailCount = useRef(0);
  const botRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [botNextRetryAt, setBotNextRetryAt] = useState<number | null>(null);

  const clearBotRetry = () => {
    if (botRetryTimer.current) {
      clearTimeout(botRetryTimer.current);
      botRetryTimer.current = null;
    }
    setBotNextRetryAt(null);
  };

  const loadBotInfo = async () => {
    clearBotRetry();
    setBotLoading(true);
    setBotError(null);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-bot-info");
      if (error) throw error;
      const d = data as any;
      if (d?.error) {
        setBotInfo(null);
        setBotError({
          message: d.error,
          status: d.status,
          detail: d.detail,
          at: new Date().toISOString(),
        });
        scheduleBotRetry();
        return;
      }
      botFailCount.current = 0;
      setBotInfo(d);
    } catch (e) {
      setBotInfo(null);
      setBotError({ message: (e as Error).message, at: new Date().toISOString() });
      scheduleBotRetry();
    } finally {
      setBotLoading(false);
    }
  };

  const scheduleBotRetry = () => {
    botFailCount.current += 1;
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s, capped at 60s
    const delayMs = Math.min(60_000, 2_000 * 2 ** (botFailCount.current - 1));
    const nextAt = Date.now() + delayMs;
    setBotNextRetryAt(nextAt);
    botRetryTimer.current = setTimeout(() => {
      botRetryTimer.current = null;
      setBotNextRetryAt(null);
      loadBotInfo();
    }, delayMs);
  };

  const loadChatIds = async () => {
    const { data } = await supabase
      .from("operator_messages")
      .select("chat_id")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(200);
    const unique = Array.from(new Set((data ?? []).map((r) => Number(r.chat_id))));
    setChatIds(unique);
    if (unique.length && !selectedChatId) setSelectedChatId(String(unique[0]));
  };

  const sendTelegramTest = async () => {
    setTgSending(true);
    try {
      const body = selectedChatId ? { chat_id: Number(selectedChatId) } : {};
      const { data, error } = await supabase.functions.invoke("telegram-test", { body });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Telegram ping sent", description: `chat_id ${(data as any).chat_id}` });
    } catch (e) {
      toast({
        title: "Telegram test failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setTgSending(false);
    }
  };

  // Filter / sort state
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [minActive, setMinActive] = useState<string>("0");
  const [sortKey, setSortKey] = useState<SortKey>("active_kr_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const loadDemand = async () => {
    try {
      const r = await fetch(`${FN}/capabilities/demand`, { headers: await authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "demand failed");
      setDemand(j.demand);
      setTenants(j.tenants ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pollEvents = async () => {
    try {
      const url = new URL(`${FN}/events/recent`);
      if (lastSeen.current) url.searchParams.set("since", lastSeen.current);
      else url.searchParams.set("limit", "50");
      const r = await fetch(url.toString(), { headers: await authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "events failed");
      const fresh: EventRow[] = j.events ?? [];
      setLastPoll(new Date());
      if (fresh.length > 0) {
        lastSeen.current = fresh[0].created_at;
        setEvents((prev) => [...fresh, ...prev].slice(0, 200));
        const ids = new Set(fresh.map((e) => `${e.source}-${e.id}`));
        setFreshIds(ids);
        setTimeout(() => setFreshIds(new Set()), 1800);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    loadDemand();
    pollEvents();
    loadChatIds();
    loadBotInfo();
    if (paused) return;
    const id = setInterval(() => {
      pollEvents();
      loadDemand();
      loadChatIds();
    }, 5000);
    return () => {
      clearInterval(id);
      clearBotRetry();
    };
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
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
  }, [demand, statusFilter, tenantFilter, minActive, sortKey, sortDir]);

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
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Control Plane</h1>
          <p className="text-sm text-muted-foreground">
            Read-only view of the AWIP contract. Auto-refresh every 5s.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="ghost" size="sm" onClick={loadChatIds} title="Reload chat IDs">
            ↻ Refresh chats
          </Button>
          <Select value={selectedChatId} onValueChange={setSelectedChatId}>
            <SelectTrigger className="w-44 h-9 text-xs">
              <SelectValue placeholder={chatIds.length ? "Pick chat" : "No chats yet"} />
            </SelectTrigger>
            <SelectContent>
              {chatIds.map((id) => (
                <SelectItem key={id} value={String(id)} className="font-mono text-xs">
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={sendTelegramTest}
            disabled={tgSending || !selectedChatId}
          >
            {tgSending ? "Sending…" : "Send Telegram test"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="border border-destructive/50 text-destructive text-sm rounded-md p-3 font-mono">
          {error}
        </div>
      )}

      <div className="border border-border rounded-md p-4 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
              TG
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Telegram bot</div>
              {botLoading && !botInfo && !botError && (
                <div className="text-sm text-muted-foreground">Loading…</div>
              )}
              {botInfo && (
                <div className="text-sm font-medium truncate">
                  {botInfo.first_name ?? "Bot"}{" "}
                  <span className="font-mono text-muted-foreground">@{botInfo.username ?? "unknown"}</span>
                  {botInfo.id != null && (
                    <span className="ml-2 text-xs text-muted-foreground font-mono">id {botInfo.id}</span>
                  )}
                </div>
              )}
              {botError && !botInfo && (
                <div className="text-sm text-destructive font-medium">
                  Gateway failure
                  {botError.status ? <span className="font-mono"> · {botError.status}</span> : null}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={loadBotInfo} disabled={botLoading} title="Reload bot info">
              {botLoading ? "Refreshing…" : "↻ Refresh bot info"}
            </Button>
            <Button variant="outline" size="sm" asChild disabled={!botInfo?.url}>
              <a
                href={botInfo?.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!botInfo?.url}
              >
                Open in Telegram ↗
              </a>
            </Button>
          </div>
        </div>
        {botError && (
          <div className="border border-destructive/40 bg-destructive/5 rounded-md p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-destructive font-mono break-all">
                {botError.message}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadBotInfo}
                disabled={botLoading}
                className="shrink-0"
              >
                {botLoading ? "Retrying…" : "Try again"}
              </Button>
            </div>
            {botError.detail != null && (
              <pre className="text-[11px] font-mono text-muted-foreground bg-background/50 rounded p-2 overflow-auto max-h-40">
{JSON.stringify(botError.detail, null, 2)}
              </pre>
            )}
            <div className="text-[11px] text-muted-foreground font-mono flex justify-between gap-2">
              <span>at {new Date(botError.at).toLocaleTimeString()}</span>
              {botNextRetryAt && !botLoading && (
                <span>
                  next retry in {Math.max(0, Math.ceil((botNextRetryAt - Date.now()) / 1000))}s
                  {botFailCount.current > 1 ? ` (attempt ${botFailCount.current + 1})` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="demand">
        <TabsList>
          <TabsTrigger value="demand">Demand board</TabsTrigger>
          <TabsTrigger value="feed">Live event feed</TabsTrigger>
        </TabsList>

        <TabsContent value="demand" className="mt-4 space-y-3">
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
            <div className="ml-auto text-xs text-muted-foreground">
              {filtered?.length ?? 0} of {demand?.length ?? 0}
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
            <div className="divide-y divide-border">
              {!filtered && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
              {filtered?.length === 0 && (
                <div className="p-6 text-sm text-muted-foreground">No capabilities match.</div>
              )}
              {filtered?.map((d) => (
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
        </TabsContent>

        <TabsContent value="feed" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 border border-border rounded-md p-0.5">
              {(["all", "okr", "capability"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSourceFilter(s)}
                  className={`px-3 py-1 text-xs rounded ${
                    sourceFilter === s
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={`inline-block h-2 w-2 rounded-full ${paused ? "bg-muted-foreground" : "bg-emerald-500 animate-pulse"}`} />
              {paused ? "Paused" : "Live"}
              {lastSeen.current && <span className="font-mono">since {new Date(lastSeen.current).toLocaleTimeString()}</span>}
              {lastPoll && <span>· polled {lastPoll.toLocaleTimeString()}</span>}
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {events.filter((e) => sourceFilter === "all" || e.source === sourceFilter).length} events
            </div>
          </div>

          <div className="border border-border rounded-md max-h-[60vh] overflow-auto">
            {events.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">Waiting for events…</div>
            )}
            <div className="divide-y divide-border">
              {events
                .filter((e) => sourceFilter === "all" || e.source === sourceFilter)
                .map((e) => {
                  const key = `${e.source}-${e.id}`;
                  const isFresh = freshIds.has(key);
                  const isOkr = e.source === "okr";
                  return (
                    <div
                      key={key}
                      className={`flex items-stretch text-sm transition-colors ${
                        isFresh ? "bg-primary/10" : ""
                      }`}
                    >
                      <div
                        className={`w-1 shrink-0 ${
                          isOkr ? "bg-blue-500" : "bg-amber-500"
                        }`}
                        aria-hidden
                      />
                      <div className="flex-1 p-3 flex items-start gap-3 font-mono">
                        <Badge
                          variant="outline"
                          className={`shrink-0 ${
                            isOkr
                              ? "border-blue-500/40 text-blue-500"
                              : "border-amber-500/40 text-amber-500"
                          }`}
                        >
                          {e.source}
                        </Badge>
                        <span className="text-xs shrink-0 text-muted-foreground tabular-nums">
                          {new Date(e.created_at).toLocaleTimeString()}
                        </span>
                        <span className="text-xs shrink-0 font-medium">{e.event_type}</span>
                        <span className="text-xs text-muted-foreground truncate" title={e.ref}>
                          {e.ref}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                          {e.actor ?? "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ControlPlane;
