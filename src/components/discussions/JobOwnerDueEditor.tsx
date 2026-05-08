import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Props = {
  jobId: string;
  owner: string | null;
  dueAt: string | null;
  size?: "sm" | "md";
  onSaved?: () => void;
};

export function JobOwnerDueEditor({ jobId, owner, dueAt, size = "sm", onSaved }: Props) {
  const [ownerDraft, setOwnerDraft] = useState(owner ?? "");
  const [date, setDate] = useState<Date | undefined>(dueAt ? new Date(dueAt) : undefined);

  useEffect(() => { setOwnerDraft(owner ?? ""); }, [owner]);
  useEffect(() => { setDate(dueAt ? new Date(dueAt) : undefined); }, [dueAt]);

  const persist = async (patch: { owner?: string | null; due_at?: string | null }) => {
    const { error } = await supabase.from("discussion_actions").update(patch).eq("id", jobId);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return false;
    }
    onSaved?.();
    return true;
  };

  const saveOwner = async () => {
    const next = ownerDraft.trim() || null;
    if (next === (owner ?? null)) return;
    await persist({ owner: next });
  };

  const setDue = async (d: Date | undefined) => {
    setDate(d);
    await persist({ due_at: d ? d.toISOString() : null });
  };

  const inputCls = size === "sm" ? "h-7 text-xs w-24" : "h-8 text-sm w-36";
  const btnCls = size === "sm" ? "h-7 text-xs px-2" : "h-8 text-sm px-3";

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={ownerDraft}
        onChange={(e) => setOwnerDraft(e.target.value)}
        onBlur={saveOwner}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="owner"
        className={inputCls}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(btnCls, "justify-start font-normal", !date && "text-muted-foreground")}
          >
            <CalendarIcon className={size === "sm" ? "h-3 w-3 mr-1" : "h-3.5 w-3.5 mr-1"} />
            {date ? format(date, "MMM d") : "due"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDue}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      {date && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={size === "sm" ? "h-6 w-6" : "h-7 w-7"}
          onClick={() => setDue(undefined)}
          title="Clear due date"
        >
          <X className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </Button>
      )}
    </div>
  );
}
