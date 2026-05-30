/**
 * /admin/branding — operator-only page to manage per-tenant branding.
 * Implements the Common Domain UI/UX spec v1.
 *
 * Operators pick a tenant, set the primary colour, optionally an accent
 * colour, and upload logo + favicon + OG image. The contrast resolver
 * auto-derives the foreground colours and the page refuses to save when
 * the override fails WCAG AA without an explicit override reason.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  AA_THRESHOLD,
  contrastRatio,
  deriveForegroundHex,
  isValidHex,
  passesAA,
} from "@/lib/branding/contrast";
import { useBranding } from "@/lib/branding/BrandingProvider";

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

interface BrandingRow {
  tenant_id: string;
  display_name: string | null;
  primary_hex: string;
  accent_hex: string | null;
  primary_foreground_hex: string;
  accent_foreground_hex: string | null;
  logo_light_path: string | null;
  logo_dark_path: string | null;
  favicon_path: string | null;
  og_image_path: string | null;
  spec_version: string;
  accessibility_override_reason: string | null;
}

const BUCKET = "tenant-branding";

async function uploadAsset(tenantId: string, kind: string, file: File): Promise<string> {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "bin";
  const path = `${tenantId}/${kind}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl ?? null;
}

const AdminBranding = () => {
  const { activeTenantId, setActiveTenantId } = useBranding();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string>(activeTenantId ?? "");
  const [row, setRow] = useState<BrandingRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [primaryHex, setPrimaryHex] = useState("#0F172A");
  const [accentHex, setAccentHex] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");
  const logoLightRef = useRef<HTMLInputElement | null>(null);
  const logoDarkRef = useRef<HTMLInputElement | null>(null);
  const faviconRef = useRef<HTMLInputElement | null>(null);
  const ogRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    supabase
      .from("tenants")
      .select("id, name, slug")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          return;
        }
        setTenants((data ?? []) as Tenant[]);
        if (!tenantId && data && data.length > 0) setTenantId(data[0].id);
      });
    // intentional one-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRow = useCallback(async (id: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenant_branding")
      .select("*")
      .eq("tenant_id", id)
      .maybeSingle();
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data) {
      const r = data as BrandingRow;
      setRow(r);
      setDisplayName(r.display_name ?? "");
      setPrimaryHex(r.primary_hex);
      setAccentHex(r.accent_hex ?? "");
      setOverrideReason(r.accessibility_override_reason ?? "");
    } else {
      setRow(null);
      setDisplayName(tenants.find((t) => t.id === id)?.name ?? "");
      setPrimaryHex("#0F172A");
      setAccentHex("");
      setOverrideReason("");
    }
  }, [tenants]);

  useEffect(() => {
    if (tenantId) loadRow(tenantId);
  }, [tenantId, loadRow]);

  const derivedPrimaryFg = useMemo(
    () => (isValidHex(primaryHex) ? deriveForegroundHex(primaryHex) : "#FFFFFF"),
    [primaryHex],
  );
  const derivedAccentFg = useMemo(
    () => (isValidHex(accentHex) ? deriveForegroundHex(accentHex) : derivedPrimaryFg),
    [accentHex, derivedPrimaryFg],
  );
  const primaryRatio = useMemo(
    () => (isValidHex(primaryHex) ? contrastRatio(primaryHex, derivedPrimaryFg) : 0),
    [primaryHex, derivedPrimaryFg],
  );
  const primaryPass = isValidHex(primaryHex) && passesAA(primaryHex, derivedPrimaryFg);

  const onSave = async () => {
    if (!tenantId) {
      toast.error("Pick a tenant first");
      return;
    }
    if (!isValidHex(primaryHex)) {
      toast.error("Primary hex must be a 6-digit colour like #3B82F6");
      return;
    }
    if (accentHex && !isValidHex(accentHex)) {
      toast.error("Accent hex must be a 6-digit colour or empty");
      return;
    }
    if (!primaryPass && !overrideReason.trim()) {
      toast.error("Primary fails WCAG AA — set an accessibility override reason or change the colour");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        display_name: displayName.trim() || null,
        primary_hex: primaryHex,
        accent_hex: accentHex || null,
        primary_foreground_hex: derivedPrimaryFg,
        accent_foreground_hex: accentHex ? derivedAccentFg : null,
        accessibility_override_reason: primaryPass ? null : overrideReason.trim(),
        spec_version: "1.0.0",
      };
      // Upload assets first (if picked)
      const updates: Record<string, string> = {};
      const lightFile = logoLightRef.current?.files?.[0];
      if (lightFile) updates.logo_light_path = await uploadAsset(tenantId, "logo-light", lightFile);
      const darkFile = logoDarkRef.current?.files?.[0];
      if (darkFile) updates.logo_dark_path = await uploadAsset(tenantId, "logo-dark", darkFile);
      const favFile = faviconRef.current?.files?.[0];
      if (favFile) updates.favicon_path = await uploadAsset(tenantId, "favicon", favFile);
      const ogFile = ogRef.current?.files?.[0];
      if (ogFile) updates.og_image_path = await uploadAsset(tenantId, "og-image", ogFile);

      const { error } = await supabase
        .from("tenant_branding")
        .upsert({ ...payload, ...updates }, { onConflict: "tenant_id" });
      if (error) throw error;
      toast.success("Branding saved");
      setActiveTenantId(tenantId);
      await loadRow(tenantId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-4 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold leading-none">Tenant branding</h1>
          <p className="text-sm text-muted-foreground">
            Common Domain UI/UX spec v1. Per-tenant primary colour, logo, favicon, OG image.
            Foreground colours are auto-derived for WCAG AA.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Tenant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger><SelectValue placeholder="Pick a tenant" /></SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              {row ? `Spec ${row.spec_version}` : loading ? "Loading…" : "No branding row yet — saving creates one."}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setActiveTenantId(tenantId || null)}
              disabled={!tenantId}
            >
              Set as active tenant
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Brand identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input id="display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="primary-hex">Primary colour</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={isValidHex(primaryHex) ? primaryHex : "#0F172A"}
                    onChange={(e) => setPrimaryHex(e.target.value.toUpperCase())}
                    className="h-9 w-12 rounded border border-border bg-transparent"
                    aria-label="Primary colour picker"
                  />
                  <Input
                    id="primary-hex"
                    value={primaryHex}
                    onChange={(e) => setPrimaryHex(e.target.value)}
                    placeholder="#3B82F6"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="accent-hex">Accent colour (optional)</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={isValidHex(accentHex) ? accentHex : "#0F172A"}
                    onChange={(e) => setAccentHex(e.target.value.toUpperCase())}
                    className="h-9 w-12 rounded border border-border bg-transparent"
                    aria-label="Accent colour picker"
                  />
                  <Input
                    id="accent-hex"
                    value={accentHex}
                    onChange={(e) => setAccentHex(e.target.value)}
                    placeholder="(defaults to primary)"
                  />
                </div>
              </div>
            </div>

            <ContrastBadge passes={primaryPass} ratio={primaryRatio} fg={derivedPrimaryFg} />

            {!primaryPass && (
              <div className="space-y-2">
                <Label htmlFor="override-reason" className="text-tint-risk">
                  Accessibility override reason (required when AA fails)
                </Label>
                <Textarea
                  id="override-reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Why ship a colour that fails WCAG AA?"
                  rows={2}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FileField label="Logo (light)" inputRef={logoLightRef} currentPath={row?.logo_light_path} accept="image/png,image/svg+xml,image/jpeg" />
              <FileField label="Logo (dark)" inputRef={logoDarkRef} currentPath={row?.logo_dark_path} accept="image/png,image/svg+xml,image/jpeg" />
              <FileField label="Favicon (32×32 PNG)" inputRef={faviconRef} currentPath={row?.favicon_path} accept="image/png,image/x-icon" />
              <FileField label="OG image (1200×630 JPG)" inputRef={ogRef} currentPath={row?.og_image_path} accept="image/jpeg,image/png" />
            </div>

            <div className="flex justify-end">
              <Button onClick={onSave} disabled={saving || !tenantId}>
                {saving ? "Saving…" : "Save branding"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Live preview</CardTitle>
        </CardHeader>
        <CardContent>
          <BrandPreview primaryHex={primaryHex} primaryFg={derivedPrimaryFg} displayName={displayName || "AWIP"} />
        </CardContent>
      </Card>
    </main>
  );
};

function FileField({
  label,
  inputRef,
  currentPath,
  accept,
}: {
  label: string;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  currentPath: string | null | undefined;
  accept: string;
}) {
  const url = publicUrl(currentPath);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="block w-full text-xs file:mr-2 file:rounded file:border file:border-border file:bg-secondary file:px-2 file:py-1 file:text-xs"
      />
      {url && (
        <div className="text-[10px] text-muted-foreground truncate">
          Current: <a href={url} target="_blank" rel="noreferrer" className="underline">{currentPath}</a>
        </div>
      )}
    </div>
  );
}

function ContrastBadge({ passes, ratio, fg }: { passes: boolean; ratio: number; fg: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
          passes
            ? "bg-tint-capability/15 text-tint-capability"
            : "bg-tint-risk/15 text-tint-risk"
        }`}
      >
        {passes ? `WCAG AA pass (${ratio.toFixed(2)}:1)` : `Fails AA (${ratio.toFixed(2)}:1, need ${AA_THRESHOLD}:1)`}
      </span>
      <span className="text-muted-foreground">Foreground auto-derived: {fg}</span>
    </div>
  );
}

function BrandPreview({
  primaryHex,
  primaryFg,
  displayName,
}: {
  primaryHex: string;
  primaryFg: string;
  displayName: string;
}) {
  const valid = isValidHex(primaryHex);
  return (
    <div className="rounded border border-border overflow-hidden">
      <div
        className="px-4 py-6 flex items-center justify-between"
        style={{ background: valid ? primaryHex : undefined, color: valid ? primaryFg : undefined }}
      >
        <span className="font-semibold">{displayName}</span>
        <button
          className="rounded px-3 py-1 text-xs font-medium border"
          style={valid ? { background: primaryFg, color: primaryHex, borderColor: primaryFg } : undefined}
        >
          Primary action
        </button>
      </div>
      <div className="px-4 py-3 text-xs text-muted-foreground bg-background">
        Sample card body. Background and foreground stay Core defaults — only primary/accent/ring swap.
      </div>
    </div>
  );
}

export default AdminBranding;
