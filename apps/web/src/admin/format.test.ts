import { describe, expect, it } from "vitest";
import { ago, eventLabel, initials, reasonTitle, timeLeft } from "./format.js";

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const at = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("ago", () => {
  it("says 'just now' for the last few seconds, including a clock that is slightly ahead", () => {
    expect(ago(at(5_000), NOW)).toBe("just now");
    expect(ago(at(-3_000), NOW)).toBe("just now");
  });

  it("counts minutes, then hours, with the right plural", () => {
    expect(ago(at(60_000), NOW)).toBe("1 min ago");
    expect(ago(at(4 * MIN), NOW)).toBe("4 min ago");
    expect(ago(at(59 * MIN), NOW)).toBe("59 min ago");
    expect(ago(at(HOUR), NOW)).toBe("1 hour ago");
    expect(ago(at(5 * HOUR), NOW)).toBe("5 hours ago");
  });

  it("says yesterday, then days, then a date", () => {
    expect(ago(at(30 * HOUR), NOW)).toBe("yesterday");
    expect(ago(at(3 * DAY), NOW)).toBe("3 days ago");
    expect(ago(at(30 * DAY), NOW)).toMatch(/2026/);
  });

  it("is blank for nonsense, rather than 'NaN'", () => {
    expect(ago("not a date", NOW)).toBe("");
  });
});

describe("timeLeft", () => {
  it("counts down in the largest sensible unit", () => {
    expect(timeLeft(NOW + 20 * MIN, NOW)).toBe("in 20 min");
    expect(timeLeft(NOW + 3 * HOUR + 12 * MIN, NOW)).toBe("in 3 h 12 min");
    expect(timeLeft(NOW + 5 * HOUR, NOW)).toBe("in 5 h");
    expect(timeLeft(NOW + 2 * DAY, NOW)).toBe("in 2 days");
    expect(timeLeft(NOW + 1 * DAY, NOW)).toBe("in 1 day");
  });

  it("never says '60 min'", () => {
    expect(timeLeft(NOW + 3 * HOUR + 59.8 * MIN, NOW)).toBe("in 4 h");
  });

  it("says ended once it is over", () => {
    expect(timeLeft(NOW - 1, NOW)).toBe("ended");
    expect(timeLeft(NOW, NOW)).toBe("ended");
  });
});

describe("labels", () => {
  it("names the reasons, and shows an unknown one as it is", () => {
    expect(reasonTitle("nudity")).toBe("Nudity or sexual content");
    expect(reasonTitle("system")).toBe("Automatic");
    expect(reasonTitle("weird")).toBe("weird");
  });

  it("names known events and tidies unknown ones", () => {
    expect(eventLabel("login_failed")).toBe("Failed sign-in");
    expect(eventLabel("brand_new_thing")).toBe("Brand new thing");
    expect(eventLabel("")).toBe("Event");
  });

  it("makes initials from one or two words and copes with nothing", () => {
    expect(initials("Riley Q")).toBe("RQ");
    expect(initials("riley")).toBe("R");
    expect(initials("a b c")).toBe("AB");
    expect(initials("   ")).toBe("?");
  });
});
