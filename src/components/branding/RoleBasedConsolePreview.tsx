/**
 * RoleBasedConsolePreview — onboarding step that renders mock console
 * chrome (sidebar + header + cards + button row) using the operator's
 * STAGED branding tokens, switchable across four role personas.
 *
 * Scope (per docs/common-domain-ui.md §1):
 *  - Only the 5 swap-allowed tokens are previewed: --primary,
 *    --primary-foreground, --accent, --accent-foreground, --ring.
 *  - All other tokens (surfaces, status, tints) inherit Core defaults —
 *    they're locked and never swap per tenant.
 *  - Scoped to a wrapping <div style={...}>, so it never leaks to :root
 *    (BrandingProvider is the only writer to :root for these tokens).
 *
 * Roles cover what a tenant will actually see post-onboarding:
 *  - operator: full sidebar + write actions
 *  - admin:    admin surfaces (Branding, Users, Scheduler)
 *  - viewer:   read-only — primary actions render as disabled
 *  - tenant:   sibling-project member view (Core-themed, narrow nav)
 */
import { useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  Bell,
  CalendarCheck,
  CheckCircle2,
  Eye,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Palette,
  Settings,
  Shield,
  Sparkles,
  UserCog,
  Users,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hexToHsl, isValidHex } from "@/lib/branding/contrast";

type RoleKey = "operator" | "admin" | "viewer" | "tenant";

interface NavItem {
  label: string;
  icon: typeof LayoutDashboard;
  active?: boolean;
}

const ROLE_NAV: Record<RoleKey, NavItem[]> = {
  operator: [
    { label: "Morning review", icon: CalendarCheck, active: true },
    { label: "Master plan", icon: ListChecks },
    { label: "Capabilities", icon: Sparkles },
    { label: "Jobs board", icon: GitBranch },
    { label: "Sentinel", icon: Activity },
  ],
  admin: [
    { label: "Branding", icon: Palette, active: true },
    { label: "Users & roles", icon: UserCog },
    { label: "Scheduler", icon: Settings },
    { label: "Edge health", icon: Activity },
    { label: "Security", icon: Shield },
  ],
  viewer: [
    { label: "Dashboard", icon: LayoutDashboard, active: true },
    { label: "Morning review", icon: CalendarCheck },
    { label: "Capabilities", icon: Sparkles },
    { label: "Sentinel", icon: Activity },
  ],
  tenant: [
    { label: "My OKRs", icon: CheckCircle2, active: true },
    { label: "Notebook", icon: ListChecks },
    { label: "Companion", icon: Sparkles },
  ],
};

const ROLE_META: Record<RoleKey, { title: string; subtitle: string; canWrite: boolean }> = {
  operator: {
    title: "Operator console",
    subtitle: "Full read/write across the substrate.",
    canWrite: true,
  },
  admin: {
    title: "Admin surfaces",
    subtitle: "Tenant management, branding, scheduler.",
    canWrite: true,
  },
  viewer: {
    title: "Viewer (read-only)",
    subtitle: "No write actions — primary buttons render as disabled.",
    canWrite: false,
  },
  tenant: {
    title: "Tenant member",
    subtitle: "Sibling-project user — narrow nav, Core-themed.",
    canWrite: true,
  },
};

interface Props {
  primaryHex: string;
  primaryFg: string;
  accentHex: string | null;
  accentFg: string | null;
  displayName: string;
  logoUrl?: string | null;
}

