import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Plus, ArrowRight } from "lucide-react";
import { ClaimsPanel } from "@/components/governance/ClaimsPanel";
import { TruthConflictsPanel } from "@/components/governance/TruthConflictsPanel";
import { UncoveredTasksPanel } from "@/components/governance/UncoveredTasksPanel";
import { W7SignoffChecklist } from "@/components/governance/W7SignoffChecklist";

type Kind = "task" | "notebook" | "entity" | "authority_rule";
type Relation = "touches" | "justifies" | "governs" | "supersedes";

type LinkRow = {
  id: string;
  left_kind: Kind;
  left_ref: string;
  right_kind: Kind;
  right_ref: string;
  relation: Relation;
  created_at: string;
};

type Chain = {
  anchor_kind: Kind;
  anchor_ref: string;
  depth1: LinkRow[];
  depth2: LinkRow[];
  gaps: string[];
};

type Coverage = {
  window_days: number;
  tasks_shipped: number;
  with_entity: number;
  with_notebook: number;
  with_authority_rule: number;
};

type AnchorOption = { ref: string; label: string };

const KIND_LABEL: Record<Kind, string> = {
  task: "Task",
  notebook: "Notebook",
  entity: "Entity",
  authority_rule: "Authority rule",
};

const RELATIONS: Relation[] = ["touches", "justifies", "governs", "supersedes"];

function pct(n: number, d: number) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

