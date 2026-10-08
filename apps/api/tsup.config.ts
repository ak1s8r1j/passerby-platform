import { defineConfig } from "tsup";

// One bundled file. The shared package is TypeScript source, so it is bundled in;
// everything from node_modules stays external and is installed at deploy time.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@passerby/shared"],
});
