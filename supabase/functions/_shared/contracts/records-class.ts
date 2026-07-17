// W10-S1 — deterministic records classifier.
//
// Maps a file (name + mime + optional declared discipline) to a records_class
// with NO LLM call. This is the default path; LLM assist for the 'other'
// bucket is an operator-toggled follow-up (spec S1). Keep this pure and
// unit-tested — it is the single source of truth for classification, mirrored
// by the records_class enum in migration 20260717150000.

export const RECORDS_CLASSES = [
  "contract",
  "certificate",
  "register",
  "model",
  "drawing",
  "correspondence",
  "media",
  "other",
] as const;
export type RecordsClass = (typeof RECORDS_CLASSES)[number];

// Extension → class for unambiguous types.
const EXT_CLASS: Record<string, RecordsClass> = {
  // drawings / 2D CAD
  dwg: "drawing", dxf: "drawing", dgn: "drawing",
  // 3D / BIM models
  rvt: "model", rfa: "model", rte: "model", ifc: "model", ifczip: "model",
  nwc: "model", nwd: "model", nwf: "model", skp: "model",
  step: "model", stp: "model", iges: "model", igs: "model",
  "3ds": "model", obj: "model", fbx: "model", gltf: "model", glb: "model",
  pln: "model", gsm: "model",
  // media
  png: "media", jpg: "media", jpeg: "media", tiff: "media", tif: "media",
  gif: "media", bmp: "media", svg: "media", mp4: "media", mov: "media",
  avi: "media", mkv: "media", mp3: "media", wav: "media", m4a: "media",
  // correspondence
  eml: "correspondence", msg: "correspondence",
  // registers / tabular
  csv: "register", xlsx: "register", xls: "register", xlsm: "register",
};

// Filename keyword → class (checked after extension, before mime). Order matters:
// more specific/consequential classes first.
const KEYWORD_CLASS: Array<[RegExp, RecordsClass]> = [
  [/\b(contract|agreement|sla|mou|nda|lease|tender|purchase\s*order|\bpo\b)\b/i, "contract"],
  [/\b(certificate|cert|accreditation|compliance\s*cert|eicr|gas\s*safe|f-?gas|calibration)\b/i, "certificate"],
  [/\b(register|asset\s*list|inventory|schedule\s*of|log\b|ppm\s*schedule)\b/i, "register"],
  [/\b(drawing|dwg|floor\s*plan|ga\b|layout|elevation|section|as-?built|sketch)\b/i, "drawing"],
  [/\b(model|bim|revit|ifc|navisworks)\b/i, "model"],
  [/\b(email|letter|memo|minutes|correspondence|rfi\b|re:|fw:)\b/i, "correspondence"],
];

const MIME_CLASS: Array<[RegExp, RecordsClass]> = [
  [/^image\//i, "media"],
  [/^audio\//i, "media"],
  [/^video\//i, "media"],
  [/^message\/rfc822$/i, "correspondence"],
  [/vnd\.ms-outlook/i, "correspondence"],
  [/spreadsheet|ms-excel/i, "register"],
];

// Declared discipline is a strong hint for drawings/models when present.
const DISCIPLINE_CLASS: Array<[RegExp, RecordsClass]> = [
  [/\b(architectural|structural|mechanical|electrical|mep|civil|drainage)\b/i, "drawing"],
];

function extensionOf(filename: string): string {
  const base = filename.toLowerCase().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1) : "";
}

export function classifyRecordsClass(
  filename: string,
  mime?: string | null,
  declaredDiscipline?: string | null,
): RecordsClass {
  const ext = extensionOf(filename);

  // 1) unambiguous extension wins for CAD/model/media/register binaries.
  const byExt = EXT_CLASS[ext];
  if (byExt && byExt !== "register") return byExt; // register ext is weak — let keywords refine below

  // 2) filename keywords (most consequential first).
  for (const [re, cls] of KEYWORD_CLASS) {
    if (re.test(filename)) return cls;
  }

  // 3) weak register extension (csv/xlsx) falls through to here if no keyword hit.
  if (byExt) return byExt;

  // 4) declared discipline hint.
  if (declaredDiscipline) {
    for (const [re, cls] of DISCIPLINE_CLASS) {
      if (re.test(declaredDiscipline)) return cls;
    }
  }

  // 5) mime family.
  if (mime) {
    for (const [re, cls] of MIME_CLASS) {
      if (re.test(mime)) return cls;
    }
  }

  // 6) default bucket (LLM assist is an operator-toggled follow-up).
  return "other";
}
