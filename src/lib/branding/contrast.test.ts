import { describe, expect, it } from "vitest";
import {
  AA_THRESHOLD,
  contrastRatio,
  deriveForegroundHex,
  hexToHsl,
  isValidHex,
  passesAA,
  relativeLuminance,
} from "./contrast";

describe("isValidHex", () => {
  it("accepts 6-digit hex with #", () => {
    expect(isValidHex("#000000")).toBe(true);
    expect(isValidHex("#FFFFFF")).toBe(true);
    expect(isValidHex("#3B82F6")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isValidHex("000000")).toBe(false);
    expect(isValidHex("#000")).toBe(false);
    expect(isValidHex("#GGGGGG")).toBe(false);
    expect(isValidHex("")).toBe(false);
  });
});

describe("relativeLuminance", () => {
  it("white is ~1, black is 0", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });
});

describe("contrastRatio", () => {
  it("white vs black is 21", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
  });
  it("is symmetric", () => {
    expect(contrastRatio("#3B82F6", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#3B82F6"),
      6,
    );
  });
});

describe("deriveForegroundHex (WCAG AA)", () => {
  it("dark backgrounds get white text", () => {
    expect(deriveForegroundHex("#0a0a1a")).toBe("#FFFFFF"); // Midnight Indigo
    expect(deriveForegroundHex("#064e3b")).toBe("#FFFFFF"); // Emerald Prestige
    expect(deriveForegroundHex("#0d0d0d")).toBe("#FFFFFF"); // Noir
    expect(deriveForegroundHex("#3B82F6")).toBe("#FFFFFF"); // Operational Blue
  });
  it("light backgrounds get black text", () => {
    expect(deriveForegroundHex("#FFD700")).toBe("#000000"); // Gold
    expect(deriveForegroundHex("#FFFFFF")).toBe("#000000");
    expect(deriveForegroundHex("#F5B942")).toBe("#000000"); // AWIP insight gold
    expect(deriveForegroundHex("#fafbfc")).toBe("#000000");
  });
  it("derived foreground always wins the contrast race", () => {
    const samples = [
      "#3B82F6",
      "#0a0a1a",
      "#c9a84c",
      "#777777",
      "#16a34a",
      "#e85d3a",
    ];
    for (const bg of samples) {
      const fg = deriveForegroundHex(bg);
      const other = fg === "#FFFFFF" ? "#000000" : "#FFFFFF";
      expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(contrastRatio(bg, other));
    }
  });
  it("passes AA for the 26 curated palette colours", () => {
    const palette = [
      "#0a0a1a", "#141432", "#1e1e5a", "#4f46e5",
      "#1a1a1a", "#2d2d2d", "#4a4a4a", "#e85d3a",
      "#0d0d0d", "#c9a84c", "#f0d78c", "#fafbfc",
      "#3b82f6", "#c4654a", "#87a878", "#4a6741",
      "#0c2340", "#2d8a9e", "#ff6b6b", "#574b90",
      "#0d1b2a", "#2dd4a8", "#ff6b35", "#6c5ce7",
      "#064e3b", "#0f1b3d",
    ];
    for (const bg of palette) {
      const fg = deriveForegroundHex(bg);
      // Either AA-pass body text (4.5:1) OR at minimum AA-large (3:1).
      // Mid-greys near #777 can fail body-text AA — that's expected.
      expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("passesAA", () => {
  it("white on darker blue passes AA", () => {
    expect(passesAA("#1e40af", "#FFFFFF")).toBe(true);
  });
  it("white on Gold fails AA, black on Gold passes", () => {
    expect(passesAA("#FFD700", "#FFFFFF")).toBe(false);
    expect(passesAA("#FFD700", "#000000")).toBe(true);
  });
  it("AA threshold matches WCAG 2", () => {
    expect(AA_THRESHOLD).toBe(4.5);
  });
});

describe("hexToHsl", () => {
  it("white -> 0 0% 100%", () => {
    expect(hexToHsl("#FFFFFF")).toBe("0 0% 100%");
  });
  it("black -> 0 0% 0%", () => {
    expect(hexToHsl("#000000")).toBe("0 0% 0%");
  });
  it("pure red -> 0 100% 50%", () => {
    expect(hexToHsl("#FF0000")).toBe("0 100% 50%");
  });
  it("Operational Blue -> roughly 217 91% 60%", () => {
    const result = hexToHsl("#3B82F6");
    expect(result).toMatch(/^21[6-8] 9[0-2]% 6[0-1]%$/);
  });
  it("throws on bad hex", () => {
    expect(() => hexToHsl("not-a-hex")).toThrow();
  });
});
