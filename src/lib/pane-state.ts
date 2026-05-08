import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

export type PaneMode = "left" | "dual" | "centre" | "bottom";

export type ModeSizes = { rightWidth?: number; bottomHeight?: number };

export type PaneState = {
  mode: PaneMode;
  lastNonCentre: Exclude<PaneMode, "centre">;
  /** Per-mode size overrides (panel-group percentages). */
  sizesByMode: Partial<Record<PaneMode, ModeSizes>>;
};

const STORAGE_KEY = "awip.panes.v1";

const DEFAULT_SIZES: Required<ModeSizes> = { rightWidth: 22, bottomHeight: 30 };

const DEFAULT_STATE: PaneState = {
  mode: "left",
  lastNonCentre: "left",
  sizesByMode: {},
};

/** Per-viewport bounds so a saved size from a wide screen doesn't crush a narrow one. */
export const SIZE_BOUNDS = {
  wide: { right: { min: 15, max: 40 }, bottom: { min: 15, max: 60 } },
  narrow: { right: { min: 18, max: 30 }, bottom: { min: 20, max: 45 } },
  mobile: { right: { min: 0, max: 0 }, bottom: { min: 0, max: 0 } },
} as const;

export type ViewportClass = keyof typeof SIZE_BOUNDS;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function getModeSizes(
  state: PaneState,
  mode: PaneMode,
  viewport: ViewportClass = "wide",
): Required<ModeSizes> {
  const overrides = state.sizesByMode[mode] ?? {};
  const b = SIZE_BOUNDS[viewport];
  const rightDefault = clamp(DEFAULT_SIZES.rightWidth, b.right.min || 1, b.right.max || 100);
  const bottomDefault = clamp(DEFAULT_SIZES.bottomHeight, b.bottom.min || 1, b.bottom.max || 100);
  return {
    rightWidth: clamp(overrides.rightWidth ?? rightDefault, b.right.min || 1, b.right.max || 100),
    bottomHeight: clamp(overrides.bottomHeight ?? bottomDefault, b.bottom.min || 1, b.bottom.max || 100),
  };
}

export function withModeSize(
  state: PaneState,
  mode: PaneMode,
  patch: ModeSizes,
): PaneState {
  return {
    ...state,
    sizesByMode: {
      ...state.sizesByMode,
      [mode]: { ...(state.sizesByMode[mode] ?? {}), ...patch },
    },
  };
}

export function clearModeSizes(state: PaneState, mode: PaneMode): PaneState {
  if (!state.sizesByMode[mode]) return state;
  const next = { ...state.sizesByMode };
  delete next[mode];
  return { ...state, sizesByMode: next };
}

export function hasModeSizeOverrides(state: PaneState, mode: PaneMode): boolean {
  const o = state.sizesByMode[mode];
  return !!o && (o.rightWidth != null || o.bottomHeight != null);
}

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

type PaneStateUpdater = Partial<PaneState> | ((prev: PaneState) => Partial<PaneState> | PaneState);

export function usePaneState(): [PaneState, (patch: PaneStateUpdater) => void, string] {
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
    (patch: PaneStateUpdater) => {
      setState((prev) => {
        const resolved = typeof patch === "function" ? patch(prev) : patch;
        const next = { ...prev, ...resolved };
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
