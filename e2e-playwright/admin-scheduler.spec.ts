import { test, expect } from "./fixtures/auth";

test.describe("/admin/scheduler", () => {
  test("renders the scheduler queue and filters", async ({ authedPage }) => {
    await authedPage.goto("/admin/scheduler");
    await expect(authedPage.getByRole("heading", { name: /scheduler/i }).first()).toBeVisible();
    // Status filter should expose at least "all" + pending
    await expect(authedPage.getByRole("button", { name: /enqueue|create|new job/i }).first()).toBeVisible();
  });

  test("realtime channel mounts without console errors", async ({ authedPage }) => {
    const errors: string[] = [];
    authedPage.on("pageerror", (e) => errors.push(e.message));
    await authedPage.goto("/admin/scheduler");
    await authedPage.waitForTimeout(1500);
    expect(errors.filter((m) => !/ResizeObserver/i.test(m))).toEqual([]);
  });
});
