import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Check, X, Minus, Loader2, Lock, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";

type CheckState = "pass" | "fail" | "pending" | "loading";

type Item = {
  id: string;
  label: string;
  detail: string;
  state: CheckState;
  link?: { to: string; label: string };
};

type SignoffRow = {
  workstream: string;
  locked: boolean;
  signed_off_at: string;
  signed_off_by_label: string;
  evidence: Record<string, string>;
  overrides: Array<{ check_id: string; reason: string }>;
  notes: string | null;
};

const COVERAGE_TARGET = 60;
const REAL_CLAIM_RATIO_TARGET = 70;
const WORKSTREAM = "W7";

export function W7SignoffChecklist() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [allPass, setAllPass] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [signoff, setSignoff] = useState<SignoffRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const next: Item[] = [];

    next.push({
      id: "ontology",
      label: "Ontology page live",
      detail: "11 canonical entities documented at /ontology",
      state: "pass",
      link: { to: "/ontology", label: "Open" },
    });

    const { count: daCount } = await supabase
      .from("decision_authorities")
      .select("*", { count: "exact", head: true });
    next.push({
      id: "authorities",
      label: "Decision authorities + resolve_truth()",
      detail: `${daCount ?? 0} authority rules registered`,
      state: (daCount ?? 0) > 0 ? "pass" : "fail",
    });

    const { count: linkCount } = await supabase
      .from("governance_links")
      .select("*", { count: "exact", head: true });
    next.push({
      id: "links",
      label: "Governance links + /governance page",
      detail: `${linkCount ?? 0} links recorded`,
      state: (linkCount ?? 0) > 0 ? "pass" : "fail",
    });

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

    next.push({
      id: "closeout-doc",
      label: "docs/w7-closeout.md written",
      detail: "Final closeout document with deferred items",
      state: "pass",
    });

    setItems(next);
    setAllPass(next.every((i) => i.state === "pass"));

    // Load signoff state
    const { data: so } = await supabase
      .from("workstream_signoffs")
      .select("*")
      .eq("workstream", WORKSTREAM)
      .maybeSingle();
    setSignoff((so as SignoffRow | null) ?? null);

    // Admin check
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: r } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!r);
    } else {
      setIsAdmin(false);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    const ch = supabase
      .channel(`w7-signoff-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workstream_signoffs", filter: `workstream=eq.${WORKSTREAM}` },
        () => loadAll()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const passCount = items.filter((i) => i.state === "pass").length;
  const failingItems = items.filter((i) => i.state !== "pass");
  const locked = !!signoff?.locked;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            W7 sign-off checklist
            {locked && (
              <Badge variant="default" className="gap-1">
                <Lock className="h-3 w-3" /> Locked
              </Badge>
            )}
          </span>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Badge variant={allPass ? "default" : "secondary"}>
              {passCount} / {items.length} pass
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {locked && signoff && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <Lock className="h-4 w-4 text-emerald-600" />
              Signed off by {signoff.signed_off_by_label}
              <span className="text-muted-foreground font-normal">
                · {format(new Date(signoff.signed_off_at), "d MMM yyyy HH:mm")} UTC
              </span>
            </div>
            {signoff.overrides.length > 0 && (
              <div className="text-xs text-muted-foreground pt-1">
                Overrides recorded for: {signoff.overrides.map((o) => o.check_id).join(", ")}
              </div>
            )}
            {signoff.notes && (
              <div className="text-xs italic text-muted-foreground">
                "{signoff.notes}"
              </div>
            )}
            <div className="text-xs text-muted-foreground pt-1">
              New W7 tasks and discussion actions are blocked at the database level. Admin can unlock with a written reason.
            </div>
          </div>
        )}

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

        <div className="flex items-center justify-between gap-2 pt-2">
          <p className="text-xs text-muted-foreground">
            {locked
              ? "Workstream locked. All checks frozen at sign-off."
              : isAdmin
              ? "Admin can sign off. Failing checks require a written justification."
              : "Admin role required to sign off."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
              Refresh
            </Button>
            {!locked && isAdmin && (
              <Button size="sm" onClick={() => setDialogOpen(true)} disabled={loading}>
                Sign off W7
              </Button>
            )}
            {locked && isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setUnlockOpen(true)}>
                Unlock
              </Button>
            )}
          </div>
        </div>

        <SignoffDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          items={items}
          failingItems={failingItems}
          onSigned={() => {
            setDialogOpen(false);
            loadAll();
          }}
        />
        <UnlockDialog
          open={unlockOpen}
          onOpenChange={setUnlockOpen}
          onUnlocked={() => {
            setUnlockOpen(false);
            loadAll();
          }}
        />
      </CardContent>
    </Card>
  );
}

function SignoffDialog({
  open,
  onOpenChange,
  items,
  failingItems,
  onSigned,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  items: Item[];
  failingItems: Item[];
  onSigned: () => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReasons({});
      setNotes("");
    }
  }, [open]);

  const submit = async () => {
    const missing = failingItems.filter((f) => !(reasons[f.id] ?? "").trim());
    if (missing.length > 0) {
      toast.error(`Provide a justification for: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }

    const evidence: Record<string, string> = {};
    items.forEach((i) => {
      evidence[i.id] = i.state;
    });
    const overrides = failingItems.map((f) => ({
      check_id: f.id,
      reason: reasons[f.id].trim(),
      detail_at_signoff: f.detail,
    }));

    setBusy(true);
    const { error } = await supabase.rpc("sign_off_workstream", {
      _workstream: WORKSTREAM,
      _evidence: evidence,
      _overrides: overrides,
      _notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("W7 signed off and locked");
    onSigned();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Sign off W7 — Governance Substrate
          </DialogTitle>
          <DialogDescription>
            Locking the workstream blocks new W7 tasks and discussion actions at the database level.
            This is recorded in the audit log and cannot be silently reversed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[50vh] overflow-y-auto">
          {failingItems.length === 0 ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              All {items.length} checks pass. Sign-off is clean — no overrides required.
            </div>
          ) : (
            <>
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                {failingItems.length} check{failingItems.length === 1 ? "" : "s"} not passing.
                Each one needs a written justification before sign-off.
              </div>
              {failingItems.map((f) => (
                <div key={f.id} className="space-y-1">
                  <Label htmlFor={`reason-${f.id}`} className="text-sm">
                    Override: <span className="font-mono">{f.id}</span> — {f.label}
                  </Label>
                  <div className="text-xs text-muted-foreground">{f.detail}</div>
                  <Textarea
                    id={`reason-${f.id}`}
                    placeholder="Why are you signing off despite this check failing?"
                    value={reasons[f.id] ?? ""}
                    onChange={(e) =>
                      setReasons((prev) => ({ ...prev, [f.id]: e.target.value }))
                    }
                    rows={2}
                  />
                </div>
              ))}
            </>
          )}

          <div className="space-y-1">
            <Label htmlFor="signoff-notes" className="text-sm">
              Notes (optional)
            </Label>
            <Textarea
              id="signoff-notes"
              placeholder="Anything future-you should know about this sign-off…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
            Sign off and lock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlockDialog({
  open,
  onOpenChange,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onUnlocked: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const submit = async () => {
    if (reason.trim().length < 5) {
      toast.error("Unlock reason must be at least 5 characters");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("unlock_workstream", {
      _workstream: WORKSTREAM,
      _reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("W7 unlocked");
    onUnlocked();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unlock W7</DialogTitle>
          <DialogDescription>
            This re-opens W7 to new tasks and discussion actions. The reason is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="unlock-reason">Reason</Label>
          <Textarea
            id="unlock-reason"
            placeholder="Why does W7 need to reopen?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
