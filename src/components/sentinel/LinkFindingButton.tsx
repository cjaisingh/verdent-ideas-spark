import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";

type Action = {
  id: string;
  short_num: number | null;
  title: string;
  status: string;
};

type Props = {
  findingId: string;
  findingSummary?: string;
  variant?: "default" | "ghost" | "outline" | "secondary";
  size?: "sm" | "default";
};

export function LinkFindingButton({ findingId, findingSummary, variant = "ghost", size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      let q = supabase
        .from("discussion_actions")
        .select("id,short_num,title,status")
        .neq("status", "done")
        .neq("status", "cancelled")
        .order("short_num", { ascending: false })
        .limit(50);
      const trimmed = query.trim();
      if (trimmed) {
        const asNum = Number(trimmed.replace(/^#/, ""));
        if (!Number.isNaN(asNum)) {
          q = supabase
            .from("discussion_actions")
            .select("id,short_num,title,status")
            .eq("short_num", asNum)
            .limit(10);
        } else {
          q = supabase
            .from("discussion_actions")
            .select("id,short_num,title,status")
            .ilike("title", `%${trimmed}%`)
            .order("short_num", { ascending: false })
            .limit(50);
        }
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) toast.error(error.message);
      setActions((data as Action[]) ?? []);
      setLoading(false);
    };
    const t = setTimeout(run, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query]);

  const submit = async () => {
    if (!selectedId) return;
    setSubmitting(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const label = userRes.user?.email ?? null;
      const { error } = await supabase.from("discussion_action_findings").insert({
        action_id: selectedId,
        finding_id: findingId,
        linked_by: userRes.user?.id ?? null,
        linked_by_label: label,
        note: note.trim() || null,
      });
      if (error) {
        if (error.code === "23505") {
          toast.info("Already linked to this action.");
        } else {
          throw error;
        }
      } else {
        toast.success("Finding linked to action.");
      }
      setOpen(false);
      setSelectedId(null);
      setNote("");
      setQuery("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className="h-7 px-2 text-xs gap-1">
          <Link2 className="h-3 w-3" /> Link
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link finding to action</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {findingSummary ?? "Attach this sentinel finding to an open discussion_action group."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Search by #short_num or title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="border rounded-md max-h-64 overflow-auto divide-y">
            {loading ? (
              <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : actions.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No open actions found.</div>
            ) : (
              actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedId(a.id)}
                  className={[
                    "w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex items-start gap-2",
                    selectedId === a.id ? "bg-muted" : "",
                  ].join(" ")}
                >
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5">
                    #{a.short_num ?? "—"}
                  </span>
                  <span className="flex-1 text-sm line-clamp-2">{a.title}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 mt-1">
                    {a.status}
                  </span>
                </button>
              ))
            )}
          </div>
          <Textarea
            placeholder="Optional note (why this finding belongs here)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!selectedId || submitting}>
            {submitting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Link to action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
