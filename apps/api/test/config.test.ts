import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgresql://x", SESSION_SECRET: "a-long-enough-secret" };

describe("loadConfig", () => {
  it("fills in defaults", () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.PUBLIC_URL).toBe("http://localhost:5173");
  });

  it("turns PORT into a number", () => {
    expect(loadConfig({ ...base, PORT: "8080" }).PORT).toBe(8080);
  });

  it("names every missing or bad setting", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...base, PORT: "banana" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, PUBLIC_URL: "not a url" })).toThrow(/PUBLIC_URL/);
  });

  it("refuses the placeholder secret in production", () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        SESSION_SECRET: "change-me-to-a-long-random-string",
      }),
    ).toThrow(/SESSION_SECRET/);
  });
});
