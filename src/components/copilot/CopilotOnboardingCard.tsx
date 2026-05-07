import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, ListChecks } from "lucide-react";

const ITEMS: { key: string; label: string; help: string }[] = [
  { key: "goal_confirmed", label: "Goal confirmed", help: "Operator agreed on what success looks like." },
  { key: "capabilities_acknowledged", label: "Capabilities acknowledged", help: "Required capabilities have been listed back." },
  { key: "approvals_requested", label: "Approvals requested", help: "Any approvals required by scope/risk have been queued." },
  { key: "ready_to_execute", label: "Ready to execute", help: "All prerequisites done — agent may proceed." },
];

type Session = {
  id: string;
  agent_slug: string;
  intent: string;
  goal_text: string | null;
  capability_id: string | null;
  activity: string | null;
  risk: string;
  required_capabilities: string[];
  required_approvals: string[];
  checklist: Record<string, { done: boolean; at: string | null; note: string | null }>;
  status: string;
  approval_id: string | null;
  notes: string | null;
  created_at: string;
};

async function callApi(path: string, body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api${path}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

export function CopilotOnboardingCard() {
  const [intent, setIntent] = useState("");
  const [goal, setGoal] = useState("");
  const [capabilityId, setCapabilityId] = useState("");
  const [activity, setActivity] = useState("");
  const [risk, setRisk] = useState<"low" | "medium" | "high">("medium");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callApi("/onboarding?limit=10");
      setSessions(r.sessions ?? []);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("agent_onboarding_sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_onboarding_sessions" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const start = async () => {
    if (!intent.trim()) { toast.error("Intent is required"); return; }
    setBusy(true);
    try {
      await callApi("/onboarding/start", {
        intent: intent.trim(),
        goal: goal.trim() || undefined,
        capability_id: capabilityId.trim() || undefined,
        activity: activity.trim() || undefined,
        risk,
      });
      toast.success("Onboarding session started");
      setIntent(""); setGoal(""); setCapabilityId(""); setActivity("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (id: string, item: string, value: boolean) => {
    try {
      await callApi(`/onboarding/${id}/confirm`, { item, value });
      toast.success(value ? `Marked ${item}` : `Cleared ${item}`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  };

  const statusColor = (s: string) =>
    s === "ready" ? "default" : s === "aborted" ? "destructive" : "secondary";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Agent onboarding checklist
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 rounded-md border p-3">
          <div className="text-sm font-medium">Start a new onboarding</div>
          <Input value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="Intent (e.g. ingest weekly OKR snapshot)" />
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal — what does success look like?" rows={2} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input value={capabilityId} onChange={(e) => setCapabilityId(e.target.value)} placeholder="capability_id (optional)" />
            <Input value={activity} onChange={(e) => setActivity(e.target.value)} placeholder="activity (optional)" />
            <Select value={risk} onValueChange={(v) => setRisk(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">low risk</SelectItem>
                <SelectItem value="medium">medium risk</SelectItem>
                <SelectItem value="high">high risk</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={start} disabled={busy} size="sm">
            {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Start onboarding
          </Button>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">Recent sessions</div>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No onboarding sessions yet.</div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{s.intent}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.agent_slug} · risk {s.risk} · {new Date(s.created_at).toLocaleString()}
                    </div>
                    {s.goal_text && <div className="mt-1 text-xs">🎯 {s.goal_text}</div>}
                  </div>
                  <Badge variant={statusColor(s.status) as any}>{s.status}</Badge>
                </div>

                {(s.required_capabilities?.length || s.required_approvals?.length) ? (
                  <div className="flex flex-wrap gap-1 text-xs">
                    {s.required_capabilities?.map((c) => (
                      <Badge key={`c-${c}`} variant="outline">cap: {c}</Badge>
                    ))}
                    {s.required_approvals?.map((a) => (
                      <Badge key={`a-${a}`} variant="outline">approval: {a}</Badge>
                    ))}
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  {ITEMS.map((it) => {
                    const entry = s.checklist?.[it.key];
                    const done = !!entry?.done;
                    const disabled = s.status === "ready" || s.status === "aborted";
                    return (
                      <label key={it.key} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={done}
                          disabled={disabled}
                          onCheckedChange={(v) => confirm(s.id, it.key, !!v)}
                        />
                        <span className="flex-1">
                          <span className="flex items-center gap-1">
                            {done ? <CheckCircle2 className="h-3 w-3 text-primary" /> : <Circle className="h-3 w-3 text-muted-foreground" />}
                            {it.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">{it.help}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
