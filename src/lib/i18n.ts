// Lightweight in-house i18n. No external dependencies.
//
// Usage:
//   const t = useT();
//   t("awipCore.tooltip");
//
// Locale is auto-detected from navigator.language at module load and can be
// overridden by setting `localStorage["awip.locale"]` to one of the SUPPORTED_LOCALES.
//
// To add a new string: add a key to every dictionary below. Missing keys fall
// back to the English value, then to the key itself.

import { useSyncExternalStore } from "react";

export const SUPPORTED_LOCALES = ["en", "de", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

type Dict = Record<string, string>;

const dictionaries: Record<Locale, Dict> = {
  en: {
    "awipCore.tooltip": "Tenants · /tenants",
    "awipCore.ariaLabel": "AWIP Core — go to Tenants (/tenants)",
  },
  de: {
    "awipCore.tooltip": "Mandanten · /tenants",
    "awipCore.ariaLabel": "AWIP Core — zu Mandanten wechseln (/tenants)",
  },
  fr: {
    "awipCore.tooltip": "Locataires · /tenants",
    "awipCore.ariaLabel": "AWIP Core — aller aux Locataires (/tenants)",
  },
};

const STORAGE_KEY = "awip.locale";

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || "en").toLowerCase().split("-")[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(nav) ? (nav as Locale) : "en";
}

let currentLocale: Locale = detectLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return;
  currentLocale = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function t(key: string, locale: Locale = currentLocale): string {
  return dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
}

export function useT(): (key: string) => string {
  const locale = useSyncExternalStore(subscribe, getLocale, () => "en" as Locale);
  return (key: string) => t(key, locale);
}
