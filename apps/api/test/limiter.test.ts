import { describe, expect, it } from "vitest";
import { Limiter } from "../src/auth/limiter.js";

function clock() {
  let t = 1_000_000;
  const limiter = new Limiter(() => t);
  return { limiter, advance: (ms: number) => (t += ms) };
}

describe("Limiter", () => {
  it("lets through up to the maximum, then refuses", () => {
    const { limiter } = clock();
    expect([1, 2, 3, 4].map(() => limiter.take("k", 3, 1000))).toEqual([true, true, true, false]);
  });

  it("lets people back in once the window has passed", () => {
    const { limiter, advance } = clock();
    for (let i = 0; i < 3; i++) limiter.take("k", 3, 1000);
    expect(limiter.take("k", 3, 1000)).toBe(false);
    advance(999);
    expect(limiter.take("k", 3, 1000)).toBe(false);
    advance(2);
    expect(limiter.take("k", 3, 1000)).toBe(true);
  });

  it("does not count a refused attempt, so being refused does not extend the wait", () => {
    const { limiter, advance } = clock();
    limiter.take("k", 1, 1000);
    for (let i = 0; i < 50; i++) limiter.take("k", 1, 1000); // all refused
    advance(1001);
    expect(limiter.take("k", 1, 1000)).toBe(true);
  });

  it("keeps different keys apart", () => {
    const { limiter } = clock();
    limiter.take("a", 1, 1000);
    expect(limiter.take("a", 1, 1000)).toBe(false);
    expect(limiter.take("b", 1, 1000)).toBe(true);
  });

  it("counts strikes without ever refusing them, so a lock-out can be checked separately", () => {
    const { limiter, advance } = clock();
    for (let i = 0; i < 4; i++) limiter.strike("fail", 1000);
    expect(limiter.count("fail", 1000)).toBe(4);
    advance(1001);
    expect(limiter.count("fail", 1000)).toBe(0);
  });

  it("counts nothing for a key it has never seen", () => {
    expect(clock().limiter.count("never", 1000)).toBe(0);
  });

  it("does not grow without limit when someone makes up endless keys", () => {
    const { limiter } = clock();
    for (let i = 0; i < 20_000; i++) limiter.take(`key-${i}`, 1, 1000);
    expect(limiter.size).toBeLessThanOrEqual(5001);
  });

  it("forgets old keys when it tidies up", () => {
    const { limiter, advance } = clock();
    for (let i = 0; i < 5001; i++) limiter.take(`old-${i}`, 1, 1000);
    advance(2 * 3_600_000);
    limiter.take("fresh", 1, 1000);
    for (let i = 0; i < 5; i++) limiter.take(`more-${i}`, 1, 1000);
    expect(limiter.size).toBeLessThan(5000);
  });
});
