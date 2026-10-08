import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGE_BAN_HOURS, FLOOD_MAX, FLOOD_WINDOW_MS, SKIP_MS } from "../src/chat/engine.js";
import { FALLBACK_MS, REMATCH_MS } from "../src/chat/matching.js";
import { world } from "./chat-helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("arriving", () => {
  it("says ready after hello and counts the person", async () => {
    const w = world();
    const a = w.person("a");
    expect(w.engine.online()).toBe(0);
    await a.hello();
    expect(a.take("ready")).toEqual({ t: "ready", online: 1 });
    expect(w.engine.online()).toBe(1);
    expect(w.presence()).toBe(1);
  });

  it("ignores everything except hello until hello has been said", async () => {
    const w = world();
    const a = w.person("a");
    await a.find();
    await a.text("hi");
    await a.say({ t: "typing" });
    expect(a.got).toEqual([]);
    expect(w.engine.online()).toBe(0);
  });

  it("doesn't count the same person twice when they say hello again", async () => {
    const w = world();
    const a = w.person("a");
    await a.hello();
    await a.hello({ tags: ["music"] });
    expect(w.engine.online()).toBe(1);
    expect(w.presence()).toBe(1);
  });

  it("stops counting someone who disconnects", async () => {
    const w = world();
    const a = w.person("a");
    await a.hello();
    a.leave();
    expect(w.engine.online()).toBe(0);
    expect(w.presence()).toBe(2);
  });
});

describe("finding someone", () => {
  it("pairs two people with a shared interest at once, with exactly one initiator", async () => {
    const w = world();
    const a = w.person("a"),
      b = w.person("b");
    await a.hello({ tags: ["Music!", "chess"] });
    await b.hello({ tags: ["music", "films"] });
    await a.find();
    expect(a.take("waiting")).toBeDefined();
    await b.find();
    const ma = a.take("matched"),
      mb = b.take("matched");
    expect(ma?.common).toEqual(["music"]);
    expect(mb?.common).toEqual(["music"]);
    expect([ma?.init, mb?.init].sort()).toEqual([false, true]);
  });

  it("pairs two people with no interests at once", async () => {
    const w = world();
    const a = w.person("a"),
      b = w.person("b");
    await a.hello();
    await b.hello();
    await a.find();
    await b.find();
    expect(a.take("matched")?.common).toEqual([]);
    expect(b.take("matched")).toBeDefined();
  });

  it("holds out for a shared interest, then takes anyone after four seconds", async () => {
    const w = world();
    const c = w.person("c"),
      d = w.person("d");
    await c.hello({ tags: ["cats"] });
    await d.hello({ tags: ["dogs"] });
    await c.find();
    await d.find();
    await tick(FALLBACK_MS - 100);
    expect(c.take("matched")).toBeUndefined();
    await tick(200);
    expect(c.take("matched")?.common).toEqual([]);
    expect(d.take("matched")).toBeDefined();
  });

  it("picks the best of several waiting people", async () => {
    const w = world();
    const a = w.person("a"),
      none = w.person("none"),
      music = w.person("music");
    await none.hello({ tags: ["x"] });
    await music.hello({ tags: ["music", "chess"] });
    await a.hello({ tags: ["music", "chess"] });
    await none.find();
    await music.find();
    await a.find();
    expect(a.take("matched")).toBeDefined();
    expect(music.take("matched")).toBeDefined();
    expect(none.take("matched")).toBeUndefined();
  });

  it("never pairs text people with video people", async () => {
    const w = world();
    const t = w.person("t"),
      v = w.person("v");
    await t.hello({ mode: "text" });
    await v.hello({ mode: "video" });
    await t.find();
    await v.find();
    await tick(60_000);
    expect(t.take("matched")).toBeUndefined();
    expect(v.take("matched")).toBeUndefined();
  });

  it("does not match someone with a person they blocked", async () => {
    const w = world();
    const a = w.person("a", "visitor-a"),
      b = w.person("b", "visitor-b");
    await a.hello();
    await b.hello();
    w.engine.block("a", "visitor-b");
    await a.find();
    await b.find();
    await tick(60_000);
    expect(a.take("matched")).toBeUndefined();
  });

  it("stops looking when told to stop, and nobody is paired with them", async () => {
    const w = world();
    const a = w.person("a"),
      b = w.person("b");
    await a.hello();
    await b.hello();
    await a.find();
    await a.say({ t: "stop" });
    await b.find();
    await tick(10_000);
    expect(b.take("matched")).toBeUndefined();
  });

  it("stops looking when they disconnect", async () => {
    const w = world();
    const a = w.person("a"),
      b = w.person("b");
    await a.hello();
    await b.hello();
    await a.find();
    a.leave();
    await b.find();
    await tick(10_000);
    expect(b.take("matched")).toBeUndefined();
  });
});

