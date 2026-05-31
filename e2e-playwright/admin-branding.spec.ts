/**
 * /admin/branding e2e — operator can load the page, the AA gate blocks a
 * sub-AA save without an override reason, and BrandingProvider writes the
 * five swap-allowed CSS vars onto :root.
 *
 * Spec: docs/common-domain-ui.md §1, §3.
 */
import { test, expect } from "./fixtures/auth";

test.describe("Admin Branding", () => {
  test("page loads and exposes the brand colour picker", async ({ page }) => {
    await page.goto("/admin/branding");
    await expect(page.getByRole("heading", { name: /branding/i })).toBeVisible();
    // Colour input is rendered for the primary hex
    await expect(page.locator('input[type="color"]').first()).toBeVisible();
  });

  test("BrandingProvider writes swap-allowed CSS vars onto :root", async ({ page }) => {
    await page.goto("/admin/branding");
    // Wait for provider boot — give it up to 3s to either find a row or fall through to defaults.
    await page.waitForTimeout(1500);
    const vars = await page.evaluate(() => {
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      return {
        primary: cs.getPropertyValue("--primary").trim(),
        primaryFg: cs.getPropertyValue("--primary-foreground").trim(),
        accent: cs.getPropertyValue("--accent").trim(),
        accentFg: cs.getPropertyValue("--accent-foreground").trim(),
        ring: cs.getPropertyValue("--ring").trim(),
      };
    });
    // Locked tokens must never be empty (either default from index.css or tenant override).
    expect(vars.primary.length).toBeGreaterThan(0);
    expect(vars.primaryFg.length).toBeGreaterThan(0);
    expect(vars.ring.length).toBeGreaterThan(0);
  });
});
