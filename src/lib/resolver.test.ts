import { describe, it, expect } from "vitest";
import { bandFor, isMonotonic, type BandThresholds } from "./resolver";

const T: BandThresholds = { auto_bind: 0.95, conflict: 0.6, no_match: 0 };

describe("resolver.bandFor", () => {
  it("auto_bind at and above cutoff", () => {
    expect(bandFor(0.95, T)).toBe("auto_bind");
    expect(bandFor(1.0, T)).toBe("auto_bind");
  });
  it("conflict band between cutoffs", () => {
    expect(bandFor(0.6, T)).toBe("conflict");
    expect(bandFor(0.94, T)).toBe("conflict");
  });
  it("no_match below conflict", () => {
    expect(bandFor(0.59, T)).toBe("no_match");
    expect(bandFor(0, T)).toBe("no_match");
  });
});

describe("resolver.isMonotonic", () => {
  it("accepts strict decreasing", () => {
    expect(isMonotonic({ auto_bind: 0.9, conflict: 0.5, no_match: 0 })).toBe(true);
  });
  it("rejects equal bands", () => {
    expect(isMonotonic({ auto_bind: 0.6, conflict: 0.6, no_match: 0 })).toBe(false);
  });
  it("rejects inverted bands", () => {
    expect(isMonotonic({ auto_bind: 0.5, conflict: 0.6, no_match: 0 })).toBe(false);
  });
  it("rejects out-of-range", () => {
    expect(isMonotonic({ auto_bind: 1.5, conflict: 0.5, no_match: 0 })).toBe(false);
    expect(isMonotonic({ auto_bind: 0.9, conflict: 0.5, no_match: -0.1 })).toBe(false);
  });
});