export default function Governance() {
  const [params, setParams] = useSearchParams();
  const [anchorKind, setAnchorKind] = useState<Kind>(
    (params.get("kind") as Kind) || "task"
  );
  const [anchorRef, setAnchorRef] = useState<string>(params.get("ref") || "");
  const [options, setOptions] = useState<AnchorOption[]>([]);
  const [chain, setChain] = useState<Chain | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialToKind, setInitialToKind] = useState<Kind>("entity");

  // Load anchor options when kind changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let opts: AnchorOption[] = [];
      if (anchorKind === "task") {
        const { data } = await supabase
          .from("roadmap_tasks")
          .select("id,key,title")
          .order("updated_at", { ascending: false })
          .limit(200);
        opts = (data ?? []).map((t) => ({
          ref: t.id,
          label: `${t.key ?? t.id.slice(0, 6)} — ${t.title ?? ""}`,
        }));
      } else if (anchorKind === "notebook") {
        const { data } = await supabase
          .from("notebook_entries")
          .select("id,title,kind")
          .order("updated_at", { ascending: false })
          .limit(200);
        opts = (data ?? []).map((n) => ({
          ref: n.id,
          label: `[${n.kind}] ${n.title}`,
        }));
      } else if (anchorKind === "entity") {
        const { data } = await supabase
          .from("decision_authorities")
          .select("entity")
          .order("entity");
        const seen = new Set<string>();
        opts = (data ?? [])
          .filter((r) => {
            if (seen.has(r.entity)) return false;
            seen.add(r.entity);
            return true;
          })
          .map((r) => ({ ref: r.entity, label: r.entity }));
      } else if (anchorKind === "authority_rule") {
        const { data } = await supabase
          .from("decision_authorities")
          .select("id,entity,field,source,precedence")
          .order("entity")
          .order("precedence");
        opts = (data ?? []).map((r) => ({
          ref: r.id,
          label: `${r.entity}.${r.field} ← ${r.source} (p${r.precedence})`,
        }));
      }
      if (!cancelled) setOptions(opts);
    })();
    return () => {
      cancelled = true;
    };
  }, [anchorKind]);

  const loadChain = async (kind: Kind, ref: string) => {
    if (!ref) {
      setChain(null);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("governance_chain", {
      _anchor_kind: kind,
      _anchor_ref: ref,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setChain(data as unknown as Chain);
  };

  const loadCoverage = async () => {
    const { data, error } = await supabase.rpc("governance_coverage", {
      _days: 30,
    });
    if (error) return;
    setCoverage(data as unknown as Coverage);
  };

  useEffect(() => {
    loadCoverage();
    const ch = supabase
      .channel(`governance-page-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "governance_links" },
        () => {
          if (anchorRef) loadChain(anchorKind, anchorRef);
          loadCoverage();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKind, anchorRef]);

  useEffect(() => {
    if (anchorRef) loadChain(anchorKind, anchorRef);
  }, [anchorKind, anchorRef]);

  // Listen for "focus task" from UncoveredTasksPanel
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: string; missing: Kind }>).detail;
      if (!detail?.taskId) return;
      setAnchorKind("task");
      setAnchorRef(detail.taskId);
      setInitialToKind(detail.missing);
      setDialogOpen(true);
      setTimeout(() => {
        document
          .getElementById("governance-anchor-card")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    };
    window.addEventListener("governance:focus-task", onFocus);
    return () => window.removeEventListener("governance:focus-task", onFocus);
  }, []);

  // Honour deep links: ?focus=<taskId>&missing=<entity|notebook|authority_rule>
  // Fires once on mount; the focus handler above takes care of scroll + dialog.
  // Unknown / malformed values fall back to a safe default and surface a toast
  // so a stale or hand-edited link still opens AddLinkDialog instead of dying
  // silently.
  useEffect(() => {
    const focusId = params.get("focus");
    const missingRaw = params.get("missing");
    if (!focusId) return;

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(focusId)) {
      toast.error("Invalid deep link", {
        description: `focus=${focusId.slice(0, 20)} is not a task id. Ignoring.`,
      });
      // Strip the bogus params so a refresh doesn't keep re-firing this toast.
      const next = new URLSearchParams(params);
      next.delete("focus");
      next.delete("missing");
      setParams(next, { replace: true });
      return;
    }

    const allowed: Kind[] = ["entity", "notebook", "authority_rule"];
    let missing: Kind = "entity";
    if (missingRaw && (allowed as string[]).includes(missingRaw)) {
      missing = missingRaw as Kind;
    } else if (missingRaw) {
      // Known param but unknown value — open the dialog on the safe default
      // and tell the operator what happened.
      toast.warning("Unknown link target", {
        description: `missing=${missingRaw} isn't one of entity/notebook/authority_rule. Defaulting to entity.`,
      });
    }

    // Defer so child mounts and the focus listener is wired before we dispatch.
    const t = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("governance:focus-task", {
          detail: { taskId: focusId, missing },
        }),
      );
    }, 0);
    return () => clearTimeout(t);
    // Mount-only — re-running on every param change would re-open the dialog
    // every time the user changes the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Sync URL
  useEffect(() => {
    const next = new URLSearchParams(params);
    next.set("kind", anchorKind);
    if (anchorRef) next.set("ref", anchorRef);
    else next.delete("ref");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKind, anchorRef]);


  const anchorLabel =
    options.find((o) => o.ref === anchorRef)?.label || anchorRef;

  return (
    <div className="container max-w-6xl mx-auto py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Governance</h1>
        <p className="text-muted-foreground">
          Pick an uncovered task below, then <strong>+ Link</strong> it to the entity it
          touches and the authority rule that governs it. Gaps are the holes that
          enforcement (W7.2) will close.
        </p>
      </header>

      <UncoveredTasksPanel />

      <Card id="governance-anchor-card">
        <CardHeader>
          <CardTitle>Anchor</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select
            value={anchorKind}
            onValueChange={(v) => {
              setAnchorKind(v as Kind);
              setAnchorRef("");
              setChain(null);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={anchorRef} onValueChange={setAnchorRef}>
            <SelectTrigger className="w-[28rem] max-w-full">
              <SelectValue placeholder={`Pick a ${KIND_LABEL[anchorKind]}…`} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.ref} value={o.ref}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {anchorRef && (
            <AddLinkDialog
              open={dialogOpen}
              setOpen={setDialogOpen}
              fromKind={anchorKind}
              fromRef={anchorRef}
              initialToKind={initialToKind}
              onCreated={() => loadChain(anchorKind, anchorRef)}
            />
          )}
        </CardContent>
      </Card>

      {chain && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                Chain for{" "}
                <span className="font-mono text-sm text-muted-foreground">
                  {anchorLabel}
                </span>
              </span>
              {chain.gaps.length === 0 ? (
                <Badge variant="default">Complete</Badge>
              ) : (
                <Badge variant="destructive">
                  {chain.gaps.length} gap{chain.gaps.length === 1 ? "" : "s"}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {chain.gaps.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Missing legs:{" "}
                {chain.gaps.map((g) => (
                  <Badge key={g} variant="outline" className="mr-1">
                    {g}
                  </Badge>
                ))}
              </div>
            )}

            <div>
              <div className="text-xs uppercase text-muted-foreground mb-2">
                Direct links ({chain.depth1.length})
              </div>
              {chain.depth1.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">
                  No links yet. Use “+ Link” to add one.
                </div>
              ) : (
                <ul className="space-y-2">
                  {chain.depth1.map((l) => (
                    <LinkRow
                      key={l.id}
                      link={l}
                      onDeleted={() => loadChain(anchorKind, anchorRef)}
                    />
                  ))}
                </ul>
              )}
            </div>

            {chain.depth2.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-2">
                  Two hops away ({chain.depth2.length})
                </div>
                <ul className="space-y-1">
                  {chain.depth2.map((l) => (
                    <li
                      key={l.id}
                      className="text-sm text-muted-foreground font-mono"
                    >
                      {l.left_kind}:{shortRef(l.left_ref)}{" "}
                      <ArrowRight className="inline h-3 w-3" /> {l.relation}{" "}
                      <ArrowRight className="inline h-3 w-3" /> {l.right_kind}:
                      {shortRef(l.right_ref)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Coverage rollup (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {!coverage ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Tasks shipped" value={coverage.tasks_shipped} />
              <Stat
                label="…with entity link"
                value={`${coverage.with_entity} (${pct(
                  coverage.with_entity,
                  coverage.tasks_shipped
                )})`}
              />
              <Stat
                label="…with notebook"
                value={`${coverage.with_notebook} (${pct(
                  coverage.with_notebook,
                  coverage.tasks_shipped
                )})`}
              />
              <Stat
                label="…with authority rule"
                value={`${coverage.with_authority_rule} (${pct(
                  coverage.with_authority_rule,
                  coverage.tasks_shipped
                )})`}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">
            Coverage starts at 0% by design — no historical backfill. Each link
            you add moves the number. Once these stop being depressing, W7.2
            (enforcement) becomes safe to ship.
          </p>
        </CardContent>
      </Card>

      <W7SignoffChecklist />

      <TruthConflictsPanel />

      <ClaimsPanel />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function shortRef(ref: string) {
  if (ref.length <= 12) return ref;
  return ref.slice(0, 8) + "…";
}

function LinkRow({
  link,
  onDeleted,
}: {
  link: LinkRow;
  onDeleted: () => void;
}) {
  const remove = async () => {
    const { error } = await supabase
      .from("governance_links")
      .delete()
      .eq("id", link.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Link removed");
      onDeleted();
    }
  };
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="text-sm font-mono truncate">
        <Badge variant="secondary" className="mr-2">
          {link.left_kind}
        </Badge>
        {shortRef(link.left_ref)}
        <span className="mx-2 text-muted-foreground">— {link.relation} →</span>
        <Badge variant="secondary" className="mr-2">
          {link.right_kind}
        </Badge>
        {shortRef(link.right_ref)}
      </div>
      <Button size="icon" variant="ghost" onClick={remove}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function AddLinkDialog({
  open,
  setOpen,
  fromKind,
  fromRef,
  onCreated,
  initialToKind = "entity",
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  fromKind: Kind;
  fromRef: string;
  onCreated: () => void;
  initialToKind?: Kind;
}) {
  const [toKind, setToKind] = useState<Kind>(initialToKind);
  const [toRef, setToRef] = useState("");
  const [relation, setRelation] = useState<Relation>("touches");
  const [opts, setOpts] = useState<AnchorOption[]>([]);

  // Re-sync target kind when the dialog is re-opened with a new initial target
  useEffect(() => {
    if (open) {
      setToKind(initialToKind);
      setToRef("");
    }
  }, [open, initialToKind]);


  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      let next: AnchorOption[] = [];
      if (toKind === "task") {
        const { data } = await supabase
          .from("roadmap_tasks")
          .select("id,key,title")
          .order("updated_at", { ascending: false })
          .limit(200);
        next = (data ?? []).map((t) => ({
          ref: t.id,
          label: `${t.key ?? t.id.slice(0, 6)} — ${t.title ?? ""}`,
        }));
      } else if (toKind === "notebook") {
        const { data } = await supabase
          .from("notebook_entries")
          .select("id,title,kind")
          .order("updated_at", { ascending: false })
          .limit(200);
        next = (data ?? []).map((n) => ({
          ref: n.id,
          label: `[${n.kind}] ${n.title}`,
        }));
      } else if (toKind === "entity") {
        const { data } = await supabase
          .from("decision_authorities")
          .select("entity")
          .order("entity");
        const seen = new Set<string>();
        next = (data ?? [])
          .filter((r) => {
            if (seen.has(r.entity)) return false;
            seen.add(r.entity);
            return true;
          })
          .map((r) => ({ ref: r.entity, label: r.entity }));
      } else if (toKind === "authority_rule") {
        const { data } = await supabase
          .from("decision_authorities")
          .select("id,entity,field,source,precedence")
          .order("entity")
          .order("precedence");
        next = (data ?? []).map((r) => ({
          ref: r.id,
          label: `${r.entity}.${r.field} ← ${r.source} (p${r.precedence})`,
        }));
      }
      if (!cancelled) setOpts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [toKind, open]);

  const submit = async () => {
    if (!toRef) {
      toast.error("Pick a target");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("governance_links").insert({
      left_kind: fromKind,
      left_ref: fromRef,
      right_kind: toKind,
      right_ref: toRef,
      relation,
      created_by: user?.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Link added");
    setOpen(false);
    setToRef("");
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" /> Link
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add governance link</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm">
            <span className="text-muted-foreground">From:</span>{" "}
            <Badge variant="secondary">{fromKind}</Badge>{" "}
            <span className="font-mono">{shortRef(fromRef)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Select value={relation} onValueChange={(v) => setRelation(v as Relation)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={toKind}
              onValueChange={(v) => {
                setToKind(v as Kind);
                setToRef("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={toRef} onValueChange={setToRef}>
              <SelectTrigger>
                <SelectValue placeholder="Target…" />
              </SelectTrigger>
              <SelectContent>
                {opts.map((o) => (
                  <SelectItem key={o.ref} value={o.ref}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Add link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
