import { useEffect, useId, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Check, X, ArrowRight, RefreshCw, Link2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { trackGovernanceDeepLink } from "@/lib/governance-telemetry";
import { shortenAppUrl } from "@/lib/short-link";

const SHORT_LINK_PREF_KEY = "governance:short-links";

type Missing = "any" | "entity" | "notebook" | "authority_rule";
type Row = {
  id: string;
  key: string | null;
  title: string | null;
  status: string;
  updated_at: string;
  has_entity: boolean;
  has_notebook: boolean;
  has_authority_rule: boolean;
};

const MISSING_LABEL: Record<Missing, string> = {
  any: "Any gap",
  entity: "Missing entity",
  notebook: "Missing notebook",
  authority_rule: "Missing rule",
};

const WINDOWS = [7, 30, 90] as const;

function firstMissing(r: Row): "entity" | "notebook" | "authority_rule" {
  if (!r.has_entity) return "entity";
  if (!r.has_authority_rule) return "authority_rule";
  return "notebook";
}

function deepLinkFor(r: Row): string {
  const target = firstMissing(r);
  const url = new URL(window.location.href);
  url.searchParams.set("kind", "task");
  url.searchParams.set("ref", r.id);
  url.searchParams.set("focus", r.id);
  url.searchParams.set("missing", target);
  return url.toString();
}

export function UncoveredTasksPanel() {
  const channelId = useId();
  const [missing, setMissing] = useState<Missing>("any");
  const [days, setDays] = useState<number>(30);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [useShortLinks, setUseShortLinks] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHORT_LINK_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [shortening, setShortening] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SHORT_LINK_PREF_KEY, useShortLinks ? "1" : "0");
    } catch {
      // ignore
    }
  }, [useShortLinks]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("governance_uncovered_tasks", {
      _days: days,
      _missing: missing,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as Row[]);
  }, [days, missing]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`gov-uncovered-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "governance_links" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId, load]);

  const focus = (r: Row) => {
    const target = firstMissing(r);
    // "open" from the panel — i.e. operator clicked Link, not pasted a URL.
    void trackGovernanceDeepLink({
      event_type: "open",
      task_id: r.id,
      missing: target,
      source: "uncovered_panel",
    });
    window.dispatchEvent(
      new CustomEvent("governance:focus-task", {
        detail: { taskId: r.id, missing: target, source: "uncovered_panel" },
      }),
    );
  };

  const copyLink = async (r: Row, e: React.MouseEvent) => {
    e.stopPropagation();
    const link = deepLinkFor(r);
    const target = firstMissing(r);
    void trackGovernanceDeepLink({
      event_type: "copy",
      task_id: r.id,
      missing: target,
      source: "uncovered_panel",
      payload: useShortLinks ? { short: true } : {},
    });

    let toCopy = link;
    let wasShortened = false;
    if (useShortLinks) {
      setShortening(r.id);
      try {
        const short = await shortenAppUrl(link);
        if (short !== link) {
          toCopy = short;
          wasShortened = true;
        }
      } finally {
        setShortening(null);
      }
    }

    try {
      await navigator.clipboard.writeText(toCopy);
      toast.success(wasShortened ? "Short link copied" : "Deep link copied", {
        description: wasShortened
          ? toCopy.replace(/^https?:\/\//, "")
          : `Opens task with ${target} target pre-selected`,
      });
    } catch {
      toast.error("Clipboard blocked", { description: toCopy });
    }
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Uncovered shipped tasks</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Switch
                id="gov-short-links"
                checked={useShortLinks}
                onCheckedChange={setUseShortLinks}
              />
              <Label
                htmlFor="gov-short-links"
                className="text-xs font-normal text-muted-foreground cursor-pointer"
              >
                Short links
              </Label>
            </div>
            <Badge variant="outline">{rows.length}</Badge>
            <Button size="icon" variant="ghost" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(MISSING_LABEL) as Missing[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={missing === m ? "default" : "outline"}
              onClick={() => setMissing(m)}
            >
              {MISSING_LABEL[m]}
            </Button>
          ))}
          <span className="mx-2 h-5 w-px bg-border" />
          {WINDOWS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            {loading
              ? "Loading…"
              : `All shipped tasks in the last ${days}d satisfy "${MISSING_LABEL[missing]}". Healthy.`}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:bg-muted/40"
              >
                <button
                  onClick={() => focus(r)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="text-sm font-medium truncate">
                    <span className="font-mono text-muted-foreground mr-2">
                      {r.key ?? r.id.slice(0, 6)}
                    </span>
                    {r.title ?? "(no title)"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    shipped {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <Pill ok={r.has_entity} label="ent" />
                  <Pill ok={r.has_notebook} label="nb" />
                  <Pill ok={r.has_authority_rule} label="rule" />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => copyLink(r, e)}
                  disabled={shortening === r.id}
                  title={useShortLinks ? "Copy short link" : "Copy deep link"}
                  aria-label={useShortLinks ? "Copy short link" : "Copy deep link"}
                >
                  {shortening === r.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => focus(r)}>
                  Link <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant={ok ? "secondary" : "outline"}
      className={`gap-1 ${ok ? "" : "text-destructive border-destructive/40"}`}
    >
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </Badge>
  );
}
