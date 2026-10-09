import { describe, expect, it } from "vitest";
import { DEFAULT_STUN, iceServers, loadConfig } from "../src/config.js";

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

  it("treats settings left blank in .env as not set", () => {
    const c = loadConfig({ ...base, TURN_URL: "", TURN_USER: "", TURN_PASS: "", WEB_DIST: "" });
    expect(c.TURN_URL).toBeUndefined();
    expect(c.WEB_DIST).toBeUndefined();
    expect(iceServers(c)).toEqual([{ urls: DEFAULT_STUN }]);
  });

  it("has video on unless told otherwise, and accepts only true or false", () => {
    expect(loadConfig(base).VIDEO_ENABLED).toBe(true);
    expect(loadConfig({ ...base, VIDEO_ENABLED: "false" }).VIDEO_ENABLED).toBe(false);
    expect(() => loadConfig({ ...base, VIDEO_ENABLED: "nope" })).toThrow(/VIDEO_ENABLED/);
  });

  it("adds a relay server after the free one when TURN is set", () => {
    const c = loadConfig({
      ...base,
      TURN_URL: "turn:relay.example:3478",
      TURN_USER: "u",
      TURN_PASS: "p",
    });
    expect(iceServers(c)).toEqual([
      { urls: DEFAULT_STUN },
      { urls: "turn:relay.example:3478", username: "u", credential: "p" },
    ]);
  });
});
