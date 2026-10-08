import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@passerby/shared";
import { chatReducer, initialChat, statusText, type Action, type ChatState } from "./state.js";

const NOW = 1_000_000;
const server = (msg: ServerMessage): Action => ({
  type: "server",
  msg,
  now: NOW,
  siteName: "Passerby",
});
const run = (actions: Action[], from: ChatState = initialChat) => actions.reduce(chatReducer, from);
const texts = (s: ChatState) => s.lines.map((l) => `${l.kind}:${l.text}`);

describe("starting and matching", () => {
  it("goes searching when Start is pressed, and clears old lines", () => {
    const s = run([{ type: "start" }]);
    expect(s.phase).toBe("searching");
    expect(s.lines).toEqual([]);
  });

  it("shows the cool-down, then searching, then the match with shared interests", () => {
    let s = run([{ type: "start" }, server({ t: "wait", ms: 2000 })]);
    expect(s.phase).toBe("cooldown");
    expect(s.waitUntil).toBe(NOW + 2000);
    s = run([server({ t: "waiting" })], s);
    expect(s.phase).toBe("searching");
    expect(s.waitUntil).toBeNull();
    s = run([server({ t: "matched", common: ["music", "chess"], init: true })], s);
    expect(s.phase).toBe("chatting");
    expect(texts(s)).toEqual(["sys:You both like music, chess. Say hi."]);
  });

  it("says plainly when there is nothing in common", () => {
    const s = run([{ type: "start" }, server({ t: "matched", common: [], init: false })]);
    expect(texts(s)).toEqual(["sys:You're connected. Say hi."]);
  });

  it("ignores a late 'waiting' or 'matched' after the visitor pressed Stop", () => {
    const s = run([
      { type: "start" },
      { type: "stop" },
      server({ t: "waiting" }),
      server({ t: "matched", common: [], init: true }),
    ]);
    expect(s.phase).toBe("idle");
    expect(s.lines).toEqual([]);
  });
});

describe("chatting", () => {
  const chatting = run([{ type: "start" }, server({ t: "matched", common: [], init: true })]);

  it("shows messages from both sides in order", () => {
    const s = run(
      [
        { type: "sent", text: "hi" },
        server({ t: "msg", text: "hello" }),
        { type: "sent", text: "how are you" },
      ],
      chatting,
    );
    expect(texts(s).slice(1)).toEqual(["me:hi", "them:hello", "me:how are you"]);
  });

  it("gives every line its own id", () => {
    const s = run(
      [{ type: "sent", text: "a" }, { type: "sent", text: "b" }, server({ t: "msg", text: "c" })],
      chatting,
    );
    expect(new Set(s.lines.map((l) => l.id)).size).toBe(s.lines.length);
  });

  it("shows typing, which a message or the timeout clears", () => {
    let s = run([server({ t: "typing" })], chatting);
    expect(s.typing).toBe(true);
    expect(statusText(s, NOW, true)).toBe("Stranger is typing…");
    expect(run([server({ t: "msg", text: "x" })], s).typing).toBe(false);
    s = run([{ type: "typingOff" }], s);
    expect(statusText(s, NOW, true)).toBe("You're talking to a stranger");
  });

  it("ends the chat when the stranger leaves, and refuses further sending", () => {
    const s = run([server({ t: "ended" }), { type: "sent", text: "hello?" }], chatting);
    expect(s.phase).toBe("ended");
    expect(texts(s).at(-1)).toBe("sys:The stranger left.");
    expect(texts(s)).not.toContain("me:hello?");
    expect(statusText(s, NOW, true)).toBe("Chat ended. Press Next to meet someone else.");
  });

  it("shows the server's error notices in the log (for example, sending too fast)", () => {
    const s = run([server({ t: "error", code: "too_fast", text: "Slow down." })], chatting);
    expect(texts(s).at(-1)).toBe("sys:Slow down.");
    expect(s.phase).toBe("chatting");
  });

  it("returns to idle with a clear message when the connection drops", () => {
    const s = run([{ type: "dropped" }], chatting);
    expect(s.phase).toBe("idle");
    expect(texts(s).at(-1)).toBe("sys:The connection dropped. Press Start to try again.");
  });

  it("does not add a 'dropped' notice when nothing was happening", () => {
    expect(run([{ type: "dropped" }]).lines).toEqual([]);
  });

  it("Stop clears everything", () => {
    const s = run([{ type: "stop" }], chatting);
    expect(s).toMatchObject({ phase: "idle", lines: [], typing: false });
  });
});

describe("being removed", () => {
  const until = NOW + 3600e3;

  it("explains an age removal, and stays removed", () => {
    let s = run([{ type: "start" }, server({ t: "banned", until, reason: "age" })]);
    expect(s.phase).toBe("banned");
    expect(texts(s)[0]).toMatch(/^sys:Passerby is for adults only\. You're blocked until /);
    s = run([{ type: "start" }, { type: "stop" }, server({ t: "waiting" })], s);
    expect(s.phase).toBe("banned");
  });

  it("explains a rules removal", () => {
    const s = run([server({ t: "banned", until, reason: "rules" })]);
    expect(texts(s)[0]).toMatch(
      /^sys:You were removed for breaking the rules\. You can come back after /,
    );
    expect(statusText(s, NOW, true)).toBe("You can't chat right now");
  });
});

describe("statusText", () => {
  it("counts down the cool-down, never showing zero", () => {
    const s = run([{ type: "start" }, server({ t: "wait", ms: 2500 })]);
    expect(statusText(s, NOW, true)).toBe("Finding someone in 3 seconds.");
    expect(statusText(s, NOW + 1500, true)).toBe("Finding someone in 1 second.");
    expect(statusText(s, NOW + 2400, true)).toBe("Finding someone in 1 second.");
  });

  it("says Connecting while there is no connection yet", () => {
    expect(statusText(initialChat, NOW, false)).toBe("Connecting…");
    expect(statusText(initialChat, NOW, true)).toBe("Ready when you are");
  });
});
