import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

export type PaneMode = "left" | "dual" | "centre" | "bottom";

export type PaneSlotKey = "right" | "bottom";

export type ModeSizes = { rightWidth?: number; bottomHeight?: number };

export type PaneState = {
  mode: PaneMode;
  lastNonCentre: Exclude<PaneMode, "centre">;
  /**
   * Legacy per-mode size overrides (pre-viewport-aware persistence).
   * Kept for backward compatibility — treated as the "wide" viewport bucket
   * when present and `sizesByViewportMode.wide` is absent.
   */
  sizesByMode?: Partial<Record<PaneMode, ModeSizes>>;
  /** Per-viewport, per-mode size overrides (panel-group percentages). */
  sizesByViewportMode: Partial<Record<ViewportClass, Partial<Record<PaneMode, ModeSizes>>>>;
  /** Per-viewport, per-slot pane source overrides (string PaneSourceId). */
  sourcesByViewportSlot?: Partial<Record<ViewportClass, Partial<Record<PaneSlotKey, string>>>>;
};

const STORAGE_KEY = "awip.panes.v1";

const DEFAULT_SIZES: Required<ModeSizes> = { rightWidth: 22, bottomHeight: 30 };

const DEFAULT_STATE: PaneState = {
  mode: "left",
  lastNonCentre: "left",
  sizesByViewportMode: {},
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

/** Resolve the override for a viewport+mode, falling back to legacy sizesByMode for "wide". */
function readOverride(state: PaneState, viewport: ViewportClass, mode: PaneMode): ModeSizes | undefined {
  const v = state.sizesByViewportMode?.[viewport]?.[mode];
  if (v) return v;
  if (viewport === "wide") return state.sizesByMode?.[mode];
  return undefined;
}

export function getModeSizes(
  state: PaneState,
  mode: PaneMode,
  viewport: ViewportClass = "wide",
): Required<ModeSizes> {
  const overrides = readOverride(state, viewport, mode) ?? {};
  const b = SIZE_BOUNDS[viewport];
  const rightDefault = clamp(DEFAULT_SIZES.rightWidth, b.right.min || 1, b.right.max || 100);
  const bottomDefault = clamp(DEFAULT_SIZES.bottomHeight, b.bottom.min || 1, b.bottom.max || 100);
  return {
    rightWidth: clamp(overrides.rightWidth ?? rightDefault, b.right.min || 1, b.right.max || 100),
    bottomHeight: clamp(overrides.bottomHeight ?? bottomDefault, b.bottom.min || 1, b.bottom.max || 100),
  };
}

/** Clamp a size patch to the viewport's allowed min/max so persisted values
 *  never drift outside the bounds the resizable panels enforce visually. */
function clampPatch(patch: ModeSizes, viewport: ViewportClass): ModeSizes {
  const b = SIZE_BOUNDS[viewport];
  const out: ModeSizes = {};
  if (patch.rightWidth != null) {
    const lo = b.right.min || 1;
    const hi = b.right.max || 100;
    if (hi >= lo) out.rightWidth = clamp(Math.round(patch.rightWidth), lo, hi);
  }
  if (patch.bottomHeight != null) {
    const lo = b.bottom.min || 1;
    const hi = b.bottom.max || 100;
    if (hi >= lo) out.bottomHeight = clamp(Math.round(patch.bottomHeight), lo, hi);
  }
  return out;
}

export function withModeSize(
  state: PaneState,
  mode: PaneMode,
  patch: ModeSizes,
  viewport: ViewportClass = "wide",
): PaneState {
  const clamped = clampPatch(patch, viewport);
  // If nothing survived clamping (e.g. mobile has zero-width bounds), no-op.
  if (clamped.rightWidth == null && clamped.bottomHeight == null) return state;
  const byVp = state.sizesByViewportMode ?? {};
  const forVp = byVp[viewport] ?? {};
  return {
    ...state,
    sizesByViewportMode: {
      ...byVp,
      [viewport]: {
        ...forVp,
        [mode]: { ...(forVp[mode] ?? {}), ...clamped },
      },
    },
  };
}

export function clearModeSizes(
  state: PaneState,
  mode: PaneMode,
  viewport: ViewportClass = "wide",
): PaneState {
  const byVp = state.sizesByViewportMode ?? {};
  const forVp = byVp[viewport];
  let nextByVp = byVp;
  if (forVp && forVp[mode]) {
    const nextForVp = { ...forVp };
    delete nextForVp[mode];
    nextByVp = { ...byVp, [viewport]: nextForVp };
  }
  // Also strip legacy wide entry if we're clearing wide.
  let nextLegacy = state.sizesByMode;
  if (viewport === "wide" && nextLegacy?.[mode]) {
    nextLegacy = { ...nextLegacy };
    delete nextLegacy[mode];
  }
  return { ...state, sizesByViewportMode: nextByVp, sizesByMode: nextLegacy };
}

export function hasModeSizeOverrides(
  state: PaneState,
  mode: PaneMode,
  viewport: ViewportClass = "wide",
): boolean {
  const o = readOverride(state, viewport, mode);
  return !!o && (o.rightWidth != null || o.bottomHeight != null);
}

/** Clear every mode's size override for one viewport class. Also strips the
 *  legacy `sizesByMode` map when clearing the "wide" viewport so an old
 *  pre-viewport-aware payload doesn't keep re-applying. */
export function clearViewportSizes(state: PaneState, viewport: ViewportClass): PaneState {
  const byVp = state.sizesByViewportMode ?? {};
  let nextByVp = byVp;
  if (byVp[viewport]) {
    nextByVp = { ...byVp };
    delete nextByVp[viewport];
  }
  const nextLegacy = viewport === "wide" ? undefined : state.sizesByMode;
  return { ...state, sizesByViewportMode: nextByVp, sizesByMode: nextLegacy };
}

/** True if any mode has a saved override for the given viewport class. */
export function hasViewportSizeOverrides(state: PaneState, viewport: ViewportClass): boolean {
  const forVp = state.sizesByViewportMode?.[viewport];
  if (forVp && Object.values(forVp).some((m) => m && (m.rightWidth != null || m.bottomHeight != null))) {
    return true;
  }
  if (viewport === "wide") {
    const legacy = state.sizesByMode;
    if (legacy && Object.values(legacy).some((m) => m && (m.rightWidth != null || m.bottomHeight != null))) {
      return true;
    }
  }
  return false;
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
