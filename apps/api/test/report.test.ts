import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECENT_CHAT_MS,
  REPORT_BAN_COUNT,
  REPORT_BAN_HOURS,
  REPORT_WINDOW_HOURS,
} from "../src/chat/engine.js";
import { world, type Person } from "./chat-helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

type World = ReturnType<typeof world>;

/** Two people, in a chat, with a few words said. */
async function chatting(w: World, a: Person, b: Person) {
  await a.hello();
  await b.hello();
  await a.find();
  await b.find();
  await a.text("hello there");
  await b.text("hi, who are you");
  a.got.length = 0;
  b.got.length = 0;
}

describe("reporting during a chat", () => {
  it("saves the report with the conversation, tells the reporter, and ends the chat for both", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);

    await a.say({ t: "report", reason: "harassment" });

    expect(w.reports.filed).toEqual([
      {
        reporter: "visitor-a",
        reported: "visitor-b",
        reason: "harassment",
        mode: "text",
        transcript: [
          { who: "reporter", x: "hello there" },
          { who: "reported", x: "hi, who are you" },
        ],
      },
    ]);
    expect(a.types()).toEqual(["reported"]);
    expect(b.types()).toEqual(["ended"]); // the other person is not told they were reported
  });

  it("labels the lines from the point of view of whoever reports", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    await b.say({ t: "report", reason: "spam" });
    expect(w.reports.filed[0]!.transcript).toEqual([
      { who: "reported", x: "hello there" },
      { who: "reporter", x: "hi, who are you" },
    ]);
    expect(w.reports.filed[0]!.reported).toBe("visitor-a");
  });

  it("will never match the reporter with that person again", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    await a.say({ t: "report", reason: "spam" });
    await a.find();
    await b.find();
    await tick(20_000); // well past every matching fallback
    expect(a.types()).not.toContain("matched");
    expect(b.types()).not.toContain("matched");
  });

  it("only takes one report per chat from the same person", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    await a.say({ t: "report", reason: "spam" });
    await a.say({ t: "report", reason: "spam" });
    expect(w.reports.filed).toHaveLength(1);
  });

  it("records the report in the activity log without any message text", async () => {
    const w = world();
    const a = w.person("a", "visitor-a-long-id");
    const b = w.person("b", "visitor-b-long-id");
    await chatting(w, a, b);
    await a.say({ t: "report", reason: "nudity" });
    expect(w.events.recorded).toEqual([
      {
        kind: "user",
        type: "report",
        visitor: "visitor-a-long-id",
        detail: "nudity against visitor-",
      },
    ]);
    expect(JSON.stringify(w.events.recorded)).not.toContain("hello there");
    expect(w.stats.counts.reports).toBe(1);
  });

  it("works in a video chat and notes the mode", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await a.hello({ mode: "video" });
    await b.hello({ mode: "video" });
    await a.find();
    await b.find();
    await a.say({ t: "report", reason: "nudity" });
    expect(w.reports.filed[0]).toMatchObject({ mode: "video", reason: "nudity" });
  });
});

describe("reporting a chat that just ended", () => {
  it("works when the other person left first", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    b.leave();
    expect(a.types()).toEqual(["ended"]);
    await a.say({ t: "report", reason: "harassment" });
    expect(w.reports.filed).toHaveLength(1);
    expect(w.reports.filed[0]!.reported).toBe("visitor-b");
    expect(w.reports.filed[0]!.transcript).toHaveLength(2);
    expect(a.types()).toContain("reported");
  });

  it("works for the person who ended it too (they pressed Next, then thought better of it)", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    await a.say({ t: "stop" });
    await b.say({ t: "report", reason: "spam" });
    expect(w.reports.filed[0]!.reported).toBe("visitor-a");
  });

  it("stops working after a few minutes", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    b.leave();
    await tick(RECENT_CHAT_MS + 1000);
    a.got.length = 0;
    await a.say({ t: "report", reason: "spam" });
    expect(w.reports.filed).toHaveLength(0);
    expect(a.take("error")).toMatchObject({ code: "nothing_to_report" });
  });

  it("can't be done twice for the same chat", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    b.leave();
    await a.say({ t: "report", reason: "spam" });
    await a.say({ t: "report", reason: "other" });
    expect(w.reports.filed).toHaveLength(1);
  });

  it("can't be done again after reporting inside the chat", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    await a.say({ t: "report", reason: "spam" });
    await a.say({ t: "report", reason: "spam" });
    expect(w.reports.filed).toHaveLength(1);
  });

  it("refers to the most recent chat, not an older one", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    const c = w.person("c", "visitor-c");
    await chatting(w, a, b);
    await a.say({ t: "stop" }); // ends chat with b
    await c.hello();
    await tick(4000);
    await a.find();
    await c.find();
    await c.text("hey");
    await c.say({ t: "stop" });
    await a.say({ t: "report", reason: "spam" });
    expect(w.reports.filed.at(-1)!.reported).toBe("visitor-c");
  });
});

describe("what cannot be reported", () => {
  it("answers 'nothing to report' for someone who never had a chat", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    await a.hello();
    a.got.length = 0;
    await a.say({ t: "report", reason: "spam" });
    expect(w.reports.filed).toHaveLength(0);
    expect(a.take("error")).toMatchObject({ code: "nothing_to_report" });
  });

  it("ignores a report before hello", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    await a.say({ t: "report", reason: "spam" });
    expect(a.got).toEqual([]);
    expect(w.reports.filed).toHaveLength(0);
  });
});

