/**
 * /onboarding/branding — 3-step wizard to brand a tenant.
 *
 *   1. Identity   — pick tenant, set display name, upload light logo (optional)
 *   2. Colours    — primary + accent, with WCAG-AA gate (override requires reason)
 *   3. Preview    — live role-based console preview (operator/admin/viewer/tenant)
 *                   + Save & finish
 *
 * Reuses the same upsert path as /admin/branding so a tenant can finish setup
 * here OR there interchangeably. Nothing is written to `:root` until Save is
 * pressed and BrandingProvider hot-reloads from realtime.
 *
 * Per docs/common-domain-ui.md §1 only the 5 swap-allowed tokens flow through.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
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
import { RoleBasedConsolePreview } from "@/components/branding/RoleBasedConsolePreview";

const BUCKET = "tenant-branding";
const STEPS = ["Identity", "Colours", "Preview"] as const;

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
  accessibility_override_reason: string | null;
  spec_version: string;
}

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

const OnboardingBranding = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { activeTenantId, setActiveTenantId } = useBranding();

  const [step, setStep] = useState(0);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string>(params.get("tenant") ?? activeTenantId ?? "");
  const [row, setRow] = useState<BrandingRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [primaryHex, setPrimaryHex] = useState("#0F172A");
  const [accentHex, setAccentHex] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [stagedLightUrl, setStagedLightUrl] = useState<string | null>(null);
  const logoLightRef = useRef<HTMLInputElement | null>(null);

  // Load tenants once.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRow = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("tenant_branding")
        .select(
          "tenant_id, display_name, primary_hex, accent_hex, primary_foreground_hex, accent_foreground_hex, logo_light_path, accessibility_override_reason, spec_version",
        )
        .eq("tenant_id", id)
        .maybeSingle();
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
    },
    [tenants],
  );

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

  const onPickLight = (file: File | null) => {
    if (!file) {
      setStagedLightUrl(null);
      return;
    }
    setStagedLightUrl(URL.createObjectURL(file));
  };

  const canAdvance = useMemo(() => {
    if (step === 0) return Boolean(tenantId);
    if (step === 1) return isValidHex(primaryHex) && (primaryPass || overrideReason.trim().length > 0);
    return true;
  }, [step, tenantId, primaryHex, primaryPass, overrideReason]);

  const onSave = async () => {
    if (!tenantId || !isValidHex(primaryHex)) return;
    if (!primaryPass && !overrideReason.trim()) {
      toast.error("Primary fails WCAG AA — add an override reason or change the colour");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        tenant_id: tenantId,
        display_name: displayName.trim() || null,
        primary_hex: primaryHex,
        accent_hex: accentHex || null,
        primary_foreground_hex: derivedPrimaryFg,
        accent_foreground_hex: accentHex ? derivedAccentFg : null,
        accessibility_override_reason: primaryPass ? null : overrideReason.trim(),
        spec_version: "1.0.0",
      };
      const lightFile = logoLightRef.current?.files?.[0];
      if (lightFile) {
        payload.logo_light_path = await uploadAsset(tenantId, "logo-light", lightFile);
      }
      const { error } = await supabase
        .from("tenant_branding")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
      toast.success("Branding saved — onboarding complete");
      setActiveTenantId(tenantId);
      navigate("/admin/branding");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const stepNode =
    step === 0 ? (
      <IdentityStep
        tenants={tenants}
        tenantId={tenantId}
        setTenantId={setTenantId}
        displayName={displayName}
        setDisplayName={setDisplayName}
        logoLightRef={logoLightRef}
        currentLogo={publicUrl(row?.logo_light_path)}
        stagedLightUrl={stagedLightUrl}
        onPickLight={onPickLight}
      />
    ) : step === 1 ? (
      <ColoursStep
        primaryHex={primaryHex}
        setPrimaryHex={setPrimaryHex}
        accentHex={accentHex}
        setAccentHex={setAccentHex}
        primaryPass={primaryPass}
        primaryRatio={primaryRatio}
        derivedPrimaryFg={derivedPrimaryFg}
        overrideReason={overrideReason}
        setOverrideReason={setOverrideReason}
      />
    ) : (
      <RoleBasedConsolePreview
        primaryHex={primaryHex}
        primaryFg={derivedPrimaryFg}
        accentHex={accentHex || null}
        accentFg={accentHex ? derivedAccentFg : null}
        displayName={displayName || "AWIP"}
        logoUrl={stagedLightUrl ?? publicUrl(row?.logo_light_path)}
      />
    );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold leading-none">Brand your tenant</h1>
        <p className="text-sm text-muted-foreground">
          Three steps. Nothing is saved until the final step. Or jump straight to{" "}
          <Link to="/admin/branding" className="underline">advanced settings</Link>.
        </p>
      </header>

      <Stepper step={step} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Step {step + 1} of {STEPS.length} — {STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent>{stepNode}</CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button size="sm" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
            Next <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button size="sm" onClick={onSave} disabled={saving || !tenantId}>
            {saving ? "Saving…" : (<><Check className="h-4 w-4 mr-1" /> Save & finish</>)}
          </Button>
        )}
      </div>
    </main>
  );
};

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`h-6 w-6 rounded-full grid place-items-center text-[11px] font-semibold border ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : done
                  ? "bg-tint-capability/15 text-tint-capability border-tint-capability/40"
                  : "border-border text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={active ? "font-medium" : "text-muted-foreground"}>{label}</span>
            {i < STEPS.length - 1 && <span className="text-muted-foreground">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function IdentityStep({
  tenants,
  tenantId,
  setTenantId,
  displayName,
  setDisplayName,
  logoLightRef,
  currentLogo,
  stagedLightUrl,
  onPickLight,
}: {
  tenants: Tenant[];
  tenantId: string;
  setTenantId: (id: string) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  logoLightRef: React.MutableRefObject<HTMLInputElement | null>;
  currentLogo: string | null;
  stagedLightUrl: string | null;
  onPickLight: (file: File | null) => void;
}) {
  const previewUrl = stagedLightUrl ?? currentLogo;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Tenant</Label>
        <Select value={tenantId} onValueChange={setTenantId}>
          <SelectTrigger><SelectValue placeholder="Pick a tenant" /></SelectTrigger>
          <SelectContent>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Shown in the sidebar header"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Logo (light) — optional</Label>
        <div className="flex items-center gap-3">
          <input
            ref={logoLightRef}
            type="file"
            accept="image/png,image/svg+xml,image/jpeg"
            className="block flex-1 text-xs file:mr-2 file:rounded file:border file:border-border file:bg-secondary file:px-2 file:py-1 file:text-xs"
            onChange={(e) => onPickLight(e.target.files?.[0] ?? null)}
          />
          {previewUrl && (
            <img src={previewUrl} alt="" className="h-10 w-10 rounded border border-border object-contain" />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Used in the sidebar header and the live preview on the next step.
        </p>
      </div>
    </div>
  );
}

function ColoursStep({
  primaryHex,
  setPrimaryHex,
  accentHex,
  setAccentHex,
  primaryPass,
  primaryRatio,
  derivedPrimaryFg,
  overrideReason,
  setOverrideReason,
}: {
  primaryHex: string;
  setPrimaryHex: (v: string) => void;
  accentHex: string;
  setAccentHex: (v: string) => void;
  primaryPass: boolean;
  primaryRatio: number;
  derivedPrimaryFg: string;
  overrideReason: string;
  setOverrideReason: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <Label htmlFor="accent-hex">Accent (optional)</Label>
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

      <div className="flex items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
            primaryPass
              ? "bg-tint-capability/15 text-tint-capability"
              : "bg-tint-risk/15 text-tint-risk"
          }`}
        >
          {primaryPass
            ? `WCAG AA pass (${primaryRatio.toFixed(2)}:1)`
            : `Fails AA (${primaryRatio.toFixed(2)}:1, need ${AA_THRESHOLD}:1)`}
        </span>
        <span className="text-muted-foreground">Foreground auto-derived: {derivedPrimaryFg}</span>
      </div>

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
    </div>
  );
}

export default OnboardingBranding;
