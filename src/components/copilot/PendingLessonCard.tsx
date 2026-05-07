import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sparkles, ShieldAlert, Check, X, Loader2 } from "lucide-react";
import { scanLesson, describeIssues } from "@/lib/lessonSafety";

export type PendingLesson = {
  token: string;
  lesson: string;
  scope: "global" | "notebook" | "approvals" | "voice_style";
  staged_at: number;
};

type Props = {
  pending: PendingLesson;
  saving: boolean;
  onConfirm: (lesson: string, scope: PendingLesson["scope"]) => void;
  onCancel: () => void;
};

const SCOPES = ["global", "notebook", "approvals", "voice_style"] as const;
const TTL_MS = 5 * 60 * 1000;

export function PendingLessonCard({ pending, saving, onConfirm, onCancel }: Props) {
  const [text, setText] = useState(pending.lesson);
  const [scope, setScope] = useState<PendingLesson["scope"]>(pending.scope);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { setText(pending.lesson); setScope(pending.scope); }, [pending.token]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, TTL_MS - (now - pending.staged_at));
  const secs = Math.ceil(remaining / 1000);
  const expired = remaining === 0;
  const trimmed = text.trim();
  const tooLong = trimmed.length > 500;
  const empty = trimmed.length === 0;
  const issues = scanLesson(trimmed);
  const unsafe = issues.length > 0;
  const blocked = expired || tooLong || empty || unsafe || saving;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Confirm new lesson
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {expired ? "expired" : `expires in ${secs}s`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Copilot heard "learn from this" and drafted the rule below. Review or edit before saving — nothing is stored yet.
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={600}
          className="text-sm"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Scope</span>
            <Select value={scope} onValueChange={(v) => setScope(v as PendingLesson["scope"])}>
              <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <span className={`text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
            {trimmed.length}/500
          </span>
        </div>
        {unsafe && (
          <div className="flex items-start gap-2 text-xs text-destructive p-2 rounded-md border border-destructive/40 bg-destructive/5">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5" />
            <span>Blocked: contains {describeIssues(issues)}. Remove sensitive data before saving.</span>
          </div>
        )}
        {expired && (
          <p className="text-xs text-destructive">This staged lesson expired. Ask Copilot to learn it again.</p>
        )}
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4 mr-1" /> Discard
          </Button>
          <Button size="sm" onClick={() => onConfirm(trimmed, scope)} disabled={blocked}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
            Save lesson
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
