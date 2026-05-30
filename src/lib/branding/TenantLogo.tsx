/**
 * TenantLogo — renders the active tenant's logo. Picks the light or dark
 * variant based on the current theme. Falls back to the display name as a
 * text wordmark when no logo is set.
 */
import { useEffect, useState } from "react";
import { useBranding } from "./BrandingProvider";

interface TenantLogoProps {
  className?: string;
  /** Fallback text shown when no logo is configured. */
  fallback?: string;
}

function detectDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function TenantLogo({ className, fallback = "AWIP" }: TenantLogoProps) {
  const { branding, logoLightUrl, logoDarkUrl } = useBranding();
  const [isDark, setIsDark] = useState<boolean>(() => detectDark());

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setIsDark(detectDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const url = isDark ? logoDarkUrl ?? logoLightUrl : logoLightUrl ?? logoDarkUrl;
  const alt = branding?.display_name ?? fallback;
  if (url) {
    return <img src={url} alt={alt} className={className} />;
  }
  return <span className={className}>{alt}</span>;
}
