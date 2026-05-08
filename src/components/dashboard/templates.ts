import type { TemplateId, TemplateSlot } from "./widgets/types";

/**
 * Bento templates. Each template defines its slot count, sizes, and the
 * tailwind grid classes for the wrapper + each slot.
 *
 * Wrapper grids assume a 4-column / 4-row base on desktop; widgets are
 * positioned via `col-span` / `row-span` per slot.
 */
export const TEMPLATES: Record<
  TemplateId,
  { id: TemplateId; label: string; description: string; gridClass: string; slots: TemplateSlot[] }
> = {
  "grid-2x2": {
    id: "grid-2x2",
    label: "2 × 2",
    description: "Four equal panels",
    gridClass: "grid grid-cols-2 grid-rows-2 gap-3",
    slots: [
      { size: "md", className: "" },
      { size: "md", className: "" },
      { size: "md", className: "" },
      { size: "md", className: "" },
    ],
  },
  "one-plus-three": {
    id: "one-plus-three",
    label: "1 + 3",
    description: "One hero, three side panels",
    gridClass: "grid grid-cols-4 grid-rows-3 gap-3",
    slots: [
      { size: "lg", className: "col-span-3 row-span-3" },
      { size: "sm", className: "col-span-1 row-span-1" },
      { size: "sm", className: "col-span-1 row-span-1" },
      { size: "sm", className: "col-span-1 row-span-1" },
    ],
  },
  "hero-strip": {
    id: "hero-strip",
    label: "Hero + strip",
    description: "Wide hero on top, four small below",
    gridClass: "grid grid-cols-4 grid-rows-2 gap-3",
    slots: [
      { size: "lg", className: "col-span-4 row-span-1" },
      { size: "sm", className: "col-span-1 row-span-1" },
      { size: "sm", className: "col-span-1 row-span-1" },
      { size: "sm", className: "col-span-1 row-span-1" },
      { size: "sm", className: "col-span-1 row-span-1" },
    ],
  },
  "dense-six": {
    id: "dense-six",
    label: "Dense 6",
    description: "Six equal small panels",
    gridClass: "grid grid-cols-3 grid-rows-2 gap-3",
    slots: [
      { size: "sm", className: "" },
      { size: "sm", className: "" },
      { size: "sm", className: "" },
      { size: "sm", className: "" },
      { size: "sm", className: "" },
      { size: "sm", className: "" },
    ],
  },
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);
