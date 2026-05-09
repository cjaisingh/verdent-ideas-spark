import { test, expect } from "./fixtures/auth";

test.describe("/roadmap", () => {
  test("renders roadmap with sentinel strip", async ({ authedPage }) => {
    await authedPage.goto("/roadmap");
    await expect(authedPage.getByRole("heading", { name: /roadmap/i }).first()).toBeVisible();
    // SentinelStatusStrip card title
    await expect(authedPage.getByText(/sentinel agent/i)).toBeVisible();
  });

  test("Sentinel 'Tick now' button is wired and responds", async ({ authedPage }) => {
    await authedPage.goto("/roadmap");
    const tick = authedPage.getByRole("button", { name: /tick now/i });
    await expect(tick).toBeVisible();
    await tick.click();
    // Either a toast appears or the spinner shows briefly
    const toast = authedPage.locator("[data-sonner-toast], [role=status]");
    const spinner = authedPage.locator(".animate-spin").first();
    await expect(toast.or(spinner).first()).toBeVisible({ timeout: 8_000 });
  });

  test("severity legend renders all five buckets", async ({ authedPage }) => {
    await authedPage.goto("/roadmap");
    for (const sev of ["critical", "high", "medium", "low", "info"]) {
      await expect(authedPage.getByText(new RegExp(`${sev}:\\s*\\d+`, "i")).first()).toBeVisible();
    }
  });
});
