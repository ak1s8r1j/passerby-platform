import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const API = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken, rather than quietly moving to another port the API does not expect.
    strictPort: true,
    // In development the browser talks only to Vite; it forwards these to the API.
    proxy: {
      "/api": API,
      "/healthz": API,
      "/ws": { target: API, ws: true },
    },
  },
  build: { sourcemap: true },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    css: false,
  },
});
