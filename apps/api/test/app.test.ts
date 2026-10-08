import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, VERSION } from "../src/app.js";
import { silent, testConfig } from "./helpers.js";

const make = (dbUp: boolean, online = 0) =>
  createApp({
    config: testConfig(),
    logger: silent,
    health: { ping: async () => dbUp },
    online: () => online,
  });

describe("GET /healthz", () => {
  it("is healthy when the database answers", async () => {
    const res = await request(make(true)).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: VERSION, database: "up" });
  });

  it("reports 503 when the database is down, so the host can restart or hold traffic", async () => {
    const res = await request(make(false)).get("/healthz");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, version: VERSION, database: "down" });
  });
});

describe("GET /api/v1/stats", () => {
  it("returns the live count", async () => {
    const res = await request(make(true, 7)).get("/api/v1/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ online: 7 });
  });
});

describe("errors and headers", () => {
  it("answers unknown API routes with a JSON 404", async () => {
    const res = await request(make(true)).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "not_found", message: "There is no such API route." },
    });
  });

  it("sends security headers and hides the framework", async () => {
    const res = await request(make(true)).get("/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("turns a broken request body into a clean error, not a crash", async () => {
    const res = await request(make(true))
      .post("/api/v1/stats")
      .set("content-type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  it("refuses an oversized body with 413", async () => {
    const res = await request(make(true))
      .post("/api/v1/stats")
      .set("content-type", "application/json")
      .send(JSON.stringify({ x: "a".repeat(40_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("too_large");
  });
});

describe("serving the built web app", () => {
  const dist = mkdtempSync(join(tmpdir(), "passerby-web-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log(1)");
  // A relative path, the way someone would type it in a setting.
  const app = createApp({
    config: testConfig({ WEB_DIST: relative(process.cwd(), dist) }),
    logger: silent,
    health: { ping: async () => true },
    online: () => 0,
  });

  it("serves the app shell at the root and for any page the browser router owns", async () => {
    for (const path of ["/", "/text", "/video", "/anything/else"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.text).toContain("<title>shell</title>");
    }
  });

  it("serves hashed assets with a long cache time", async () => {
    const res = await request(app).get("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("never answers API or health paths with the app shell", async () => {
    expect((await request(app).get("/api/v1/nope")).body.error.code).toBe("not_found");
    expect((await request(app).get("/healthz")).body.ok).toBe(true);
  });
});
