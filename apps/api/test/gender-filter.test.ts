import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gendersAgree, score, type Seeker } from "../src/chat/matching.js";
import { world, type Person } from "./chat-helpers.js";

const NOW = 1_000_000;
const seeker = (id: string, over: Partial<Seeker> = {}): Seeker => ({
  id,
  visitor: id,
  mode: "text",
  tags: [],
  lang: "",
  gender: "",
  seek: "",
  queuedAt: NOW,
  lastPartner: "",
  blocked: new Set(),
  ...over,
});

describe("who each person is happy to talk to", () => {
  it("pairs anyone with anyone when nobody filters", () => {
    for (const a of ["", "m", "f"]) {
      for (const b of ["", "m", "f"]) {
        expect(gendersAgree(seeker("a", { gender: a }), seeker("b", { gender: b }))).toBe(true);
      }
    }
  });

  it("lets someone who wants women match a woman, and nobody else", () => {
    const wantsWomen = seeker("a", { seek: "f" });
    expect(gendersAgree(wantsWomen, seeker("b", { gender: "f" }))).toBe(true);
    expect(gendersAgree(wantsWomen, seeker("b", { gender: "m" }))).toBe(false);
    expect(gendersAgree(wantsWomen, seeker("b", { gender: "" }))).toBe(false); // they never said
  });

  it("lets someone who wants men match a man, and nobody else", () => {
    const wantsMen = seeker("a", { seek: "m" });
    expect(gendersAgree(wantsMen, seeker("b", { gender: "m" }))).toBe(true);
    expect(gendersAgree(wantsMen, seeker("b", { gender: "f" }))).toBe(false);
    expect(gendersAgree(wantsMen, seeker("b", { gender: "" }))).toBe(false);
  });

  it("needs the other person to be happy too: a filter works both ways", () => {
    const woman = seeker("a", { gender: "f" });
    const manWantingMen = seeker("b", { gender: "m", seek: "m" });
    const manWantingWomen = seeker("c", { gender: "m", seek: "f" });
    expect(gendersAgree(woman, manWantingMen)).toBe(false); // he does not want her
    expect(gendersAgree(woman, manWantingWomen)).toBe(true);
  });

  it("is the same whichever of the two is asked first", () => {
    const people = ["", "m", "f"].flatMap((g) =>
      ["", "m", "f"].map((s) => seeker(`${g}${s}`, { gender: g, seek: s })),
    );
    for (const a of people)
      for (const b of people) expect(gendersAgree(a, b)).toBe(gendersAgree(b, a));
  });
});

describe("the score", () => {
  it("refuses a pair the filters rule out, however long they wait and whatever they share", () => {
    const a = seeker("a", { seek: "f", tags: ["music"], queuedAt: 0 });
    const b = seeker("b", { gender: "m", tags: ["music"], queuedAt: 0 });
    expect(score(a, b, NOW)).toBe(-1);
    expect(score(a, b, NOW + 10 * 60_000)).toBe(-1);
  });

  it("still pairs a pair the filters allow", () => {
    const a = seeker("a", { seek: "f", gender: "m" });
    const b = seeker("b", { seek: "m", gender: "f" });
    expect(score(a, b, NOW)).toBeGreaterThanOrEqual(0);
  });
});

describe("in the chat engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  const join = async (
    w: ReturnType<typeof world>,
    id: string,
    over: { gender?: "m" | "f"; seek?: "m" | "f" } = {},
  ): Promise<Person> => {
    const p = w.person(id, `visitor-${id}`);
    await p.hello(over);
    return p;
  };

  it("pairs a woman who wants men with a man who wants women", async () => {
    const w = world();
    const her = await join(w, "her", { gender: "f", seek: "m" });
    const him = await join(w, "him", { gender: "m", seek: "f" });
    await her.find();
    await him.find();
    expect(her.types()).toContain("matched");
    expect(him.types()).toContain("matched");
  });

  it("never pairs someone who wants women with a man, even after a long wait", async () => {
    const w = world();
    const a = await join(w, "a", { gender: "m", seek: "f" });
    const b = await join(w, "b", { gender: "m" });
    await a.find();
    await b.find();
    await tick(60_000);
    expect(a.types()).not.toContain("matched");
    expect(b.types()).not.toContain("matched");
  });

  it("does not match someone who wants women with someone who never said what they are", async () => {
    const w = world();
    const a = await join(w, "a", { seek: "f" });
    const b = await join(w, "b"); // says nothing
    await a.find();
    await b.find();
    await tick(60_000);
    expect(a.types()).not.toContain("matched");
  });

  it("holds them until someone suitable arrives, then pairs them with that person, not with others waiting", async () => {
    const w = world();
    const wantsWomen = await join(w, "w", { gender: "m", seek: "f" });
    const man = await join(w, "man", { gender: "m" });
    await wantsWomen.find();
    await man.find();
    await tick(30_000);
    expect(wantsWomen.types()).not.toContain("matched");

    const woman = await join(w, "woman", { gender: "f" });
    await woman.find();
    expect(wantsWomen.types()).toContain("matched");
    expect(woman.types()).toContain("matched");
    expect(man.types()).not.toContain("matched"); // the man was passed over by the one who didn't want him
  });

  it("treats a hello with no filter as 'anyone', and a later hello can change it", async () => {
    const w = world();
    const a = await join(w, "a", { gender: "m", seek: "f" });
    await a.hello({ gender: "m" }); // changed their mind: anyone
    const b = await join(w, "b", { gender: "m" });
    await a.find();
    await b.find();
    expect(a.types()).toContain("matched");
  });
});
