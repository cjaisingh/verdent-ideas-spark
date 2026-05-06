import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, operatorClient, requireEnv } from "./helpers";

beforeAll(() => requireEnv());

describe("auth", () => {
  it("operator can sign in with password", async () => {
    const { accessToken, userId } = await operatorClient();
    expect(accessToken).toMatch(/^ey/); // JWT
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects bad password", async () => {
    const c = anonClient();
    const { error } = await c.auth.signInWithPassword({
      email: process.env.E2E_OPERATOR_EMAIL!,
      password: "definitely-not-the-password-" + Date.now(),
    });
    expect(error).not.toBeNull();
  });

  it("anonymous session has no user", async () => {
    const c = anonClient();
    const { data } = await c.auth.getSession();
    expect(data.session).toBeNull();
  });
});
