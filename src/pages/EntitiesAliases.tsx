import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";

type AliasRow = {
  id: string;
  tenant_id: string;
  node_id: string;
  kind: string;
  value: string;
  authoritative: boolean;
  revoked_at: string | null;
  hard_revoked: boolean | null;
  revoke_reason: string | null;
  created_at: string;
};

type RevokeMode = "soft" | "hard";

export default function EntitiesAliases() {
  const [tenantId, setTenantId] = useState("");
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Revoke dialog
  const [revokeTarget, setRevokeTarget] = useState<AliasRow | null>(null);
  const [revokeMode, setRevokeMode] = useState<RevokeMode>("soft");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeErr, setRevokeErr] = useState<string | null>(null);

  // Merge dialog
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeErr, setMergeErr] = useState<string | null>(null);

  // Split dialog
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitAliasId, setSplitAliasId] = useState("");
  const [splitNewNodeName, setSplitNewNodeName] = useState("");
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitErr, setSplitErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) {
        setIsAdmin(false);
        return;
      }
      const { data } = await supabase.rpc("has_role", {
        _user_id: u.user.id,
        _role: "admin",
      });
      setIsAdmin(Boolean(data));
    })();
  }, []);

  async function loadAliases() {
    setBusy(true);
    setLoadErr(null);
    try {
      const { data, error } = await supabase
        .from("tenant_node_aliases")
        .select(
          "id, tenant_id, node_id, kind, value, authoritative, revoked_at, hard_revoked, revoke_reason, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setAliases((data ?? []) as AliasRow[]);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openRevoke(a: AliasRow, mode: RevokeMode) {
    setRevokeTarget(a);
    setRevokeMode(mode);
    setRevokeReason("");
    setRevokeErr(null);
  }

  async function submitRevoke() {
    if (!revokeTarget) return;
    setRevokeBusy(true);
    setRevokeErr(null);
    try {
      const idem = `ui-revoke-${revokeTarget.id}-${Date.now()}`;
      const sess = (await supabase.auth.getSession()).data.session;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/entity-resolve/alias/revoke`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${sess?.access_token ?? ""}`,
          "idempotency-key": idem,
        },
        body: JSON.stringify({
          tenantId: revokeTarget.tenant_id,
          aliasId: revokeTarget.id,
          reason: revokeReason,
          hardRevoke: revokeMode === "hard",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `revoke failed (${res.status})`);
      setRevokeTarget(null);
      await loadAliases();
    } catch (e) {
      setRevokeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRevokeBusy(false);
    }
  }

  async function callResolverPath(
    path: "/alias/merge" | "/alias/split",
    body: Record<string, unknown>,
  ) {
    const idem = `ui-${path.split("/").pop()}-${Date.now()}`;
    const sess = (await supabase.auth.getSession()).data.session;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/entity-resolve${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${sess?.access_token ?? ""}`,
        "idempotency-key": idem,
      },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `${path} failed (${res.status})`);
    return j;
  }

  async function submitMerge() {
    setMergeBusy(true);
    setMergeErr(null);
    try {
      await callResolverPath("/alias/merge", {
        tenantId,
        fromNodeId: mergeFrom,
        intoNodeId: mergeInto,
      });
      setMergeOpen(false);
      setMergeFrom("");
      setMergeInto("");
      await loadAliases();
    } catch (e) {
      setMergeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMergeBusy(false);
    }
  }

  async function submitSplit() {
    setSplitBusy(true);
    setSplitErr(null);
    try {
      await callResolverPath("/alias/split", {
        tenantId,
        aliasId: splitAliasId,
        newNodeName: splitNewNodeName,
      });
      setSplitOpen(false);
      setSplitAliasId("");
      setSplitNewNodeName("");
      await loadAliases();
    } catch (e) {
      setSplitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSplitBusy(false);
    }
  }

  const active = aliases.filter((a) => !a.revoked_at);
  const revoked = aliases.filter((a) => a.revoked_at);

  return (
    <div className="container mx-auto py-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Alias administration</h1>
        <p className="text-muted-foreground mt-1">
          Phase 5 s5.3 M4 — operator surface for revoke / merge / split. All
          actions go through <code className="font-mono text-xs">entity-resolve</code> and
          emit <code className="font-mono text-xs">entity_resolution_events</code>.
        </p>
      </div>

      {isAdmin === false && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Read-only — admin required for hard-revoke</AlertTitle>
          <AlertDescription>
            Soft revoke, merge, and split work for any operator. Hard revoke
            requires the <code className="font-mono text-xs">admin</code> role.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tenant</CardTitle>
          <CardDescription>UUID of the tenant whose aliases you want to manage.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-xs"
            />
            <Button onClick={loadAliases} disabled={busy || !tenantId}>
              {busy ? "Loading…" : "Load aliases"}
            </Button>
          </div>
          {loadErr && (
            <div className="text-sm text-destructive border border-destructive/30 rounded p-3">
              {loadErr}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setMergeOpen(true)} disabled={!tenantId}>
              Merge nodes…
            </Button>
            <Button variant="outline" onClick={() => setSplitOpen(true)} disabled={!tenantId}>
              Split alias…
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active aliases ({active.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active aliases for this tenant.</p>
          ) : (
            <div className="space-y-2">
              {active.map((a) => (
                <div
                  key={a.id}
                  className="border rounded p-3 flex items-center gap-3 flex-wrap text-sm"
                >
                  <Badge variant="outline">{a.kind}</Badge>
                  {a.authoritative && <Badge variant="default">authoritative</Badge>}
                  <span className="font-mono text-xs">{a.value}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    node {a.node_id.slice(0, 8)}…
                  </span>
                  <Button size="sm" variant="outline" onClick={() => openRevoke(a, "soft")}>
                    Soft revoke
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => openRevoke(a, "hard")}
                    disabled={isAdmin !== true}
                    title={isAdmin !== true ? "admin role required" : undefined}
                  >
                    Hard revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {revoked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Revoked ({revoked.length})</CardTitle>
            <CardDescription>Read-only — historical context.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {revoked.map((a) => (
                <div
                  key={a.id}
                  className="border rounded p-3 flex items-center gap-3 flex-wrap text-sm opacity-70"
                >
                  <Badge variant="outline">{a.kind}</Badge>
                  {a.hard_revoked ? (
                    <Badge variant="destructive">hard</Badge>
                  ) : (
                    <Badge variant="secondary">soft</Badge>
                  )}
                  <span className="font-mono text-xs line-through">{a.value}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {a.revoke_reason ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revoke dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {revokeMode === "hard" ? "Hard revoke alias" : "Soft revoke alias"}
            </DialogTitle>
            <DialogDescription>
              {revokeMode === "hard"
                ? "Hard revoke is admin-only and requires a reason of at least 8 characters. Use for compliance / GDPR."
                : "Soft revoke marks the alias revoked. Bound facts flag stale; resolver stops matching it."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              rows={3}
              placeholder={revokeMode === "hard" ? "≥ 8 chars — compliance reason" : "free text"}
            />
            {revokeErr && (
              <div className="text-sm text-destructive">{revokeErr}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button
              variant={revokeMode === "hard" ? "destructive" : "default"}
              onClick={submitRevoke}
              disabled={revokeBusy || !revokeReason || (revokeMode === "hard" && revokeReason.length < 8)}
            >
              {revokeBusy ? "Revoking…" : "Confirm revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge nodes</DialogTitle>
            <DialogDescription>
              Repoint every alias from <em>fromNode</em> to <em>intoNode</em>. The
              source node remains, but loses its aliases.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>From node ID</Label>
              <Input value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label>Into node ID</Label>
              <Input value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="font-mono text-xs" />
            </div>
            {mergeErr && <div className="text-sm text-destructive">{mergeErr}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>Cancel</Button>
            <Button onClick={submitMerge} disabled={mergeBusy || !mergeFrom || !mergeInto}>
              {mergeBusy ? "Merging…" : "Merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Split dialog */}
      <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Split alias to new node</DialogTitle>
            <DialogDescription>
              Reassign an alias to a brand-new node. Use when an alias was wrongly merged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Alias ID</Label>
              <Input value={splitAliasId} onChange={(e) => setSplitAliasId(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label>New node name</Label>
              <Input value={splitNewNodeName} onChange={(e) => setSplitNewNodeName(e.target.value)} />
            </div>
            {splitErr && <div className="text-sm text-destructive">{splitErr}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitOpen(false)}>Cancel</Button>
            <Button onClick={submitSplit} disabled={splitBusy || !splitAliasId || !splitNewNodeName}>
              {splitBusy ? "Splitting…" : "Split"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
