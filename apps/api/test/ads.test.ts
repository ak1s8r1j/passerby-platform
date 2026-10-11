import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { adsConfig, loadConfig } from "../src/config.js";
import { silent, testConfig } from "./helpers.js";

const make = (over: Record<string, string> = {}) =>
  createApp({
    config: testConfig(over),
    logger: silent,
    health: { ping: async () => true },
    online: () => 0,
  });

const CLIENT = "ca-pub-1138895012480462";
const SPONSOR = {
  id: "acme",
  name: "Acme",
  logo: "/sponsors/acme.png",
  headline: "Cheaper flights",
  cta: "See deals",
  url: "https://acme.example/deals",
};

describe("ads in the site config", () => {
  it("passes the publisher, ad units, sponsors and rewarded provider to the browser", async () => {
    const res = await request(
      make({
        ADSENSE_CLIENT: CLIENT,
        ADSENSE_SLOT_PROFILE: "1234567890",
        ADSENSE_SLOT_LANDING: "9876543210",
        ADS_SPONSORS: JSON.stringify([SPONSOR]),
        REWARDED_ADS: "demo",
        PLUS_FILTERS: "true",
      }),
    ).get("/api/v1/config");
    expect(res.body.ads).toEqual({
      enabled: true,
      client: CLIENT,
      slots: { profile: "1234567890", landing: "9876543210" },
      sponsors: [SPONSOR],
      rewarded: "demo",
      refreshSeconds: 0,
    });
    expect(res.body.plusFilters).toBe(true);
  });

  it("is switched off completely by one setting, whatever else is set", async () => {
    const res = await request(
      make({
        ADS_ENABLED: "false",
        ADSENSE_CLIENT: CLIENT,
        ADSENSE_SLOT_PROFILE: "1234567890",
        ADS_SPONSORS: JSON.stringify([SPONSOR]),
        REWARDED_ADS: "demo",
      }),
    ).get("/api/v1/config");
    expect(res.body.ads).toEqual({
      enabled: false,
      client: null,
      slots: { profile: null, landing: null },
      sponsors: [],
      rewarded: "none",
      refreshSeconds: 0,
    });
  });

  it("refuses a bad publisher ID, ad unit ID, sponsor list or refresh time at start-up", () => {
    const base = {
      DATABASE_URL: "postgresql://x",
      SESSION_SECRET: "a-long-enough-secret-for-tests",
    };
    expect(() => loadConfig({ ...base, ADSENSE_CLIENT: "pub-123" })).toThrow(/ADSENSE_CLIENT/);
    expect(() => loadConfig({ ...base, ADSENSE_SLOT_PROFILE: "abc" })).toThrow(/ad unit/);
    expect(() => loadConfig({ ...base, ADS_SPONSORS: "not json" })).toThrow(/JSON list/);
    expect(() => loadConfig({ ...base, ADS_REFRESH_SECONDS: "10" })).toThrow(/60 to 3600/);
    expect(() =>
      loadConfig({
        ...base,
        ADS_SPONSORS: JSON.stringify([{ ...SPONSOR, url: "http://x.example" }]),
      }),
    ).toThrow(/https/);
    expect(() =>
      loadConfig({
        ...base,
        ADS_SPONSORS: JSON.stringify([{ ...SPONSOR, logo: "https://cdn.example/logo.png" }]),
      }),
    ).toThrow(/path on this site/);
  });

  it("accepts a sponsor logo that is a small inline image", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgresql://x",
      SESSION_SECRET: "a-long-enough-secret-for-tests",
      ADS_SPONSORS: JSON.stringify([{ ...SPONSOR, logo: "data:image/png;base64,AAAA" }]),
    });
    expect(adsConfig(cfg).sponsors).toHaveLength(1);
  });
});

describe("/ads.txt", () => {
  it("lists the publisher when AdSense is set up", async () => {
    const res = await request(make({ ADSENSE_CLIENT: CLIENT })).get("/ads.txt");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/plain");
    expect(res.text).toBe("google.com, pub-1138895012480462, DIRECT, f08c47fec0942fa0\n");
  });

  it("is not served without a publisher, or with ads switched off", async () => {
    expect((await request(make()).get("/ads.txt")).status).toBe(404);
    const off = make({ ADSENSE_CLIENT: CLIENT, ADS_ENABLED: "false" });
    expect((await request(off).get("/ads.txt")).status).toBe(404);
  });
});

describe("the content security policy", () => {
  const policy = async (over: Record<string, string> = {}) =>
    String((await request(make(over)).get("/healthz")).headers["content-security-policy"]);

  it("stays strict (our own site only) when AdSense is not set up", async () => {
    const csp = await policy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("googlesyndication");
    expect(csp).not.toContain("doubleclick");
    expect(csp).toMatch(/style-src 'self'(;|$)/);
  });

  it("lets Google's ad scripts and frames in only once AdSense is set up", async () => {
    const csp = await policy({ ADSENSE_CLIENT: CLIENT });
    expect(csp).toContain("https://pagead2.googlesyndication.com");
    expect(csp).toContain("frame-src");
    expect(csp).toContain("https://googleads.g.doubleclick.net");
  });

  it("stays strict when ads are switched off even if a publisher is set", async () => {
    const csp = await policy({ ADSENSE_CLIENT: CLIENT, ADS_ENABLED: "false" });
    expect(csp).not.toContain("googlesyndication");
  });
});
