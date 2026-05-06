import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run sequentially — tests share a real backend.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
