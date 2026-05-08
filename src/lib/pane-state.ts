import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

export type PaneMode = "left" | "dual" | "centre" | "bottom";

export type PaneState = {
  mode: PaneMode;
  lastNonCentre: Exclude<PaneMode, "centre">;
  rightWidth: number;
  bottomHeight: number;
};

const STORAGE_KEY = "awip.panes.v1";

const DEFAULT_STATE: PaneState = {
  mode: "left",
  lastNonCentre: "left",
  rightWidth: 22,
  bottomHeight: 30,
};

export function paneFlags(mode: PaneMode): { left: boolean; right: boolean; bottom: boolean } {
  switch (mode) {
    case "left":
      return { left: true, right: false, bottom: false };
    case "dual":
      return { left: true, right: true, bottom: false };
    case "centre":
      return { left: false, right: false, bottom: false };
    case "bottom":
      return { left: true, right: false, bottom: true };
  }
}

function readAll(): Record<string, PaneState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, PaneState>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function routeKeyFromPath(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "/";
}

export function usePaneState(): [PaneState, (patch: Partial<PaneState>) => void, string] {
  const { pathname } = useLocation();
  const key = routeKeyFromPath(pathname);
  const [state, setState] = useState<PaneState>(() => {
    const all = readAll();
    return { ...DEFAULT_STATE, ...(all[key] ?? {}) };
  });

  useEffect(() => {
    const all = readAll();
    setState({ ...DEFAULT_STATE, ...(all[key] ?? {}) });
  }, [key]);

  const update = useCallback(
    (patch: Partial<PaneState>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        const all = readAll();
        all[key] = next;
        writeAll(all);
        return next;
      });
    },
    [key],
  );

  return [state, update, key];
}