describe("pausing someone who is reported a lot", () => {
  /** Three different people each have a chat with the same person, and report it. */
  async function reportedBy(w: World, reporters: string[], target = "visitor-x") {
    const x = w.person("x" + Math.random(), target);
    await x.hello();
    for (const name of reporters) {
      const r = w.person("r-" + name + Math.random(), name);
      await r.hello();
      await x.find();
      await r.find();
      await r.text("hi");
      await r.say({ t: "report", reason: "harassment" });
      await tick(4000);
    }
    return x;
  }

  it(`bans for ${REPORT_BAN_HOURS} hours once ${REPORT_BAN_COUNT} different people have reported them`, async () => {
    const w = world();
    await reportedBy(w, ["p1", "p2"]);
    expect(w.bans.bans.has("visitor-x")).toBe(false);
    await reportedBy(w, ["p3"]);
    const ban = w.bans.bans.get("visitor-x");
    expect(ban).toBeDefined();
    expect(ban!.reason).toBe("reports");
    expect(ban!.until - Date.now()).toBeGreaterThan((REPORT_BAN_HOURS - 1) * 3600e3);
  });

  it("closes the banned person's connection and tells them why", async () => {
    const w = world();
    const x = w.person("x", "visitor-x");
    await x.hello();
    for (const name of ["p1", "p2", "p3"]) {
      const r = w.person("r-" + name, name);
      await r.hello();
      await x.find();
      await r.find();
      await r.say({ t: "report", reason: "nudity" });
      await tick(4000);
    }
    expect(x.take("banned")).toMatchObject({ reason: "reports" });
    expect(w.closed.some((c) => c.id === "x" && c.code === 4003)).toBe(true);
  });

  it("counts different people, so one person reporting three times does not pause anyone", async () => {
    const w = world();
    await reportedBy(w, ["same", "same", "same", "same"]);
    expect(w.bans.bans.has("visitor-x")).toBe(false);
  });

  it("ignores reports from the reported person's own address", async () => {
    const w = world();
    await reportedBy(w, ["visitor-x", "visitor-x", "visitor-x"]);
    expect(w.bans.bans.has("visitor-x")).toBe(false);
    expect(w.reports.filed).toHaveLength(3); // still saved for a moderator
  });

  it("ignores automatic reports", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) {
      await w.reports.file({
        reporter: "system",
        reported: "visitor-x",
        reason: "underage",
        mode: "text",
        transcript: [],
      });
    }
    expect(await w.reports.reportersOf("visitor-x", REPORT_WINDOW_HOURS)).toBe(0);
  });

  it("forgets reports older than the window", async () => {
    const w = world();
    await reportedBy(w, ["p1", "p2"]);
    await tick((REPORT_WINDOW_HOURS + 1) * 3600e3);
    await reportedBy(w, ["p3"]);
    expect(w.bans.bans.has("visitor-x")).toBe(false);
  });

  it("records the pause in the activity log and the counters", async () => {
    const w = world();
    await reportedBy(w, ["p1", "p2", "p3"]);
    const ban = w.events.recorded.find((e) => e.type === "ban");
    expect(ban).toMatchObject({ kind: "system", visitor: "visitor-x", detail: "24h, reports" });
    expect(w.stats.counts.bans).toBe(1);
  });

  it("does not ban twice when a fourth person reports someone already banned", async () => {
    const w = world();
    await reportedBy(w, ["p1", "p2", "p3"]);
    const first = w.bans.bans.get("visitor-x")!.until;
    await tick(60_000);
    await reportedBy(w, ["p4"]);
    // The banned person can't be matched now; the report path must not extend or re-add the ban.
    expect(w.bans.bans.get("visitor-x")!.until).toBe(first);
  });
});

describe("the dashboard's counters", () => {
  it("counts visitors, chats, messages and finished chats", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    await tick(30_000);
    await a.say({ t: "stop" });
    expect(w.stats.counts).toMatchObject({
      visitors: 2,
      chats: 1,
      messages: 2,
      chatsEnded: 1,
      chatSeconds: 30,
    });
    expect(w.stats.counts.videoChats).toBeUndefined();
    expect(w.stats.peak).toBe(2);
  });

  it("counts a video chat as a chat and a video chat", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await a.hello({ mode: "video" });
    await b.hello({ mode: "video" });
    await a.find();
    await b.find();
    expect(w.stats.counts).toMatchObject({ chats: 1, videoChats: 1 });
  });

  it("does not count a message that was dropped for flooding or for an age remark", async () => {
    const w = world();
    const a = w.person("a", "visitor-a");
    const b = w.person("b", "visitor-b");
    await chatting(w, a, b);
    const before = w.stats.counts.messages;
    await a.text("im 14");
    expect(w.stats.counts.messages).toBe(before);
  });
});

describe("the live snapshot", () => {
  it("separates text from video, and searching from chatting", async () => {
    const w = world();
    const a = w.person("a", "va");
    const b = w.person("b", "vb");
    const c = w.person("c", "vc");
    const d = w.person("d", "vd");
    w.person("e", "ve"); // connected, never said hello
    await a.hello();
    await b.hello();
    await c.hello({ mode: "video" });
    await d.hello({ mode: "video" });
    await a.find();
    await b.find();
    await c.find();
    expect(w.engine.snapshot()).toEqual({
      online: 4,
      text: 2,
      video: 2,
      searching: 1,
      chatting: 2,
    });
  });
});