describe("talking", () => {
  async function chatting() {
    const w = world();
    const a = w.person("a"),
      b = w.person("b");
    await a.hello();
    await b.hello();
    await a.find();
    await b.find();
    a.take("matched");
    b.take("matched");
    return { w, a, b };
  }

  it("relays messages trimmed, and only to the partner", async () => {
    const { w, a, b } = await chatting();
    const c = w.person("c");
    await c.hello();
    await a.text("  hello there  ");
    expect(b.take("msg")).toEqual({ t: "msg", text: "hello there" });
    expect(a.take("msg")).toBeUndefined();
    expect(c.take("msg")).toBeUndefined();
  });

  it("passes markup through untouched as plain text (the browser shows it as text)", async () => {
    const { a, b } = await chatting();
    await a.text("<img src=x onerror=alert(1)>");
    expect(b.take("msg")?.text).toBe("<img src=x onerror=alert(1)>");
  });

  it("ignores empty messages and cuts very long ones at 1000 characters", async () => {
    const { a, b } = await chatting();
    await a.text("   ");
    expect(b.take("msg")).toBeUndefined();
    await a.text("x".repeat(5000));
    expect(b.take("msg")?.text).toHaveLength(1000);
  });

  it("relays typing", async () => {
    const { a, b } = await chatting();
    await a.say({ t: "typing" });
    expect(b.take("typing")).toBeDefined();
    expect(a.take("typing")).toBeUndefined();
  });

  it("drops messages sent while not in a chat, without an error", async () => {
    const w = world();
    const a = w.person("a");
    await a.hello();
    a.take("ready");
    await a.text("anyone?");
    await a.say({ t: "typing" });
    expect(a.got).toEqual([]);
  });

  it("limits flooding: only six messages in three seconds get through", async () => {
    const { a, b } = await chatting();
    for (let i = 0; i < 10; i++) await a.text("spam " + i);
    expect(b.got.filter((m) => m.t === "msg")).toHaveLength(FLOOD_MAX);
    const err = a.take("error");
    expect(err?.code).toBe("too_fast");
  });

  it("lets them talk again once the window has passed", async () => {
    const { a, b } = await chatting();
    for (let i = 0; i < FLOOD_MAX; i++) await a.text("m" + i);
    await a.text("blocked");
    await tick(FLOOD_WINDOW_MS + 10);
    await a.text("again");
    expect(b.got.filter((m) => m.t === "msg").map((m) => (m as { text: string }).text)).toContain(
      "again",
    );
    expect(b.got.filter((m) => m.t === "msg")).toHaveLength(FLOOD_MAX + 1);
  });

  it("ends the chat for the other person when someone leaves, and when they disconnect", async () => {
    const { a, b } = await chatting();
    await a.say({ t: "stop" });
    expect(b.take("ended")).toBeDefined();
    await b.text("hello?");
    expect(a.take("msg")).toBeUndefined();

    const { a: c, b: d } = await chatting();
    c.leave();
    expect(d.take("ended")).toBeDefined();
  });
});

describe("skipping (Next)", () => {
  async function chatting() {
    const w = world();
    const a = w.person("a"),
      b = w.person("b");
    await a.hello();
    await b.hello();
    await a.find();
    await b.find();
    return { w, a, b };
  }

  it("tells the partner, and makes a quick skipper wait out the cool-down", async () => {
    const { a, b } = await chatting();
    a.take("matched");
    b.take("matched");
    a.take("waiting"); // from the first search; only what follows the skip matters
    await tick(1000);
    await a.find(); // Next
    expect(b.take("ended")).toBeDefined();
    const wait = a.take("wait");
    expect(wait?.ms).toBeGreaterThan(1500);
    expect(wait?.ms).toBeLessThanOrEqual(SKIP_MS);
    expect(a.take("waiting")).toBeUndefined();
    await tick(wait!.ms + 10);
    expect(a.take("waiting")).toBeDefined();
  });

  it("searches immediately when the cool-down has already passed", async () => {
    const { a } = await chatting();
    await tick(SKIP_MS + 10);
    a.take("matched");
    a.take("waiting");
    await a.find();
    expect(a.take("wait")).toBeUndefined();
    expect(a.take("waiting")).toBeDefined();
  });

  it("does not put two people who just talked straight back together", async () => {
    const { a, b } = await chatting();
    a.take("matched");
    b.take("matched");
    const start = Date.now();
    await a.find();
    await b.find();
    await tick(REMATCH_MS - 500);
    expect(a.take("matched")).toBeUndefined();
    await tick(REMATCH_MS);
    expect(Date.now() - start).toBeGreaterThanOrEqual(REMATCH_MS);
    expect(a.take("matched")).toBeDefined();
    expect(b.take("matched")).toBeDefined();
  });

  it("lets a third person take the free slot instead of an old partner", async () => {
    const { w, a, b } = await chatting();
    a.take("matched");
    b.take("matched");
    const c = w.person("c");
    await c.hello();
    await tick(SKIP_MS + 10);
    await a.find();
    await c.find();
    expect(a.take("matched")).toBeDefined();
    expect(c.take("matched")).toBeDefined();
    expect(b.take("ended")).toBeDefined();
  });
});

