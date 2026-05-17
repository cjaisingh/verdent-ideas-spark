import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import AppSecretsPanel from "@/components/admin/AppSecretsPanel";
import GeminiTtsTestPanel from "@/components/admin/GeminiTtsTestPanel";
import CronSecretsCheckPanel from "@/components/admin/CronSecretsCheckPanel";
import TelegramBotPanel from "@/components/admin/TelegramBotPanel";
import ManualOvernightTriggers from "@/components/admin/ManualOvernightTriggers";
import OvernightBackfillPanel from "@/components/admin/OvernightBackfillPanel";
import { WorkerRestartChecklist } from "@/components/admin/WorkerRestartChecklist";

type AppRole = "admin" | "operator";
const ROLES: AppRole[] = ["admin", "operator"];

type UserRow = {
  user_id: string;
  email: string | null;
  created_at: string;
  roles: AppRole[];
};

type AuditRow = {
  id: string;
  created_at: string;
  actor_user_id: string;
  target_user_id: string;
  role: AppRole;
  action: "granted" | "revoked";
};

const Admin = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const [usersRes, auditRes] = await Promise.all([
      supabase.rpc("list_users_with_roles"),
      supabase
        .from("role_change_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (usersRes.error) toast({ title: "Failed to load users", description: usersRes.error.message, variant: "destructive" });
    else setUsers((usersRes.data ?? []) as UserRow[]);
    if (auditRes.error) toast({ title: "Failed to load audit log", description: auditRes.error.message, variant: "destructive" });
    else setAudit((auditRes.data ?? []) as AuditRow[]);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); return; }
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) { setIsAdmin(false); return; }
      setIsAdmin(!!data);
      if (data) refresh();
    })();
  }, []);

  const toggleRole = async (target: UserRow, role: AppRole) => {
    const has = target.roles.includes(role);
    const fn = has ? "revoke_user_role" : "grant_user_role";
    const key = `${target.user_id}:${role}`;
    setBusy(key);
    const { error } = await supabase.rpc(fn, { _target: target.user_id, _role: role });
    setBusy(null);
    if (error) {
      toast({ title: `Could not ${has ? "revoke" : "grant"} ${role}`, description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${has ? "Revoked" : "Granted"} ${role}`, description: target.email ?? target.user_id });
      refresh();
    }
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.email ?? "").toLowerCase().includes(q) || u.user_id.includes(q),
    );
  }, [users, filter]);

  const userLookup = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.user_id, u.email ?? u.user_id.slice(0, 8)));
    return m;
  }, [users]);

  if (isAdmin === null) {
    return <div className="text-sm text-muted-foreground">Checking permissions…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="border border-destructive/50 rounded-md p-6">
        <h1 className="text-lg font-semibold mb-1">Admin only</h1>
        <p className="text-sm text-muted-foreground">
          You need the <code className="font-mono">admin</code> role to manage operator roles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage operator and admin roles. Every change is recorded in the audit log.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium">Users</h2>
          <Input
            placeholder="Filter by email or id…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs ml-auto"
          />
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground py-6 text-center">
                  {loading ? "Loading…" : "No users"}
                </TableCell></TableRow>
              )}
              {filtered.map((u) => (
                <TableRow key={u.user_id}>
                  <TableCell>
                    <div className="font-medium">{u.email ?? "—"}</div>
                    <div className="text-xs font-mono text-muted-foreground">{u.user_id}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {u.roles.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
                      {u.roles.map((r) => (
                        <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>{r}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-2">
                      {ROLES.map((r) => {
                        const has = u.roles.includes(r);
                        const key = `${u.user_id}:${r}`;
                        return (
                          <Button
                            key={r}
                            size="sm"
                            variant={has ? "outline" : "secondary"}
                            disabled={busy === key}
                            onClick={() => toggleRole(u, r)}
                          >
                            {has ? `Revoke ${r}` : `Grant ${r}`}
                          </Button>
                        );
                      })}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Role change audit log</h2>
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center">
                  No changes yet
                </TableCell></TableRow>
              )}
              {audit.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {new Date(a.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.action === "granted" ? "default" : "outline"}>{a.action}</Badge>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{a.role}</Badge></TableCell>
                  <TableCell className="text-xs">
                    <div>{userLookup.get(a.target_user_id) ?? "—"}</div>
                    <div className="font-mono text-muted-foreground">{a.target_user_id}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{userLookup.get(a.actor_user_id) ?? "—"}</div>
                    <div className="font-mono text-muted-foreground">{a.actor_user_id}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <ManualOvernightTriggers />

      <OvernightBackfillPanel />

      <TelegramBotPanel />

      <AppSecretsPanel />

      <GeminiTtsTestPanel />

      <CronSecretsCheckPanel />
    </div>
  );
};

export default Admin;
