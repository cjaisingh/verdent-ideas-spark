import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { UserCircle2, ShieldCheck } from "lucide-react";
import { useCopilotAgents } from "@/hooks/useCopilotAgents";

type Profile = {
  user_id: string;
  display_name: string | null;
  title: string | null;
  pronouns: string | null;
  timezone: string;
  language: string;
  default_agent_id: string | null;
  verbosity: "terse" | "normal" | "verbose";
  context_notes: string | null;
  narrowed_capability_ids: string[];
  narrowed_tables: string[];
  narrowed_max_risk: "low" | "medium" | "high";
};

const RISKS = ["low", "medium", "high"] as const;
const VERBOSITY = ["terse", "normal", "verbose"] as const;
const csv = (a: string[]) => a.join(", ");
const parseCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function CopilotProfile() {
  const { agents } = useCopilotAgents();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setEmail(user.email ?? "");
      const [{ data: prof }, { data: rs }] = await Promise.all([
        supabase.from("copilot_profiles").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      setRoles((rs ?? []).map((r: any) => r.role));
      if (prof) {
        setProfile(prof as Profile);
      } else {
        // Create on the fly if trigger missed an existing user
        const seed: Profile = {
          user_id: user.id,
          display_name: user.email?.split("@")[0] ?? null,
          title: null, pronouns: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          language: "en", default_agent_id: null, verbosity: "normal",
          context_notes: null,
          narrowed_capability_ids: [], narrowed_tables: [], narrowed_max_risk: "high",
        };
        await supabase.from("copilot_profiles").insert(seed);
        setProfile(seed);
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase
      .from("copilot_profiles")
      .update({
        display_name: profile.display_name,
        title: profile.title,
        pronouns: profile.pronouns,
        timezone: profile.timezone,
        language: profile.language,
        default_agent_id: profile.default_agent_id,
        verbosity: profile.verbosity,
        context_notes: profile.context_notes,
        narrowed_capability_ids: profile.narrowed_capability_ids,
        narrowed_tables: profile.narrowed_tables,
        narrowed_max_risk: profile.narrowed_max_risk,
      })
      .eq("user_id", profile.user_id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile saved");
  };

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) =>
    setProfile((p) => (p ? { ...p, [k]: v } : p));

  const riskRank = (r: string) => RISKS.indexOf(r as any);
  const effectiveRisk = useMemo(() => {
    if (!profile) return "—";
    return profile.narrowed_max_risk;
  }, [profile]);

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!profile) return <div className="p-6">Sign in to view your Copilot profile.</div>;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <header className="flex items-center gap-3">
        <UserCircle2 className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Copilot Profile</h1>
          <p className="text-sm text-muted-foreground">
            Who you are to the Copilot, and how you want it to behave.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>{email}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Display name</Label>
            <Input value={profile.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Title / role</Label>
            <Input value={profile.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="Founder, SRE, …" />
          </div>
          <div className="space-y-1">
            <Label>Pronouns</Label>
            <Input value={profile.pronouns ?? ""} onChange={(e) => set("pronouns", e.target.value)} placeholder="they/them" />
          </div>
          <div className="space-y-1">
            <Label>Timezone</Label>
            <Input value={profile.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>Defaults applied each time you open Copilot.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Default agent</Label>
            <Select
              value={profile.default_agent_id ?? "none"}
              onValueChange={(v) => set("default_agent_id", v === "none" ? null : v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Language</Label>
            <Input value={profile.language} onChange={(e) => set("language", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Verbosity</Label>
            <Select value={profile.verbosity} onValueChange={(v: any) => set("verbosity", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {VERBOSITY.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Context notes</CardTitle>
          <CardDescription>Free-form "about me" injected into the agent's context.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={5}
            value={profile.context_notes ?? ""}
            onChange={(e) => set("context_notes", e.target.value)}
            placeholder="I'm driving most weekday mornings, prefer short answers, ship to EU customers…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <CardTitle>Permissions</CardTitle>
          </div>
          <CardDescription>
            Your roles grant the maximum scope. You can <strong>narrow</strong> it for yourself, but not widen it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Roles:</span>
            {roles.length === 0 && <Badge variant="outline">none</Badge>}
            {roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-1">
              <Label>Self-imposed max risk</Label>
              <Select
                value={profile.narrowed_max_risk}
                onValueChange={(v: any) => set("narrowed_max_risk", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RISKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Effective risk ceiling: <Badge variant="outline">{effectiveRisk}</Badge>
              </p>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Narrow capabilities (comma-separated IDs)</Label>
              <Input
                value={csv(profile.narrowed_capability_ids)}
                onChange={(e) => set("narrowed_capability_ids", parseCsv(e.target.value))}
                placeholder="leave empty for no extra narrowing"
              />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label>Narrow tables (comma-separated names)</Label>
              <Input
                value={csv(profile.narrowed_tables)}
                onChange={(e) => set("narrowed_tables", parseCsv(e.target.value))}
                placeholder="leave empty for no extra narrowing"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
      </div>
    </div>
  );
}