describe("saying you are under 18", () => {
  async function chatting() {
    const w = world();
    const kid = w.person("kid", "kid-visitor"),
      adult = w.person("adult", "adult-visitor");
    await kid.hello();
    await adult.hello();
    await kid.find();
    await adult.find();
    kid.take("matched");
    adult.take("matched");
    return { w, kid, adult };
  }

  it("withholds the message, removes the sender for 24 hours and ends the chat", async () => {
    const { w, kid, adult } = await chatting();
    await kid.text("hello");
    adult.take("msg");
    await kid.text("hey im 14 f");
    await tick(0);
    expect(adult.take("msg")).toBeUndefined();
    expect(adult.take("ended")).toBeDefined();
    const banned = kid.take("banned");
    expect(banned?.reason).toBe("age");
    expect(banned!.until - Date.now()).toBeCloseTo(AGE_BAN_HOURS * 3600e3, -3);
    expect(w.closed).toContainEqual({ id: "kid", code: 4003 });
  });

  it("files a report for a moderator, with what was said", async () => {
    const { w, kid, adult } = await chatting();
    await adult.text("hi how are you");
    await kid.text("fine");
    await kid.text("i'm 15");
    await tick(0);
    expect(w.reports.filed).toHaveLength(1);
    const r = w.reports.filed[0]!;
    expect(r).toMatchObject({
      reporter: "system",
      reported: "kid-visitor",
      reason: "underage",
      mode: "text",
    });
    expect(r.transcript).toEqual([
      { who: "reporter", x: "hi how are you" },
      { who: "reported", x: "fine" },
      { who: "reported", x: "i'm 15" },
    ]);
  });

  it("keeps them out: no hello, no find, from any connection", async () => {
    const { w, kid } = await chatting();
    await kid.text("im 16");
    await tick(0);
    const again = w.person("kid-again", "kid-visitor");
    await again.hello();
    expect(again.take("ready")).toBeUndefined();
    expect(again.take("banned")?.reason).toBe("age");
    expect(w.closed).toContainEqual({ id: "kid-again", code: 4003 });
  });

  it("removes their other open tabs too", async () => {
    const { w, kid } = await chatting();
    const other = w.person("other-tab", "kid-visitor");
    await other.hello();
    other.take("ready");
    await kid.text("im 13");
    await tick(0);
    expect(other.take("banned")).toBeDefined();
    expect(w.closed).toContainEqual({ id: "other-tab", code: 4003 });
  });

  it("lets them back after the 24 hours", async () => {
    const { w, kid } = await chatting();
    await kid.text("im 17");
    await tick(0);
    await tick(AGE_BAN_HOURS * 3600e3 + 1000);
    const back = w.person("kid-later", "kid-visitor");
    await back.hello();
    expect(back.take("ready")).toBeDefined();
  });

  it("leaves ordinary sentences with numbers alone", async () => {
    const { w, kid, adult } = await chatting();
    for (const s of ["I'm 15 minutes late sorry", "im 100% sure", "I am 25", "im 10 km away"]) {
      await kid.text(s);
      await tick(FLOOD_WINDOW_MS);
    }
    expect(adult.got.filter((m) => m.t === "msg")).toHaveLength(4);
    expect(w.reports.filed).toHaveLength(0);
    expect(kid.take("banned")).toBeUndefined();
  });
});

describe("bans in general", () => {
  it("refuses a banned visitor at find, even if they said hello earlier", async () => {
    const w = world();
    const a = w.person("a", "bad");
    await a.hello();
    a.take("ready");
    await w.engine.ban("bad", 1, "rules");
    expect(a.take("banned")?.reason).toBe("rules");
    await a.find();
    expect(a.take("waiting")).toBeUndefined();
  });

  it("does not crash when someone disconnects while their ban is being checked", async () => {
    const w = world();
    let release!: () => void;
    w.bans.gate = new Promise<void>((r) => (release = r));
    const a = w.person("a");
    const pending = a.hello();
    a.leave();
    release();
    await pending;
    expect(w.engine.online()).toBe(0);
    expect(a.got).toEqual([]);
  });

  it("applies a new hello's choices, ending any chat in progress", async () => {
    const w = world();
    const a = w.person("a"),
      b = w.person("b");
    await a.hello();
    await b.hello();
    await a.find();
    await b.find();
    await a.hello({ tags: ["new"] });
    expect(b.take("ended")).toBeDefined();
    expect(a.take("ready")).toBeDefined();
  });
});
