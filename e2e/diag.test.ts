import { describe, expect, it } from "vitest";
import { __testing__ } from "./diag";

const { redact, scrubString, keyLooksSensitive } = __testing__;

describe("e2e/diag redaction", () => {
  it("flags sensitive key names", () => {
    for (const k of [
      "password",
      "passphrase",
      "api_key",
      "apiKey",
      "authorization",
      "Cookie",
      "supabase_service_role_key",
      "anon_key",
      "refresh_token",
      "private_key",
      "session",
      "otp",
      "pin",
    ]) {
      expect(keyLooksSensitive(k), k).toBe(true);
    }
    for (const k of ["id", "name", "surface_kind", "tag", "owner"]) {
      expect(keyLooksSensitive(k), k).toBe(false);
    }
  });

  it("scrubs JWTs from free-form strings", () => {
    const s =
      "failed with token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.abcDEF_-1234567890xyz tail";
    const out = scrubString(s);
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toContain("[REDACTED_JWT]");
    expect(out).toContain("tail");
  });

  it("scrubs Bearer headers and sk- API keys", () => {
    expect(scrubString("Authorization: Bearer abcDEFghi123456789xyz")).toContain(
      "Bearer [REDACTED]",
    );
    expect(scrubString("openai sk-ABCDEFGHIJKLMNOPQRSTUVWX")).toContain(
      "[REDACTED_API_KEY]",
    );
  });

  it("scrubs Telegram + GitHub tokens", () => {
    expect(
      scrubString("tg 1234567890:AAEhBOweik6ad6PsVCHtomXyz0123456789"),
    ).toContain("[REDACTED_TELEGRAM_TOKEN]");
    expect(scrubString("ghp_" + "a".repeat(36))).toContain(
      "[REDACTED_GITHUB_TOKEN]",
    );
  });

  it("recursively redacts sensitive keys in nested rows", () => {
    const row = {
      surface_kind: "rpc",
      owner: "e2e",
      payload: {
        password: "hunter2",
        nested: { api_key: "abc", note: "fine" },
        list: [{ token: "shhh" }, "Bearer abcdefghij1234567890"],
      },
    };
    const out = redact(row) as Record<string, unknown>;
    expect(out.surface_kind).toBe("rpc");
    const payload = out.payload as Record<string, unknown>;
    expect(payload.password).toBe("[REDACTED]");
    const nested = payload.nested as Record<string, unknown>;
    expect(nested.api_key).toBe("[REDACTED]");
    expect(nested.note).toBe("fine");
    const list = payload.list as unknown[];
    expect((list[0] as Record<string, unknown>).token).toBe("[REDACTED]");
    expect(list[1]).toContain("Bearer [REDACTED]");
  });

  it("never leaks the literal SUPABASE_SERVICE_ROLE_KEY env value", () => {
    const sample =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpayloadpayload.signaturesignaturesignature";
    const out = scrubString(`role-key=${sample} after`);
    expect(out).not.toContain(sample);
  });
});
