/**
 * BrandingProvider — loads the active tenant's branding row and writes the
 * five swap-allowed CSS variables onto `:root`. Hot-reloads via realtime.
 *
 * Rules (locked, per docs/common-domain-ui.md §1):
 *  - Only `primary`, `primary-foreground`, `accent`, `accent-foreground`,
 *    `ring` are ever swapped.
 *  - `background`, `foreground`, `destructive`, `tint-*` are never touched.
 *  - `primary-foreground` and `accent-foreground` are server-side persisted
 *    after the WCAG-AA contrast resolver picked them.
 *
 * Active tenant is taken from (in priority order):
 *  1. `?tenant=<id>` URL search param
 *  2. `localStorage.awip_active_tenant`
 *  3. The first tenant_branding row the operator can read (deterministic order)
 *  4. Nothing — defaults stay
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hexToHsl, isValidHex } from "./contrast";

const STORAGE_KEY = "awip_active_tenant";

export interface TenantBrandingRow {
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
}

export interface BrandingContextValue {
  branding: TenantBrandingRow | null;
  activeTenantId: string | null;
  setActiveTenantId: (id: string | null) => void;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  ogImageUrl: string | null;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: null,
  activeTenantId: null,
  setActiveTenantId: () => {},
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  ogImageUrl: null,
});

const SWAP_TOKENS = ["primary", "primary-foreground", "accent", "accent-foreground", "ring"] as const;

function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from("tenant-branding").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function applyTokens(row: TenantBrandingRow | null): void {
  const root = document.documentElement;
  if (!row) {
    for (const t of SWAP_TOKENS) root.style.removeProperty(`--${t}`);
    return;
  }
  if (!isValidHex(row.primary_hex)) return;
  const primaryHsl = hexToHsl(row.primary_hex);
  const primaryFgHsl = isValidHex(row.primary_foreground_hex)
    ? hexToHsl(row.primary_foreground_hex)
    : "0 0% 100%";
  const accentHex = row.accent_hex && isValidHex(row.accent_hex) ? row.accent_hex : row.primary_hex;
  const accentFgHex = row.accent_foreground_hex && isValidHex(row.accent_foreground_hex)
    ? row.accent_foreground_hex
    : row.primary_foreground_hex;
  const accentHsl = hexToHsl(accentHex);
  const accentFgHsl = hexToHsl(accentFgHex);

  root.style.setProperty("--primary", primaryHsl);
  root.style.setProperty("--primary-foreground", primaryFgHsl);
  root.style.setProperty("--accent", accentHsl);
  root.style.setProperty("--accent-foreground", accentFgHsl);
  root.style.setProperty("--ring", primaryHsl);
}

function applyFavicon(url: string | null): void {
  if (typeof document === "undefined") return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (url) link.href = url;
}

function applyOgImage(url: string | null): void {
  if (typeof document === "undefined" || !url) return;
  let tag = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("property", "og:image");
    document.head.appendChild(tag);
  }
  tag.content = url;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const fromQs = params.get("tenant");
    if (fromQs) return fromQs;
    return window.localStorage.getItem(STORAGE_KEY);
  });
  const [branding, setBranding] = useState<TenantBrandingRow | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const setActiveTenantId = useCallback((id: string | null) => {
    setActiveTenantIdState(id);
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Load the branding row whenever the active tenant changes.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      let query = supabase
        .from("tenant_branding")
        .select(
          "tenant_id, display_name, primary_hex, accent_hex, primary_foreground_hex, accent_foreground_hex, logo_light_path, logo_dark_path, favicon_path, og_image_path, spec_version",
        )
        .limit(1);
      if (activeTenantId) query = query.eq("tenant_id", activeTenantId);
      else query = query.order("updated_at", { ascending: false });
      const { data, error } = await query.maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setBranding(null);
        applyTokens(null);
        return;
      }
      const row = data as TenantBrandingRow;
      setBranding(row);
      applyTokens(row);
      applyFavicon(publicUrl(row.favicon_path));
      applyOgImage(publicUrl(row.og_image_path));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeTenantId]);

  // Realtime: any change to the active tenant's row triggers a reload.
  useEffect(() => {
    if (!activeTenantId) return;
    const channelName = `tenant_branding:${activeTenantId}:${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tenant_branding", filter: `tenant_id=eq.${activeTenantId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setBranding(null);
            applyTokens(null);
            return;
          }
          const row = payload.new as TenantBrandingRow;
          setBranding(row);
          applyTokens(row);
          applyFavicon(publicUrl(row.favicon_path));
          applyOgImage(publicUrl(row.og_image_path));
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [activeTenantId]);

  const value = useMemo<BrandingContextValue>(() => {
    return {
      branding,
      activeTenantId,
      setActiveTenantId,
      logoLightUrl: publicUrl(branding?.logo_light_path),
      logoDarkUrl: publicUrl(branding?.logo_dark_path),
      faviconUrl: publicUrl(branding?.favicon_path),
      ogImageUrl: publicUrl(branding?.og_image_path),
    };
  }, [branding, activeTenantId, setActiveTenantId]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}
