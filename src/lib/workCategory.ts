// Shared definitions for the work_category enum.
export const WORK_CATEGORIES = [
  "plan", "build", "pivot", "refactor", "bugfix", "research", "ops", "other",
] as const;
export type WorkCategory = typeof WORK_CATEGORIES[number];

// Tailwind chip classes per category — uses semantic tokens so dark mode works.
export const CATEGORY_CHIP: Record<WorkCategory, string> = {
  plan:     "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  build:    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  pivot:    "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  refactor: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30",
  bugfix:   "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
  research: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
  ops:      "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
  other:    "bg-muted text-muted-foreground border-border",
};

export function categoryChip(c: string): string {
  return CATEGORY_CHIP[c as WorkCategory] ?? CATEGORY_CHIP.other;
}
