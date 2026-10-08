import { defineConfig } from "vitest/config";

// Tests that talk to a real Postgres. The global setup starts a throwaway one and applies the migrations.
export default defineConfig({
  test: {
    include: ["test/**/*.int.test.ts"],
    globalSetup: ["test/integration-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
