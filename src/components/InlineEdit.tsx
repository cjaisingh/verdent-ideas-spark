import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";

type Props = {
  value: string | null;
  onSave: (next: string) => Promise<void> | void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  textClassName?: string;
};

export const InlineEdit = ({
  value,
  onSave,
  multiline = false,
  placeholder = "Click to add…",
  className = "",
  textClassName = "",
}: Props) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select?.();
    }
  }, [editing]);

  const commit = async () => {
    if (draft === (value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={`space-y-1 ${className}`} onClick={(e) => e.stopPropagation()}>
        {multiline ? (
          <Textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="text-xs min-h-[70px]"
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
            }}
          />
        ) : (
          <Input
            ref={ref as React.RefObject<HTMLInputElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-7 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              if (e.key === "Enter") commit();
            }}
          />
        )}
        <div className="flex gap-1">
          <Button size="sm" className="h-6 text-[11px]" onClick={commit} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={cancel}>
            Cancel
          </Button>
          {multiline && <span className="text-[10px] text-muted-foreground self-center">⌘+Enter to save</span>}
        </div>
      </div>
    );
  }

  const empty = !value || !value.trim();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={`group text-left w-full rounded px-1 -mx-1 hover:bg-muted/40 transition ${className}`}
    >
      <span
        className={`${empty ? "text-muted-foreground italic" : ""} ${textClassName} whitespace-pre-wrap`}
      >
        {empty ? placeholder : value}
      </span>
      <Pencil className="inline h-3 w-3 ml-1 opacity-0 group-hover:opacity-50 align-baseline" />
    </button>
  );
};