export function RoleBasedConsolePreview({
  primaryHex,
  primaryFg,
  accentHex,
  accentFg,
  displayName,
  logoUrl,
}: Props) {
  const [role, setRole] = useState<RoleKey>("operator");

  const styleVars = useMemo<CSSProperties>(() => {
    if (!isValidHex(primaryHex)) return {};
    const pHsl = hexToHsl(primaryHex);
    const pFgHsl = isValidHex(primaryFg) ? hexToHsl(primaryFg) : "0 0% 100%";
    const aHex = accentHex && isValidHex(accentHex) ? accentHex : primaryHex;
    const aFgHex = accentFg && isValidHex(accentFg) ? accentFg : primaryFg;
    const aHsl = hexToHsl(aHex);
    const aFgHsl = hexToHsl(aFgHex);
    // Scoped CSS vars: only the 5 swap-allowed tokens. Cast required because
    // CSSProperties doesn't type custom properties.
    return {
      ["--primary" as string]: pHsl,
      ["--primary-foreground" as string]: pFgHsl,
      ["--accent" as string]: aHsl,
      ["--accent-foreground" as string]: aFgHsl,
      ["--ring" as string]: pHsl,
    } as CSSProperties;
  }, [primaryHex, primaryFg, accentHex, accentFg]);

  const meta = ROLE_META[role];
  const nav = ROLE_NAV[role];
  const brand = displayName || "AWIP";
  const sidebarWidth = role === "tenant" ? "w-44" : "w-52";

  return (
    <div className="space-y-3">
      <Tabs value={role} onValueChange={(v) => setRole(v as RoleKey)}>
        <TabsList className="grid grid-cols-4 w-full max-w-md">
          <TabsTrigger value="operator">Operator</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
          <TabsTrigger value="viewer">Viewer</TabsTrigger>
          <TabsTrigger value="tenant">Tenant</TabsTrigger>
        </TabsList>
      </Tabs>

      <div
        style={styleVars}
        className="rounded-lg border border-border bg-background overflow-hidden shadow-sm"
        data-testid={`branding-preview-${role}`}
      >
        <div className="flex min-h-[360px]">
          {/* Sidebar */}
          <aside
            className={`${sidebarWidth} shrink-0 border-r border-border bg-muted/40 flex flex-col`}
          >
            <div className="h-12 flex items-center gap-2 px-3 border-b border-border">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="h-6 w-6 rounded object-contain" />
              ) : (
                <div
                  className="h-6 w-6 rounded grid place-items-center text-[10px] font-bold"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
                >
                  {brand.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="text-xs font-semibold truncate">{brand}</span>
            </div>
            <nav className="flex-1 p-2 space-y-0.5">
              {nav.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
                    style={
                      item.active
                        ? {
                            background: "hsl(var(--accent))",
                            color: "hsl(var(--accent-foreground))",
                          }
                        : undefined
                    }
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </div>
                );
              })}
            </nav>
          </aside>

          {/* Main */}
          <div className="flex-1 flex flex-col min-w-0">
            <header className="h-12 border-b border-border flex items-center justify-between px-4">
              <div className="space-y-0.5 min-w-0">
                <div className="text-xs font-semibold truncate">{meta.title}</div>
                <div className="text-[10px] text-muted-foreground truncate">{meta.subtitle}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div
                  className="h-7 w-7 grid place-items-center rounded border border-border"
                  style={{ color: "hsl(var(--primary))" }}
                >
                  <Bell className="h-3.5 w-3.5" />
                </div>
                <div
                  className="h-7 w-7 grid place-items-center rounded text-[10px] font-semibold"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
                >
                  {role === "viewer" ? <Eye className="h-3.5 w-3.5" /> : role === "tenant" ? <Users className="h-3.5 w-3.5" /> : brand.slice(0, 1).toUpperCase()}
                </div>
              </div>
            </header>

            <div className="flex-1 p-4 space-y-3">
              {/* Card row */}
              <div className="grid grid-cols-3 gap-2">
                <PreviewCard label="Open actions" value="12" hint="+3 today" />
                <PreviewCard label="Capabilities" value="47" hint="manifest" />
                <PreviewCard label="Sentinel" value="0" hint="all clear" tone="ok" />
              </div>

              {/* Headline + body */}
              <div className="rounded border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
                    style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
                  >
                    Today
                  </span>
                  <span className="text-xs font-medium">Morning review · 3 panels to triage</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Links and focused text use the brand colour. Body copy and surfaces stay Core defaults so
                  the substrate reads the same across every tenant.
                </p>
                <a
                  className="text-[11px] font-medium underline-offset-2 hover:underline cursor-default"
                  style={{ color: "hsl(var(--primary))" }}
                >
                  Open morning review →
                </a>
              </div>

              {/* Button row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={!meta.canWrite}
                  className="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                  }}
                >
                  {meta.canWrite ? "Primary action" : "Primary action (disabled)"}
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-xs font-medium"
                  style={{
                    borderColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary))",
                  }}
                >
                  Secondary
                </button>
                <button
                  type="button"
                  className="rounded px-3 py-1.5 text-xs font-medium"
                  style={{
                    background: "hsl(var(--accent))",
                    color: "hsl(var(--accent-foreground))",
                  }}
                >
                  Accent
                </button>
                <span
                  className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground rounded border border-border px-2 py-1"
                  style={{ boxShadow: "0 0 0 2px hsl(var(--ring) / 0.25)" }}
                >
                  Ring sample
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Preview uses staged (unsaved) tokens — scoped to this panel, never written to <code>:root</code>.
        Only <code>primary</code>, <code>primary-foreground</code>, <code>accent</code>,{" "}
        <code>accent-foreground</code>, and <code>ring</code> swap per tenant; surfaces and status colours
        stay Core defaults.
      </p>
    </div>
  );
}

function PreviewCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ok";
}) {
  return (
    <div className="rounded border border-border p-2 space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div
        className={`text-[10px] ${tone === "ok" ? "text-tint-capability" : "text-muted-foreground"}`}
      >
        {hint}
      </div>
    </div>
  );
}
