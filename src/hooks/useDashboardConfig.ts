import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TEMPLATES } from "@/components/dashboard/templates";
import type { DashboardConfig, Tab, TemplateId, Widget, WidgetKind } from "@/components/dashboard/widgets/types";

const SAVE_DEBOUNCE_MS = 800;
const MAX_TABS = 4;

function shortId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function emptyWidgetsFor(template: TemplateId): (Widget | null)[] {
  return TEMPLATES[template].slots.map(() => null);
}

export const DEFAULT_TAB_TEMPLATE: TemplateId = "one-plus-three";
const DEFAULT_TAB_KINDS: WidgetKind[] = [
  "pending-approvals",
  "open-risks",
  "night-observations-24h",
  "recent-capability-events",
];

function defaultTabWidgets(): (Widget | null)[] {
  const slotCount = TEMPLATES[DEFAULT_TAB_TEMPLATE].slots.length;
  return Array.from({ length: slotCount }).map((_, i) => {
    const kind = DEFAULT_TAB_KINDS[i];
    return kind ? { id: shortId(), kind } : null;
  });
}

function seedConfig(): DashboardConfig {
  const tabId = shortId();
  const tab: Tab = {
    id: tabId,
    name: "Today",
    template: DEFAULT_TAB_TEMPLATE,
    widgets: defaultTabWidgets(),
  };
  return { tabs: [tab], activeTabId: tabId };
}

function sanitize(raw: unknown): DashboardConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { tabs?: unknown; activeTabId?: unknown };
  if (!Array.isArray(obj.tabs)) return null;
  const tabs: Tab[] = [];
  for (const t of obj.tabs.slice(0, MAX_TABS)) {
    if (!t || typeof t !== "object") continue;
    const tab = t as Partial<Tab>;
    if (typeof tab.id !== "string" || typeof tab.name !== "string") continue;
    const tpl = (tab.template ?? "grid-2x2") as TemplateId;
    if (!(tpl in TEMPLATES)) continue;
    const slotCount = TEMPLATES[tpl].slots.length;
    const widgets: (Widget | null)[] = Array.from({ length: slotCount }).map((_, i) => {
      const w = Array.isArray(tab.widgets) ? tab.widgets[i] : null;
      if (!w || typeof w !== "object") return null;
      const ww = w as Partial<Widget>;
      if (typeof ww.id !== "string" || typeof ww.kind !== "string") return null;
      return { id: ww.id, kind: ww.kind as WidgetKind, props: ww.props };
    });
    tabs.push({ id: tab.id, name: tab.name.slice(0, 24), template: tpl, widgets });
  }
  if (tabs.length === 0) return null;
  const activeTabId = typeof obj.activeTabId === "string" && tabs.some((t) => t.id === obj.activeTabId)
    ? obj.activeTabId
    : tabs[0].id;
  return { tabs, activeTabId };
}

