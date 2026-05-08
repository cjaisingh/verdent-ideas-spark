import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Calendar, Tags, Loader2, FlaskConical } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

// Common IANA zones; the input is free-form so any IANA value works.
const TZ_PRESETS = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const KIND_OPTIONS = [
  { key: "general", label: "General" },
  { key: "auth", label: "Auth / roles" },
  { key: "roadmap", label: "Roadmap / findings" },
  { key: "copilot", label: "Copilot / voice" },
  { key: "jobs", label: "Jobs / discussions" },
];

type Settings = {
  id: boolean;
  night_agent_enabled: boolean;
  night_timezone: string;
  night_window_start: string;
  night_window_end: string;
  night_blackout_dates: string[];
  night_allowed_kinds: string[];
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const NightAgentScheduleCard = () => {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftDate, setDraftDate] = useState("");
  const [smoking, setSmoking] = useState(false);
  const [smokeResult, setSmokeResult] = useState<any>(null);

  const runSmoke = async () => {
    setSmoking(true);
    setSmokeResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("night-agent/smoke", { method: "POST" });
      if (error) throw error;
      setSmokeResult(data);
      toast({
        title: data?.would_run ? "Smoke test: would run" : "Smoke test: would skip",
        description: data?.would_run
          ? `${data.candidate_jobs ?? 0} candidate job(s) · test shift recorded`
          : `Skip reasons: ${(data?.skip_reasons ?? []).join(", ") || "unknown"}`,
      });
    } catch (e: any) {
      toast({ title: "Smoke test failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSmoking(false);
    }
  };

  const load = async () => {
    const { data } = await supabase
      .from("memory_settings" as any)
      .select("id, night_agent_enabled, night_timezone, night_window_start, night_window_end, night_blackout_dates, night_allowed_kinds")
      .eq("id", true)
      .maybeSingle();
    if (data) {
      const d = data as any;
      setS({
        id: true,
        night_agent_enabled: !!d.night_agent_enabled,
        night_timezone: d.night_timezone ?? "UTC",
        night_window_start: d.night_window_start ?? "22:00",
        night_window_end: d.night_window_end ?? "06:00",
        night_blackout_dates: Array.isArray(d.night_blackout_dates) ? d.night_blackout_dates : [],
        night_allowed_kinds: Array.isArray(d.night_allowed_kinds) ? d.night_allowed_kinds : [],
      });
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("night_schedule")
      .on("postgres_changes", { event: "*", schema: "public", table: "memory_settings" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const patch = async (changes: Partial<Settings>) => {
    if (!s) return;
    setSaving(true);
    setS({ ...s, ...changes });
    const { error } = await supabase
      .from("memory_settings" as any)
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", true);
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };

  const nowLocal = useMemo(() => {
    if (!s) return null;
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: s.night_timezone,
        hour: "2-digit", minute: "2-digit", weekday: "short", day: "2-digit", month: "short",
      }).format(new Date());
    } catch {
      return "invalid timezone";
    }
  }, [s]);

  if (!s) return null;

  const toggleKind = (key: string) => {
    const set = new Set(s.night_allowed_kinds);
    set.has(key) ? set.delete(key) : set.add(key);
    patch({ night_allowed_kinds: Array.from(set) });
  };

  const addBlackout = () => {
    const d = draftDate.trim();
    if (!isoDate.test(d)) {
      toast({ title: "Use YYYY-MM-DD", variant: "destructive" });
      return;
    }
    if (s.night_blackout_dates.includes(d)) {
      setDraftDate("");
      return;
    }
    patch({ night_blackout_dates: [...s.night_blackout_dates, d].sort() });
    setDraftDate("");
  };

  const removeBlackout = (d: string) => {
    patch({ night_blackout_dates: s.night_blackout_dates.filter((x) => x !== d) });
  };

  const setWindow = (key: "night_window_start" | "night_window_end", value: string) => {
    if (!hhmm.test(value)) return;
    patch({ [key]: value } as any);
  };

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4" /> Night Agent · schedule &amp; policy
          {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
          <input
            type="checkbox"
            className="accent-foreground"
            checked={s.night_agent_enabled}
            onChange={(e) => patch({ night_agent_enabled: e.target.checked })}
          />
          enabled
        </label>
      </header>

      {/* Timezone + window */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Timezone</span>
          <input
            list="night-tz-list"
            value={s.night_timezone}
            onChange={(e) => patch({ night_timezone: e.target.value })}
            className="bg-background border border-border rounded px-2 py-1 font-mono"
            placeholder="UTC"
          />
          <datalist id="night-tz-list">
            {TZ_PRESETS.map((tz) => <option key={tz} value={tz} />)}
          </datalist>
          <span className="text-muted-foreground">now: <span className="font-mono">{nowLocal}</span></span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Window starts</span>
          <input
            type="time"
            value={s.night_window_start}
            onChange={(e) => setWindow("night_window_start", e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Window ends</span>
          <input
            type="time"
            value={s.night_window_end}
            onChange={(e) => setWindow("night_window_end", e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 font-mono"
          />
          <span className="text-muted-foreground">
            {s.night_window_end <= s.night_window_start ? "wraps past midnight" : "same day"}
          </span>
        </label>
      </div>

      {/* Allowed kinds */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Tags className="h-3 w-3" /> Allowed task types
        </div>
        <div className="flex flex-wrap gap-1.5">
          {KIND_OPTIONS.map((k) => {
            const on = s.night_allowed_kinds.includes(k.key);
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => toggleKind(k.key)}
                className={`text-[11px] px-2 py-0.5 rounded border transition ${
                  on
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {k.label}
              </button>
            );
          })}
        </div>
        {s.night_allowed_kinds.length === 0 && (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">
            No types selected — Night Agent will pull nothing.
          </div>
        )}
      </div>

      {/* Blackout dates */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Calendar className="h-3 w-3" /> Blackout dates (no shifts)
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            className="text-[11px] bg-background border border-border rounded px-2 py-1 font-mono"
          />
          <button
            type="button"
            onClick={addBlackout}
            className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
          >
            Add
          </button>
        </div>
        {s.night_blackout_dates.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {s.night_blackout_dates.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border border-border bg-muted/40"
              >
                {d}
                <button
                  onClick={() => removeBlackout(d)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${d}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground italic">No blackout dates set.</div>
        )}
      </div>


      {/* Smoke test */}
      <div className="border-t border-border pt-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FlaskConical className="h-3 w-3" /> Smoke test
            <span className="italic">— evaluates gates now, records a test shift</span>
          </div>
          <button
            type="button"
            onClick={runSmoke}
            disabled={smoking}
            className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1"
          >
            {smoking ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
            Run smoke test
          </button>
        </div>
        {smokeResult && (
          <div className="text-[11px] rounded border border-border bg-muted/30 p-2 space-y-1 font-mono">
            <div>
              would_run: <span className={smokeResult.would_run ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                {String(smokeResult.would_run)}
              </span>
            </div>
            <div>local: {smokeResult.gates?.local_date} {smokeResult.gates?.local_time} ({smokeResult.gates?.timezone})</div>
            <div>window: {smokeResult.gates?.window} · in_window: {String(smokeResult.gates?.in_window)} · blackout: {String(smokeResult.gates?.blackout_hit)}</div>
            <div>candidate_jobs: {smokeResult.candidate_jobs}</div>
            {smokeResult.skip_reasons?.length > 0 && (
              <div>skip_reasons: {smokeResult.skip_reasons.join(", ")}</div>
            )}
            {smokeResult.shift_id && (
              <div>
                test shift:{" "}
                <Link to="/night-shifts" className="underline hover:text-foreground">
                  {String(smokeResult.shift_id).slice(0, 8)}…
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border pt-2">
        Settings are read by the Night Agent on every <span className="font-mono">/open</span> call.
        Outside the window, on a blackout date, or with no allowed types selected, the shift is recorded as <span className="font-mono">skipped</span>.
      </p>
    </section>
  );
};
