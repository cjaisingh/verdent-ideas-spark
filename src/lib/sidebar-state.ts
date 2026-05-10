import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sidebar UI state hooks.
 * All persistence is localStorage-only (per-browser, per-user). Server sync
 * is intentionally out of scope for v1 — see docs/operator-sidebar.md.
 */

const FAVORITES_KEY = "awip.sidebar.favorites.v1";
const COPILOT_OPEN_KEY = "awip.sidebar.copilot.open";
const COPILOT_LAST_CHILD_KEY = "awip.sidebar.copilot.lastChild";
const MAX_FAVORITES = 6;

export type DotColor = "red" | "amber" | "blue" | "green";

// ---------- Favorites ----------

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.urls)) {
      return (parsed.urls as unknown[]).filter((u): u is string => typeof u === "string").slice(0, MAX_FAVORITES);
    }
    return [];
  } catch {
    return [];
  }
}

function writeFavorites(urls: string[]) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify({ urls: urls.slice(0, MAX_FAVORITES) }));
  } catch {
    // ignore quota errors
  }
}

export function useFavorites() {
  const [urls, setUrls] = useState<string[]>(() => readFavorites());

  // Sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAVORITES_KEY) setUrls(readFavorites());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isFavorite = useCallback((url: string) => urls.includes(url), [urls]);

  const toggleFavorite = useCallback((url: string) => {
    setUrls((prev) => {
      const next = prev.includes(url)
        ? prev.filter((u) => u !== url)
        : [...prev, url].slice(0, MAX_FAVORITES);
      writeFavorites(next);
      return next;
    });
  }, []);

  return { favorites: urls, isFavorite, toggleFavorite, max: MAX_FAVORITES };
}

// ---------- Copilot subgroup open state ----------

export function useCopilotOpen(initialOpenIfActive: boolean) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(COPILOT_OPEN_KEY);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      // ignore
    }
    return initialOpenIfActive;
  });

  // If the user navigates into /copilot/* while the group is closed, force-open.
  useEffect(() => {
    if (initialOpenIfActive && !open) {
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenIfActive]);

  const setAndPersist = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(COPILOT_OPEN_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  return [open, setAndPersist] as const;
}

// Generic collapsible subgroup state (Logs & data, Knowledge, System & admin, ...).
const GROUP_OPEN_PREFIX = "awip.sidebar.group.";

export function useGroupOpen(key: string, defaultOpen: boolean, forceOpenIfActive = false) {
  const storageKey = GROUP_OPEN_PREFIX + key;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      // ignore
    }
    return forceOpenIfActive || defaultOpen;
  });

  useEffect(() => {
    if (forceOpenIfActive && !open) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpenIfActive]);

  const setAndPersist = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // ignore
    }
  }, [storageKey]);

  return [open, setAndPersist] as const;
}

export function rememberCopilotChild(url: string) {
  try {
    localStorage.setItem(COPILOT_LAST_CHILD_KEY, url);
  } catch {
    // ignore
  }
}

export function getCopilotLastChild(): string | null {
  try {
    return localStorage.getItem(COPILOT_LAST_CHILD_KEY);
  } catch {
    return null;
  }
}

// ---------- Status dots ----------

/**
 * Returns a map of route URL -> dot color. Only routes with a real, lightweight
 * signal get a dot; everything else stays clean. Add new entries here as the
 * underlying queries become trivially available — never invent dots.
 */
export function useStatusDots(): Record<string, DotColor> {
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [recentNightObs, setRecentNightObs] = useState(false);

  // Pending approvals — drives a dot on /admin (approval queue lives there).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("approval_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (!cancelled) setPendingApprovals(count ?? 0);
    };
    load();
    const ch = supabase
      .channel("sidebar_approvals_dot")
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_queue" }, () => load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, []);

  // Night observations within the last 30 min — drives a green dot on /night-shifts.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("night_observations" as never)
        .select("id", { count: "exact", head: true })
        .gte("created_at", since);
      if (!cancelled) setRecentNightObs((count ?? 0) > 0);
    };
    load();
    const interval = window.setInterval(load, 60 * 1000);
    const ch = supabase
      .channel("sidebar_night_dot")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "night_observations" }, () => {
        if (!cancelled) setRecentNightObs(true);
      })
      .subscribe();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, []);

  return useMemo(() => {
    const map: Record<string, DotColor> = {};
    if (pendingApprovals > 0) {
      map["/admin"] = pendingApprovals > 5 ? "red" : "amber";
    }
    if (recentNightObs) {
      map["/night-shifts"] = "green";
    }
    return map;
  }, [pendingApprovals, recentNightObs]);
}

export const DOT_CLASSES: Record<DotColor, string> = {
  red: "bg-destructive",
  amber: "bg-amber-500",
  blue: "bg-sky-500",
  green: "bg-emerald-500",
};

export const DOT_LABELS: Record<DotColor, string> = {
  red: "needs attention",
  amber: "awaiting action",
  blue: "in progress",
  green: "active",
};
