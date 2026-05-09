import { test, expect } from "./fixtures/auth";

test.describe("/morning-review", () => {
  test("loads today's review and shows KPI tiles", async ({ authedPage }) => {
    await authedPage.goto("/morning-review");
    await expect(authedPage.getByRole("heading", { name: /morning review/i })).toBeVisible();
    // KPI tile labels rendered by the page
    await expect(authedPage.getByText(/automation success/i)).toBeVisible();
    await expect(authedPage.getByText(/stuck jobs/i)).toBeVisible();
  });

  test("Acknowledge or empty-state is reachable", async ({ authedPage }) => {
    await authedPage.goto("/morning-review");
    const ack = authedPage.getByRole("button", { name: /acknowledge/i });
    const acked = authedPage.getByText(/acknowledged/i);
    // Either the button is shown (not yet acknowledged) or the badge is shown.
    await expect(ack.or(acked).first()).toBeVisible();
  });

  test("Mirror buttons trigger toast when present", async ({ authedPage }) => {
    await authedPage.goto("/morning-review");
    const mirror = authedPage.getByRole("button", { name: /mirror/i }).first();
    if (await mirror.count()) {
      await mirror.click();
      // toast either success or auth-related error — we just assert UI responded
      await expect(authedPage.locator("[data-sonner-toast], [role=status]")).toBeVisible({
        timeout: 5_000,
      });
    } else {
      test.info().annotations.push({ type: "note", description: "No mirror-able findings today" });
    }
  });
});
