import { test, expect } from "./fixtures/auth";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL ?? "";
const OPERATOR_PASSWORD = process.env.E2E_OPERATOR_PASSWORD ?? "";

async function seedLesson(title: string) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const dedupe = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await sb
    .from("lessons" as any)
    .insert({
      title,
      category: "qa",
      severity: "low",
      recommendation: "Playwright e2e seeded lesson — safe to delete.",
      status: "proposed",
      dedupe_key: dedupe,
      evidence: [],
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedLesson failed: ${error.message}`);
  return { id: (data as any).id as string, dedupe };
}

async function deleteLesson(id: string) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  await sb.from("lessons" as any).delete().eq("id", id);
}

async function readStatus(id: string) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const { data, error } = await sb.from("lessons" as any).select("status").eq("id", id).single();
  if (error) throw new Error(error.message);
  return (data as any).status as string;
}

test.describe("/admin/lessons apply/defer/reject flows", () => {
  test.beforeEach(() => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY || !OPERATOR_EMAIL || !OPERATOR_PASSWORD,
      "E2E credentials not configured",
    );
  });

  for (const action of ["Apply", "Defer", "Reject"] as const) {
    test(`${action} transitions a proposed lesson`, async ({ authedPage }) => {
      const title = `E2E ${action} ${Date.now()}`;
      const expected = action.toLowerCase() === "apply" ? "applied"
                     : action.toLowerCase() === "defer" ? "deferred" : "rejected";
      const seeded = await seedLesson(title);
      try {
        await authedPage.goto("/admin/lessons");
        // Ensure we're on the Proposed tab (default)
        const proposedTab = authedPage.getByRole("tab", { name: /proposed/i });
        if (await proposedTab.count()) await proposedTab.click();

        const card = authedPage.locator("div").filter({ hasText: title }).first();
        await expect(card).toBeVisible({ timeout: 10_000 });

        await card.getByRole("button", { name: new RegExp(`^${action}$`, "i") }).click();

        // Optimistic toast
        await expect(
          authedPage.locator("[data-sonner-toast], [role=status]").filter({ hasText: new RegExp(expected, "i") }).first(),
        ).toBeVisible({ timeout: 8_000 });

        // Verify in DB
        await expect.poll(() => readStatus(seeded.id), { timeout: 10_000 }).toBe(expected);
      } finally {
        await deleteLesson(seeded.id);
      }
    });
  }
});
