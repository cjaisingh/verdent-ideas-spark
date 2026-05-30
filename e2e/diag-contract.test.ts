// Validates that the worked examples in
// docs/e2e-diag-redaction-contract.md actually match the behaviour of
// e2e/diag.ts (redact / scrubString) and scripts/scrub-e2e-logs.ts.
//
// If the doc and the code drift apart, this test fails — forcing the
// author to update one side or the other before merge.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { __testing__, emitDiag, E2E_DIAG_PREFIX } from "./diag";

const { redact, scrubString, keyLooksSensitive } = __testing__;

const DOC_PATH = join(__dirname, "..", "docs", "e2e-diag-redaction-contract.md");
const SCRUB_SCRIPT = join(__dirname, "..", "scripts", "scrub-e2e-logs.ts");

interface Example {
  title: string;
  blocks: { lang: string; body: string }[];
}

function parseExamples(md: string): Example[] {
  const examples: Example[] = [];
  // Split on "### Example" headings.
  const parts = md.split(/^### Example /m).slice(1);
  for (const part of parts) {
    const firstLine = part.split("\n", 1)[0];
    const title = firstLine.trim();
    const blocks: { lang: string; body: string }[] = [];
    const blockRe = /```([a-zA-Z0-9]*)\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(part)) !== null) {
      blocks.push({ lang: m[1], body: m[2] });
    }
    examples.push({ title, blocks });
  }
  return examples;
}

let examples: Example[] = [];

beforeAll(() => {
  expect(existsSync(DOC_PATH), `missing ${DOC_PATH}`).toBe(true);
  const md = readFileSync(DOC_PATH, "utf8");
  examples = parseExamples(md);
});

describe("redaction contract — doc examples match e2e/diag.ts", () => {
  it("doc parses into the expected three examples", () => {
    expect(examples).toHaveLength(3);
    expect(examples[0].title).toMatch(/attempted_row with a secret key/i);
    expect(examples[1].title).toMatch(/Bearer token/i);
    expect(examples[2].title).toMatch(/raw\.log defence-in-depth/i);
  });

  it("Example 1: redact(before) deep-equals after", () => {
    const ex = examples[0];
    const jsonBlocks = ex.blocks.filter((b) => b.lang === "json");
    expect(jsonBlocks.length).toBeGreaterThanOrEqual(2);
    const before = JSON.parse(jsonBlocks[0].body);
    const after = JSON.parse(jsonBlocks[1].body);
    expect(redact(before)).toEqual(after);
  });

  it("Example 2: scrubString(before) equals after for Bearer/JWT line", () => {
    const ex = examples[1];
    // Both blocks are untagged ``` … ``` text blocks.
    expect(ex.blocks.length).toBeGreaterThanOrEqual(2);
    const before = ex.blocks[0].body.trimEnd();
    const after = ex.blocks[1].body.trimEnd();
    expect(scrubString(before)).toBe(after);
  });
});

describe("redaction contract — emitDiag wraps payload and redacts", () => {
  it("Example 1 round-trips through emitDiag's JSON output", () => {
    const ex = examples[0];
    const before = JSON.parse(ex.blocks.filter((b) => b.lang === "json")[0].body);
    const after = JSON.parse(ex.blocks.filter((b) => b.lang === "json")[1].body);

    let captured = "";
    const origErr = console.error;
    console.error = (msg: unknown) => {
      captured = String(msg);
    };
    try {
      emitDiag({
        event: "contract_test",
        test_file: "e2e/diag-contract.test.ts",
        attempted_row: before.attempted_row,
      });
    } finally {
      console.error = origErr;
    }

    expect(captured.startsWith(E2E_DIAG_PREFIX)).toBe(true);
    const json = JSON.parse(captured.slice(E2E_DIAG_PREFIX.length));
    expect(json.attempted_row).toEqual(after.attempted_row);
  });
});

describe("redaction contract — scripts/scrub-e2e-logs.ts honours Example 3", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "scrub-e2e-"));

    const ex3 = examples[2];
    expect(ex3.blocks.length).toBeGreaterThanOrEqual(2);
    const rawBefore = ex3.blocks[0].body.trimEnd();

    writeFileSync(join(tmp, "raw.log"), rawBefore + "\n", "utf8");

    // Also exercise the jsonl path with a payload that has both a sensitive
    // key and a sensitive value, mirroring the contract.
    const jsonlIn = JSON.stringify({
      event: "leak_in_jsonl",
      test_file: "x",
      attempted_row: { api_key: "sk-ABCDEFGHIJKLMNOPQRSTUVWX", note: "fine" },
      message: "header Authorization: Bearer abcdefghijklmnop tail",
    });
    writeFileSync(join(tmp, "diagnostics.jsonl"), jsonlIn + "\n", "utf8");

    const result = spawnSync("bun", [SCRUB_SCRIPT, tmp], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      throw new Error(
        `scrub-e2e-logs.ts failed (${result.status}): ${result.stderr || result.stdout}`,
      );
    }
  });

  it("rewrites raw.log to match Example 3 'After'", () => {
    const ex3 = examples[2];
    const expected = ex3.blocks[1].body.trimEnd();
    const got = readFileSync(join(tmp, "raw.log"), "utf8").trimEnd();
    expect(got).toBe(expected);
  });

  it("re-redacts diagnostics.jsonl: sensitive key + Bearer value gone", () => {
    const got = readFileSync(join(tmp, "diagnostics.jsonl"), "utf8").trim();
    const obj = JSON.parse(got);
    expect(obj.attempted_row.api_key).toBe("[REDACTED]");
    expect(obj.attempted_row.note).toBe("fine");
    expect(obj.message).toContain("Bearer [REDACTED]");
    // No raw secret material survived.
    expect(got).not.toContain("sk-ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(got).not.toContain("abcdefghijklmnop");
  });
});

describe("redaction contract — key-pattern table examples all flagged", () => {
  // The doc's key-pattern table lists example key names; every one of them
  // must be detected as sensitive. Kept in sync with the table by hand —
  // adding a row to the doc requires adding it here.
  const KEYS_FROM_DOC = [
    "password", "passphrase", "pass",
    "secret", "client_secret", "shared_secret",
    "token", "auth_token", "refresh_token",
    "api_key", "apiKey",
    "authorization", "authorized",
    "bearer", "bearer_token",
    "cookie", "session_cookie",
    "session", "session_id",
    "private_key", "privateKey",
    "service_role", "service_role_key",
    "anon_key", "anonKey",
    "access_key", "accessKey",
    "refreshToken",
    "signature", "request_signature",
    "otp",
    "pin",
  ];
  const ALLOWED_FROM_DOC = [
    "id", "name", "surface_kind", "tag", "owner",
    "created_at", "status", "score", "matched_kinds",
    "band_thresholds_snapshot",
  ];

  it.each(KEYS_FROM_DOC)("flags %s as sensitive", (k) => {
    expect(keyLooksSensitive(k)).toBe(true);
  });

  it.each(ALLOWED_FROM_DOC)("allows %s", (k) => {
    expect(keyLooksSensitive(k)).toBe(false);
  });
});

describe("redaction contract — value-pattern table samples all scrubbed", () => {
  const SAMPLES: { name: string; input: string; expected: string }[] = [
    {
      name: "JWT",
      input: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.abcDEFghiJKLmno",
      expected: "[REDACTED_JWT]",
    },
    {
      name: "Supabase key",
      input: "sbp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
      expected: "[REDACTED_SUPABASE_KEY]",
    },
    {
      name: "Bearer header",
      input: "Bearer abcdefghijklmnopqrstuv",
      expected: "Bearer [REDACTED]",
    },
    {
      name: "sk- API key",
      input: "sk-ABCDEFGHIJKLMNOPQRSTUVWX",
      expected: "[REDACTED_API_KEY]",
    },
    {
      name: "Telegram token",
      input: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef-_",
      expected: "[REDACTED_TELEGRAM_TOKEN]",
    },
    {
      name: "GitHub PAT",
      input: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      expected: "[REDACTED_GITHUB_TOKEN]",
    },
    {
      name: "long hex",
      input: "a".repeat(40),
      expected: "[REDACTED_HEX]",
    },
  ];

  it.each(SAMPLES)("scrubs $name", ({ input, expected }) => {
    expect(scrubString(input)).toContain(expected);
    // And the raw secret material does not survive.
    expect(scrubString(input)).not.toContain(input);
  });

  it("leaves short plain values untouched", () => {
    for (const safe of ["rpc", "e2e", "owner", "42", "true", "resolve_entity_logged"]) {
      expect(scrubString(safe)).toBe(safe);
    }
  });
});
