import { describe, expect, it } from "vitest";
import { bestPartner, FALLBACK_MS, REMATCH_MS, score, type Seeker } from "../src/chat/matching.js";

const NOW = 1_000_000;
const seeker = (id: string, over: Partial<Seeker> = {}): Seeker => ({
  id,
  visitor: id,
  mode: "text",
  tags: [],
  lang: "",
  queuedAt: NOW,
  lastPartner: "",
  blocked: new Set(),
  ...over,
});

describe("score", () => {
  it("pairs two people with no interests straight away", () => {
    expect(score(seeker("a"), seeker("b"), NOW)).toBe(0);
  });

  it("never pairs someone with themselves", () => {
    const a = seeker("a");
    expect(score(a, a, NOW)).toBe(-1);
  });

  it("keeps text and video apart", () => {
    expect(score(seeker("a"), seeker("b", { mode: "video" }), NOW + 60_000)).toBe(-1);
  });

  it("ranks more shared interests higher", () => {
    const a = seeker("a", { tags: ["music", "chess", "film"] });
    const one = seeker("b", { tags: ["music"] });
    const two = seeker("c", { tags: ["music", "chess"] });
    expect(score(a, two, NOW)).toBeGreaterThan(score(a, one, NOW));
  });

  it("makes people with different interests wait for the fallback", () => {
    const a = seeker("a", { tags: ["cats"] });
    const b = seeker("b", { tags: ["dogs"] });
    expect(score(a, b, NOW + FALLBACK_MS - 1)).toBe(-1);
    expect(score(a, b, NOW + FALLBACK_MS)).toBeGreaterThanOrEqual(0);
  });

  it("lets someone with interests take someone with none, only after the fallback", () => {
    const a = seeker("a", { tags: ["cats"] });
    const b = seeker("b");
    expect(score(a, b, NOW)).toBe(-1);
    expect(score(a, b, NOW + FALLBACK_MS)).toBeGreaterThanOrEqual(0);
  });

  it("prefers the same language when interests are equal", () => {
    const a = seeker("a", { lang: "fr" });
    expect(score(a, seeker("b", { lang: "fr" }), NOW)).toBeGreaterThan(
      score(a, seeker("c", { lang: "de" }), NOW),
    );
  });

  it("does not count 'no language' as a match", () => {
    expect(score(seeker("a"), seeker("b"), NOW)).toBe(0);
  });

  it("never pairs people who blocked each other, from either side", () => {
    const a = seeker("a", { blocked: new Set(["b"]) });
    expect(score(a, seeker("b"), NOW + 60_000)).toBe(-1);
    expect(score(seeker("b"), a, NOW + 60_000)).toBe(-1);
  });

  it("stops two people who just talked from being paired straight away", () => {
    const a = seeker("a", { lastPartner: "b" });
    const b = seeker("b", { lastPartner: "a" });
    expect(score(a, b, NOW + REMATCH_MS - 1)).toBe(-1);
    expect(score(a, b, NOW + REMATCH_MS)).toBeGreaterThanOrEqual(0);
  });
});

describe("bestPartner", () => {
  it("returns nobody when nobody fits", () => {
    expect(
      bestPartner(seeker("a", { tags: ["x"] }), [seeker("b", { tags: ["y"] })], NOW),
    ).toBeNull();
    expect(bestPartner(seeker("a"), [], NOW)).toBeNull();
  });

  it("picks the best score, not just the first", () => {
    const a = seeker("a", { tags: ["music"] });
    const none = seeker("b");
    const match = seeker("c", { tags: ["music"] });
    expect(bestPartner(a, [none, match], NOW + FALLBACK_MS)?.id).toBe("c");
  });

  it("on a tie, picks whoever has waited longest (first in line)", () => {
    expect(bestPartner(seeker("a"), [seeker("b"), seeker("c")], NOW)?.id).toBe("b");
  });
});
