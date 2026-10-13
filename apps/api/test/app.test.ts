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

describe("GET /api/v1/config", () => {
  const withConfig = (over: Record<string, string>) =>
    createApp({
      config: testConfig(over),
      logger: silent,
      health: { ping: async () => true },
      online: () => 0,
    });

  it("says video is on and offers the free STUN server by default", async () => {
    const res = await request(make(true)).get("/api/v1/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      video: true,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      name: "Passerby",
      contact: null,
      accountLink: false, // hidden unless the operator asks for it
      googleSignIn: false,
      // on, but with nothing to draw until AdSense or sponsors are set up
      ads: {
        enabled: true,
        client: null,
        slots: { profile: null, landing: null },
        sponsors: [],
        rewarded: "none",
        refreshSeconds: 0,
      },
      plusFilters: false, // the filters stay free until the operator makes them Plus
      plusCheckout: false,
    });
  });

  it("shows the account link only when ACCOUNT_LINK is true", async () => {
    const off = await request(withConfig({})).get("/api/v1/config");
    expect(off.body.accountLink).toBe(false);
    const on = await request(withConfig({ ACCOUNT_LINK: "true" })).get("/api/v1/config");
    expect(on.body.accountLink).toBe(true);
    const blank = await request(withConfig({ ACCOUNT_LINK: "" })).get("/api/v1/config");
    expect(blank.body.accountLink).toBe(false); // blank means not set
  });

  it("reports the site's name and contact address when they are set", async () => {
    const res = await request(
      withConfig({ SITE_NAME: "Strollr", CONTACT_EMAIL: "help@example.com" }),
    ).get("/api/v1/config");
    expect(res.body).toMatchObject({ name: "Strollr", contact: "help@example.com" });
  });

  it("treats a blank name or contact as not set", async () => {
    const res = await request(withConfig({ SITE_NAME: "", CONTACT_EMAIL: "" })).get(
      "/api/v1/config",
    );
    expect(res.body).toMatchObject({ name: "Passerby", contact: null });
  });

  it("adds the relay server, with its login, when one is set", async () => {
    const res = await request(
      withConfig({ TURN_URL: "turn:relay.example:3478", TURN_USER: "u", TURN_PASS: "p" }),
    ).get("/api/v1/config");
    expect(res.body.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "turn:relay.example:3478", username: "u", credential: "p" },
    ]);
  });

  it("says video is off when it has been switched off", async () => {
    const res = await request(withConfig({ VIDEO_ENABLED: "false" })).get("/api/v1/config");
    expect(res.body.video).toBe(false);
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
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><html><head><title>shell</title></head><body></body></html>",
  );
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

  it("keeps the admin pages out of search engines, and no other page", async () => {
    for (const path of ["/admin", "/admin/", "/admin/reports"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["x-robots-tag"], path).toMatch(/noindex/);
    }
    for (const path of ["/", "/text", "/administrators"]) {
      expect((await request(app).get(path)).headers["x-robots-tag"], path).toBeUndefined();
    }
  });

  it("serves hashed assets with a long cache time", async () => {
    const res = await request(app).get("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("puts Google's ad script in the page itself, except in video chat and the admin area", async () => {
    const withAds = createApp({
      config: testConfig({
        WEB_DIST: relative(process.cwd(), dist),
        ADSENSE_CLIENT: "ca-pub-1138895012480462",
      }),
      logger: silent,
      health: { ping: async () => true },
      online: () => 0,
    });
    const tag =
      "pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1138895012480462";
    for (const path of ["/", "/text", "/account", "/rules"]) {
      expect((await request(withAds).get(path)).text, path).toContain(tag);
    }
    for (const path of ["/video", "/video/", "/admin", "/admin/reports"]) {
      expect((await request(withAds).get(path)).text, path).not.toContain("googlesyndication");
    }
    // the tag is inside the head, and the page is otherwise untouched
    const home = (await request(withAds).get("/")).text;
    expect(home.indexOf(tag)).toBeLessThan(home.indexOf("</head>"));
    expect(home).toContain("<title>shell</title>");
  });

  it("leaves the page plain when AdSense is not set up or ads are off", async () => {
    const cases: Record<string, string>[] = [
      {},
      { ADSENSE_CLIENT: "ca-pub-1138895012480462", ADS_ENABLED: "false" },
    ];
    for (const over of cases) {
      const plain = createApp({
        config: testConfig({ WEB_DIST: relative(process.cwd(), dist), ...over }),
        logger: silent,
        health: { ping: async () => true },
        online: () => 0,
      });
      expect((await request(plain).get("/")).text).not.toContain("googlesyndication");
    }
  });

  it("never answers API or health paths with the app shell", async () => {
    expect((await request(app).get("/api/v1/nope")).body.error.code).toBe("not_found");
    expect((await request(app).get("/healthz")).body.ok).toBe(true);
  });
});
