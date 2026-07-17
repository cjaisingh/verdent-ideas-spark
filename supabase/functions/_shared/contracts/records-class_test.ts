// W10-S1 — deterministic records classifier unit tests.
// Locks the class map so the enum in migration 20260717150000 and the runtime
// classifier stay in lockstep.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyRecordsClass, RECORDS_CLASSES } from "./records-class.ts";

Deno.test("CAD/model extensions classify as drawing or model", () => {
  assertEquals(classifyRecordsClass("BlockA-GA.dwg"), "drawing");
  assertEquals(classifyRecordsClass("plant.dxf"), "drawing");
  assertEquals(classifyRecordsClass("estate.ifc"), "model");
  assertEquals(classifyRecordsClass("tower.rvt"), "model");
});

Deno.test("media by extension and by mime", () => {
  assertEquals(classifyRecordsClass("site-photo.jpg"), "media");
  assertEquals(classifyRecordsClass("walkthrough.mp4"), "media");
  assertEquals(classifyRecordsClass("scan", "image/png"), "media");
});

Deno.test("correspondence by extension, keyword, and mime", () => {
  assertEquals(classifyRecordsClass("thread.eml"), "correspondence");
  assertEquals(classifyRecordsClass("RE: boiler fault.pdf"), "correspondence");
  assertEquals(classifyRecordsClass("note", "message/rfc822"), "correspondence");
});

Deno.test("contracts and certificates win on filename keywords", () => {
  assertEquals(classifyRecordsClass("Cleaning Services Agreement.pdf"), "contract");
  assertEquals(classifyRecordsClass("Purchase Order 4471.pdf"), "contract");
  assertEquals(classifyRecordsClass("EICR Certificate 2026.pdf"), "certificate");
  assertEquals(classifyRecordsClass("Gas Safe cert.pdf"), "certificate");
});

Deno.test("registers: weak spreadsheet ext refines to a keyword when present", () => {
  // plain spreadsheet → register
  assertEquals(classifyRecordsClass("asset-data.xlsx"), "register");
  // spreadsheet whose name signals a contract schedule still reads as register
  // only if no stronger keyword; an asset register name stays register.
  assertEquals(classifyRecordsClass("Asset Register.xlsx"), "register");
  // a contract-named spreadsheet promotes to contract (keyword beats weak ext)
  assertEquals(classifyRecordsClass("Lease Agreement.xlsx"), "contract");
});

Deno.test("declared discipline hints a drawing", () => {
  assertEquals(classifyRecordsClass("sheet-01.pdf", "application/pdf", "Structural"), "drawing");
});

Deno.test("unknown falls back to other, and is a valid enum member", () => {
  const c = classifyRecordsClass("readme.pdf");
  assertEquals(c, "other");
  assertEquals(RECORDS_CLASSES.includes(c), true);
});
