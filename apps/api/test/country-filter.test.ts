import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseClientMessage } from "@passerby/shared";
import { offlineCountryLookup } from "../src/geo.js";
import { countriesAgree, score, type Seeker } from "../src/chat/matching.js";
import { world } from "./chat-helpers.js";

const NOW = 1_000_000;
const seeker = (id: string, over: Partial<Seeker> = {}): Seeker => ({
  id,
  visitor: id,
  mode: "text",
  tags: [],
  lang: "",
  gender: "",
  seek: "",
  country: "",
  seekCountries: [],
  queuedAt: NOW,
  lastPartner: "",
  blocked: new Set(),
  ...over,
});

describe("working out where a connection is from", () => {
  const lookup = offlineCountryLookup();

  it("names the country of a public address", () => {
    expect(lookup("8.8.8.8")).toBe("US");
    expect(lookup("81.2.69.142")).toBe("GB");
  });

  it("says nothing for local, private and nonsense addresses, rather than guessing", () => {
    for (const a of ["127.0.0.1", "10.0.0.1", "192.168.1.5", "::1", "", "not an address", "?"]) {
      expect(lookup(a), a).toBe("");
    }
  });

  it("always gives a two-letter capital code or nothing", () => {
    for (const a of ["8.8.8.8", "1.1.1.1", "200.1.1.1", "2.2.2.2", "127.0.0.1"]) {
      expect(lookup(a)).toMatch(/^([A-Z]{2})?$/);
    }
  });
});

describe("the country filter in the hello message", () => {
  const hello = (extra: object) => JSON.stringify({ t: "hello", adult: true, ...extra });

  it("takes a short list of known countries", () => {
    expect(parseClientMessage(hello({ countries: ["US", "GB"] }))).toMatchObject({
      countries: ["US", "GB"],
    });
    expect(parseClientMessage(hello({}))).not.toBeNull();
  });

  it("refuses unknown codes, wrong shapes, and too many", () => {
    for (const countries of [["XX"], ["usa"], ["us"], "US", [1], [null], Array(11).fill("US")]) {
      expect(parseClientMessage(hello({ countries })), JSON.stringify(countries)).toBeNull();
    }
  });

  it("does not let the browser say where it is: a 'country' of its own is dropped", () => {
    const parsed = parseClientMessage(hello({ country: "US" }));
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("country");
  });
});

describe("who each person's countries allow", () => {
  it("lets everyone match when no one filters, including people of unknown country", () => {
    expect(countriesAgree(seeker("a"), seeker("b", { country: "FR" }))).toBe(true);
    expect(countriesAgree(seeker("a"), seeker("b"))).toBe(true);
  });

  it("matches someone from a chosen country, and not from another", () => {
    const wantsUS = seeker("a", { seekCountries: ["US"] });
    expect(countriesAgree(wantsUS, seeker("b", { country: "US" }))).toBe(true);
    expect(countriesAgree(wantsUS, seeker("b", { country: "CA" }))).toBe(false);
  });

  it("matches any of several chosen countries", () => {
    const wants = seeker("a", { seekCountries: ["US", "GB", "CA"] });
    for (const c of ["US", "GB", "CA"])
      expect(countriesAgree(wants, seeker("b", { country: c }))).toBe(true);
    expect(countriesAgree(wants, seeker("b", { country: "DE" }))).toBe(false);
  });

  it("does not match someone whose country is not known", () => {
    expect(
      countriesAgree(seeker("a", { seekCountries: ["US"] }), seeker("b", { country: "" })),
    ).toBe(false);
  });

  it("needs the other person to be happy too", () => {
    const a = seeker("a", { country: "US", seekCountries: ["GB"] });
    const b = seeker("b", { country: "GB", seekCountries: ["DE"] }); // b wants Germans, not Americans
    expect(countriesAgree(a, b)).toBe(false);
    const c = seeker("c", { country: "GB", seekCountries: ["US"] });
    expect(countriesAgree(a, c)).toBe(true);
  });

  it("is never relaxed by waiting, and the score refuses the pair", () => {
    const a = seeker("a", { seekCountries: ["US"], queuedAt: 0 });
    const b = seeker("b", { country: "FR", queuedAt: 0 });
    expect(score(a, b, NOW + 10 * 60_000)).toBe(-1);
  });
});

describe("in the chat engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("pairs people from the chosen country, and tells each where the other is from", async () => {
    const w = world();
    const a = w.person("a", "va", "US");
    const b = w.person("b", "vb", "GB");
    await a.hello({ countries: ["GB"] });
    await b.hello();
    await a.find();
    await b.find();
    expect(a.take("matched")).toMatchObject({ country: "GB" });
    expect(b.take("matched")).toMatchObject({ country: "US" });
  });

  it("leaves the country out when it could not be worked out", async () => {
    const w = world();
    const a = w.person("a", "va", "");
    const b = w.person("b", "vb", "");
    await a.hello();
    await b.hello();
    await a.find();
    await b.find();
    expect(a.take("matched")).not.toHaveProperty("country");
  });

  it("never pairs someone who wants one country with another, however long they wait", async () => {
    const w = world();
    const a = w.person("a", "va", "US");
    const b = w.person("b", "vb", "FR");
    await a.hello({ countries: ["GB"] });
    await b.hello();
    await a.find();
    await b.find();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.types()).not.toContain("matched");
  });

  it("holds them until someone from the right country arrives", async () => {
    const w = world();
    const a = w.person("a", "va", "US");
    const fr = w.person("fr", "vfr", "FR");
    await a.hello({ countries: ["BR"] });
    await fr.hello();
    await a.find();
    await fr.find();
    await vi.advanceTimersByTimeAsync(30_000);
    const br = w.person("br", "vbr", "BR");
    await br.hello();
    await br.find();
    expect(a.types()).toContain("matched");
    expect(fr.types()).not.toContain("matched");
  });

  it("can change the choice with a later hello", async () => {
    const w = world();
    const a = w.person("a", "va", "US");
    const b = w.person("b", "vb", "FR");
    await a.hello({ countries: ["GB"] });
    await a.hello({}); // back to anywhere
    await b.hello();
    await a.find();
    await b.find();
    expect(a.types()).toContain("matched");
  });
});
