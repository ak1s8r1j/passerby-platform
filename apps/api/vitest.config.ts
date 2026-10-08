import { defineConfig } from "vitest/config";

// Fast tests: no database needed.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.int.test.ts"],
  },
});
