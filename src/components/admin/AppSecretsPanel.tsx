import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type Row = { key: string; value: string; description: string | null; updated_at: string; updated_by: string | null };

const MANAGED = [
  { key: "DEEPGRAM_API_KEY", description: "Deepgram master key (Member+ role) — used by deepgram-realtime-token", testable: true },
];

export default function AppSecretsPanel() {
  const [rows, setRows] = useState<Record<string, Row | null>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>("");
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string } | undefined>>({});

  const load = async () => {
    const { data, error } = await supabase.from("app_secrets").select("*").in("key", MANAGED.map((m) => m.key));
    if (error) { toast({ title: "Could not load secrets", description: error.message, variant: "destructive" }); return; }
    const map: Record<string, Row | null> = {};
    for (const m of MANAGED) map[m.key] = data?.find((r) => r.key === m.key) ?? null;
    setRows(map);
  };
  useEffect(() => { load(); }, []);

  const save = async (key: string) => {
    const value = drafts[key]?.trim();
    if (!value) { toast({ title: "Value required" }); return; }
    setBusy(key);
    const { data: u } = await supabase.auth.getUser();
    const meta = MANAGED.find((m) => m.key === key);
    const { error } = await supabase.from("app_secrets")
      .upsert({ key, value, description: meta?.description ?? null, updated_by: u.user?.id, updated_at: new Date().toISOString() });
    setBusy("");
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Saved", description: `${key} updated` });
    setDrafts((d) => ({ ...d, [key]: "" }));
    setTestResult((r) => ({ ...r, [key]: undefined }));
    load();
  };

  const remove = async (key: string) => {
    if (!confirm(`Delete ${key}? The function will fall back to the env-var value.`)) return;
    setBusy(key);
    const { error } = await supabase.from("app_secrets").delete().eq("key", key);
    setBusy("");
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Deleted" });
    load();
  };

  const test = async (key: string) => {
    if (key !== "DEEPGRAM_API_KEY") return;
    setBusy(key + ":test");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deepgram-realtime-token`, {
        method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const body = await resp.json().catch(() => ({}));
      if (resp.ok && body.key) {
        setTestResult((r) => ({ ...r, [key]: { ok: true, msg: `OK — token expires in ${body.expires_in ?? 60}s` } }));
      } else {
        setTestResult((r) => ({ ...r, [key]: { ok: false, msg: `[${body.code ?? resp.status}] ${body.hint ?? body.error ?? "unknown error"}` } }));
      }
    } catch (e) {
      setTestResult((r) => ({ ...r, [key]: { ok: false, msg: e instanceof Error ? e.message : String(e) } }));
    } finally { setBusy(""); }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">Runtime secrets</h2>
        <p className="text-xs text-muted-foreground">
          Rotate API keys without redeploying. Stored in <code>app_secrets</code> (admin-only RLS) and read by edge functions on every call. Values fall back to the platform env var if no row exists.
        </p>
      </div>
      <div className="space-y-3">
        {MANAGED.map((m) => {
          const row = rows[m.key];
          const tr = testResult[m.key];
          return (
            <div key={m.key} className="border border-border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono">{m.key}</code>
                {row
                  ? <Badge variant="default">DB · {row.value.slice(0, 6)}…</Badge>
                  : <Badge variant="secondary">env fallback</Badge>}
                {row?.updated_at && (
                  <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                    updated {new Date(row.updated_at).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{m.description}</p>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  placeholder={row ? "Paste new value to rotate…" : "Paste value to set…"}
                  value={drafts[m.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [m.key]: e.target.value }))}
                  className="font-mono text-xs"
                />
                <Button size="sm" onClick={() => save(m.key)} disabled={busy === m.key || !drafts[m.key]?.trim()}>
                  {busy === m.key ? "Saving…" : row ? "Rotate" : "Save"}
                </Button>
                {m.testable && (
                  <Button size="sm" variant="outline" onClick={() => test(m.key)} disabled={busy === m.key + ":test"}>
                    {busy === m.key + ":test" ? "Testing…" : "Test"}
                  </Button>
                )}
                {row && (
                  <Button size="sm" variant="ghost" onClick={() => remove(m.key)} disabled={busy === m.key}>
                    Delete
                  </Button>
                )}
              </div>
              {tr && (
                <div className={`text-xs rounded px-2 py-1 ${tr.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>
                  {tr.msg}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