export function useDashboardConfig() {
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Load (and seed if missing) on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      const uid = user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        setLoaded(true);
        return;
      }
      const { data } = await supabase
        .from("operator_dashboards")
        .select("tabs,active_tab_id")
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const cfg = sanitize({ tabs: data.tabs, activeTabId: data.active_tab_id }) ?? seedConfig();
        setConfig(cfg);
      } else {
        const seeded = seedConfig();
        setConfig(seeded);
        await supabase.from("operator_dashboards").insert({
          user_id: uid,
          tabs: seeded.tabs as never,
          active_tab_id: seeded.activeTabId,
        });
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (cfg: DashboardConfig): Promise<{ ok: boolean }> => {
    if (!userId) return { ok: true };
    const { error } = await supabase
      .from("operator_dashboards")
      .update({ tabs: cfg.tabs as never, active_tab_id: cfg.activeTabId })
      .eq("user_id", userId);
    return { ok: !error };
  }, [userId]);

  const flushPendingSave = useCallback(() => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const scheduleSave = useCallback((cfg: DashboardConfig) => {
    flushPendingSave();
    saveTimer.current = window.setTimeout(() => { void persist(cfg); }, SAVE_DEBOUNCE_MS);
  }, [persist, flushPendingSave]);

  /** Mutate config locally + debounce a save. */
  const update = useCallback((mutator: (prev: DashboardConfig) => DashboardConfig) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = mutator(prev);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  /** Tab switch — saved immediately (cheap). */
  const setActiveTab = useCallback((tabId: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = { ...prev, activeTabId: tabId };
      void persist(next);
      return next;
    });
  }, [persist]);

  const addTab = useCallback((name: string, template: TemplateId = "grid-2x2") => {
    update((prev) => {
      if (prev.tabs.length >= MAX_TABS) return prev;
      const tab: Tab = { id: shortId(), name: name.slice(0, 24) || "Tab", template, widgets: emptyWidgetsFor(template) };
      return { tabs: [...prev.tabs, tab], activeTabId: tab.id };
    });
  }, [update]);

  const renameTab = useCallback((tabId: string, name: string) => {
    update((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, name: name.slice(0, 24) || t.name } : t)),
    }));
  }, [update]);

  const deleteTab = useCallback((tabId: string) => {
    update((prev) => {
      if (prev.tabs.length <= 1) return prev;
      const tabs = prev.tabs.filter((t) => t.id !== tabId);
      const activeTabId = prev.activeTabId === tabId ? tabs[0].id : prev.activeTabId;
      return { tabs, activeTabId };
    });
  }, [update]);

  const duplicateTab = useCallback((tabId: string) => {
    update((prev) => {
      if (prev.tabs.length >= MAX_TABS) return prev;
      const src = prev.tabs.find((t) => t.id === tabId);
      if (!src) return prev;
      const baseName = src.name.replace(/\s*\(copy(?: \d+)?\)$/i, "");
      let name = `${baseName} (copy)`;
      let n = 2;
      while (prev.tabs.some((t) => t.name === name)) {
        name = `${baseName} (copy ${n++})`;
      }
      const copy: Tab = {
        id: shortId(),
        name: name.slice(0, 24),
        template: src.template,
        widgets: src.widgets.map((w) => (w ? { ...w, id: shortId() } : null)),
      };
      const idx = prev.tabs.findIndex((t) => t.id === tabId);
      const tabs = prev.tabs.slice();
      tabs.splice(idx + 1, 0, copy);
      return { tabs, activeTabId: copy.id };
    });
  }, [update]);

  const reorderTab = useCallback((fromId: string, toId: string) => {
    update((prev) => {
      const from = prev.tabs.findIndex((t) => t.id === fromId);
      const to = prev.tabs.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const tabs = prev.tabs.slice();
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { ...prev, tabs };
    });
  }, [update]);

  const setTemplate = useCallback((tabId: string, template: TemplateId) => {
    update((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const slotCount = TEMPLATES[template].slots.length;
        const widgets = Array.from({ length: slotCount }).map((_, i) => t.widgets[i] ?? null);
        return { ...t, template, widgets };
      }),
    }));
  }, [update]);

  const setSlotWidget = useCallback((tabId: string, slotIndex: number, widget: Widget | null) => {
    update((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const widgets = t.widgets.slice();
        widgets[slotIndex] = widget;
        return { ...t, widgets };
      }),
    }));
  }, [update]);

  /**
   * Swap (or move-into-empty) two slots within the same tab.
   * Persists immediately and reverts the local state if the server rejects it,
   * so positions stay consistent across reloads.
   */
  const swapSlots = useCallback((tabId: string, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setConfig((prev) => {
      if (!prev) return prev;
      const tab = prev.tabs.find((t) => t.id === tabId);
      if (!tab) return prev;
      if (fromIndex >= tab.widgets.length || toIndex >= tab.widgets.length) return prev;

      const snapshot = prev;
      const next: DashboardConfig = {
        ...prev,
        tabs: prev.tabs.map((t) => {
          if (t.id !== tabId) return t;
          const widgets = t.widgets.slice();
          const tmp = widgets[fromIndex];
          widgets[fromIndex] = widgets[toIndex];
          widgets[toIndex] = tmp;
          return { ...t, widgets };
        }),
      };

      // Cancel any debounced save so it can't overwrite our immediate persist
      // (and so a stale earlier state isn't pushed after the swap).
      flushPendingSave();
      void (async () => {
        const { ok } = await persist(next);
        if (!ok) {
          setConfig(snapshot);
          toast.error("Couldn't save widget swap — reverted");
        }
      })();

      return next;
    });
  }, [persist, flushPendingSave]);


  /** Reset a tab back to the default template + seeded widgets. Keeps tab id and name. */
  const resetTab = useCallback((tabId: string) => {
    update((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === tabId
          ? { ...t, template: DEFAULT_TAB_TEMPLATE, widgets: defaultTabWidgets() }
          : t,
      ),
    }));
  }, [update]);

  return {
    config, loaded, userId, MAX_TABS,
    setActiveTab, addTab, renameTab, deleteTab, duplicateTab, reorderTab, setTemplate, setSlotWidget, swapSlots, resetTab,
    newWidgetId: shortId,
  };
}
