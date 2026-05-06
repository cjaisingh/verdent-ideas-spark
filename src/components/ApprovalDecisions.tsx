import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type Row = {
  id: string;
  activity: string;
  status: "approved" | "rejected" | "pending" | string;
  risk: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

type StatusFilter = "all" | "approved" | "rejected" | "pending";

const ApprovalDecisions = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deciderFilter, setDeciderFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "approved" | "rejected">(null);
  const [actorTag, setActorTag] = useState<string>("operator");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email;
      if (email) setActorTag(email);
    });
  }, []);

  const load = async () => {
    const { data } = await supabase
      .from("approval_queue")
      .select("id, activity, status, risk, decided_by, decided_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data ?? []) as Row[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("approval_queue_history")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "approval_queue" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            setRows((c) => c.filter((r) => r.id !== old.id));
            return;
          }
          const next = payload.new as Row;
          setRows((curr) => {
            const without = curr.filter((r) => r.id !== next.id);
            return [next, ...without].slice(0, 100);
          });
          if (payload.eventType === "UPDATE") {
            const prev = payload.old as { status: string };
            if (prev?.status !== next.status) {
              setFlashIds((s) => new Set(s).add(next.id));
              setTimeout(() => {
                setFlashIds((s) => {
                  const n = new Set(s);
                  n.delete(next.id);
                  return n;
                });
              }, 2000);
            }
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const deciders = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.decided_by && set.add(r.decided_by));
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (deciderFilter !== "all" && r.decided_by !== deciderFilter) return false;
      if (!q) return true;
      return (
        r.activity?.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.decided_by ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, deciderFilter]);

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const pendingFilteredIds = useMemo(
    () => filtered.filter((r) => r.status === "pending").map((r) => r.id),
    [filtered],
  );
  const selectedPendingIds = useMemo(
    () => Array.from(selected).filter((id) =>
      filtered.find((r) => r.id === id)?.status === "pending",
    ),
    [selected, filtered],
  );
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allFilteredSelected) {
      const nextSel = new Set(selected);
      filteredIds.forEach((id) => nextSel.delete(id));
      setSelected(nextSel);
    } else {
      setSelected(new Set([...selected, ...filteredIds]));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const runBulk = async (status: "approved" | "rejected") => {
    if (selectedPendingIds.length === 0) return;
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const results = await Promise.allSettled(
        selectedPendingIds.map((id) =>
          supabase.functions.invoke(`awip-api/approvals/${id}/decide`, {
            body: { decision: status, decided_by: `ui:${actorTag}` },
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => {
            if (r.error) throw r.error;
            return r.data;
          }),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (ok > 0) {
        toast[status === "approved" ? "success" : "error"](
          `${status === "approved" ? "Approved" : "Rejected"} ${ok} approval${ok === 1 ? "" : "s"}` +
            (failed > 0 ? ` · ${failed} failed` : ""),
        );
      }
      if (failed > 0 && ok === 0) {
        const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        toast.error("Bulk action failed", { description: first ? String(first.reason?.message ?? first.reason) : undefined });
      }
      setSelected(new Set());
    } catch (e) {
      toast.error("Bulk action failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const badgeFor = (status: string) => {
    if (status === "approved") return "border-emerald-500/40 text-emerald-500";
    if (status === "rejected") return "border-destructive/40 text-destructive";
    return "border-amber-500/40 text-amber-500";
  };

  const selectedCount = selectedPendingIds.length;

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30">
        <div>
          <div className="text-sm font-medium">Approvals</div>
          <div className="text-xs text-muted-foreground">
            Live updates as operators tap ✅ / ❌ in Telegram
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Realtime
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center px-4 py-2 border-b border-border bg-background">
        <Input
          placeholder="Search activity, id, decided_by…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs w-64"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={deciderFilter} onValueChange={setDeciderFilter}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="Decided by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All deciders</SelectItem>
            {deciders.map((d) => (
              <SelectItem key={d} value={d} className="font-mono text-xs">{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(search || statusFilter !== "all" || deciderFilter !== "all") && (
          <button
            onClick={() => { setSearch(""); setStatusFilter("all"); setDeciderFilter("all"); }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        )}
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} of {rows.length}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/10">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allFilteredSelected}
            onCheckedChange={toggleAll}
            id="select-all"
            disabled={filteredIds.length === 0}
          />
          <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">
            Select filtered ({filteredIds.length})
          </label>
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear selection
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {selected.size} selected · {selectedCount} pending actionable
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500"
            disabled={selectedCount === 0 || busy}
            onClick={() => setConfirm("approved")}
          >
            ✅ Approve selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={selectedCount === 0 || busy}
            onClick={() => setConfirm("rejected")}
          >
            ❌ Reject selected
          </Button>
          {pendingFilteredIds.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setSelected(new Set([...selected, ...pendingFilteredIds]))}
            >
              + all pending in view
            </Button>
          )}
        </div>
      </div>

      <div className="divide-y divide-border max-h-[40vh] overflow-auto">
        {filtered.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No approvals match.</div>
        )}
        {filtered.map((r) => {
          const fresh = flashIds.has(r.id);
          const checked = selected.has(r.id);
          const selectable = r.status === "pending";
          return (
            <div
              key={r.id}
              className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/40 ${
                fresh ? "bg-primary/10" : ""
              } ${checked ? "bg-primary/5" : ""}`}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggleOne(r.id)}
                disabled={!selectable}
                aria-label={`Select ${r.id}`}
              />
              <Link
                to={`/approvals/${r.id}`}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <Badge variant="outline" className={badgeFor(r.status)}>
                  {r.status}
                </Badge>
                <span className="font-medium truncate">{r.activity}</span>
                {r.risk && (
                  <span className="text-xs text-muted-foreground font-mono">risk:{r.risk}</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground font-mono truncate max-w-[30%]">
                  {r.decided_by ?? "—"}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {r.decided_at
                    ? new Date(r.decided_at).toLocaleTimeString()
                    : new Date(r.created_at).toLocaleTimeString()}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  {r.id.slice(0, 8)}
                </span>
              </Link>
            </div>
          );
        })}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "approved" ? "Approve" : "Reject"} {selectedCount} pending approval
              {selectedCount === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You're acting as <span className="font-mono">ui:{actorTag}</span>. Only rows still in{" "}
              <span className="font-mono">pending</span> will be changed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirm && runBulk(confirm)}
              disabled={busy}
              className={
                confirm === "approved"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-destructive hover:bg-destructive/90"
              }
            >
              {busy ? "Working…" : confirm === "approved" ? "Approve all" : "Reject all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ApprovalDecisions;
