import { describe, expect, it } from "vitest";
import { cleanTags, MAX_SDP_LENGTH, parseClientMessage, ServerMessage } from "./protocol.js";

describe("parseClientMessage", () => {
  it("accepts a valid hello and fills in defaults", () => {
    expect(parseClientMessage('{"t":"hello","adult":true}')).toEqual({
      t: "hello",
      adult: true,
      mode: "text",
      tags: [],
    });
  });

  it("refuses a hello without the 18+ confirmation", () => {
    expect(parseClientMessage('{"t":"hello"}')).toBeNull();
    expect(parseClientMessage('{"t":"hello","adult":false}')).toBeNull();
  });

  it("refuses wildly too many or too long interests (small excess is trimmed later)", () => {
    const many = JSON.stringify({ t: "hello", adult: true, tags: Array(17).fill("a") });
    const long = JSON.stringify({ t: "hello", adult: true, tags: ["x".repeat(49)] });
    expect(parseClientMessage(many)).toBeNull();
    expect(parseClientMessage(long)).toBeNull();
  });

  it("only accepts known languages, genders and modes", () => {
    const hello = (extra: object) => JSON.stringify({ t: "hello", adult: true, ...extra });
    expect(parseClientMessage(hello({ lang: "fr", gender: "f", mode: "video" }))).not.toBeNull();
    expect(parseClientMessage(hello({ lang: "xx" }))).toBeNull();
    expect(parseClientMessage(hello({ gender: "x" }))).toBeNull();
    expect(parseClientMessage(hello({ mode: "hologram" }))).toBeNull();
  });

  it("accepts the chat messages", () => {
    expect(parseClientMessage('{"t":"ping"}')).toEqual({ t: "ping" });
    expect(parseClientMessage('{"t":"find"}')).toEqual({ t: "find" });
    expect(parseClientMessage('{"t":"stop"}')).toEqual({ t: "stop" });
    expect(parseClientMessage('{"t":"typing"}')).toEqual({ t: "typing" });
    expect(parseClientMessage('{"t":"msg","text":"hi"}')).toEqual({ t: "msg", text: "hi" });
  });

  it("refuses a message with no text or a non-text body", () => {
    expect(parseClientMessage('{"t":"msg"}')).toBeNull();
    expect(parseClientMessage('{"t":"msg","text":42}')).toBeNull();
  });

  it("refuses garbage, unknown types and non-objects", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage('{"t":"explode"}')).toBeNull();
    expect(parseClientMessage("42")).toBeNull();
    expect(parseClientMessage("null")).toBeNull();
  });
});

describe("cleanTags", () => {
  it("lower-cases, strips symbols and trims", () => {
    expect(cleanTags(["Music!", "  Hiking  ", "C++ "])).toEqual(["music", "hiking", "c"]);
  });

  it("removes duplicates (after cleaning) and empty tags", () => {
    expect(cleanTags(["Chess", "chess!", "", "!!!", "  "])).toEqual(["chess"]);
  });

  it("keeps non-English letters and numbers", () => {
    expect(cleanTags(["Café", "音楽", "Formula 1"])).toEqual(["café", "音楽", "formula 1"]);
  });

  it("cuts long tags at 24 characters and keeps at most 8 tags", () => {
    expect(cleanTags(["a".repeat(40)])[0]).toHaveLength(24);
    expect(cleanTags(Array.from({ length: 12 }, (_, i) => "tag" + i))).toHaveLength(8);
  });
});

describe("ServerMessage", () => {
  it("accepts every message the server sends", () => {
    const all = [
      { t: "ready", online: 1 },
      { t: "count", online: 2 },
      { t: "waiting" },
      { t: "wait", ms: 2500 },
      { t: "matched", common: ["music"], init: true },
      { t: "msg", text: "hi" },
      { t: "typing" },
      { t: "ended" },
      { t: "banned", until: 1, reason: "age" },
      { t: "error", code: "too_fast", text: "Slow down" },
    ];
    for (const m of all) expect(ServerMessage.safeParse(m).success, m.t).toBe(true);
  });

  it("refuses an unknown ban reason", () => {
    expect(ServerMessage.safeParse({ t: "banned", until: 1, reason: "because" }).success).toBe(
      false,
    );
  });
});

describe("video setup messages (sig)", () => {
  const sig = (d: unknown) => parseClientMessage(JSON.stringify({ t: "sig", d }));
  const offer = { s: { type: "offer", sdp: "v=0\r\n..." } };

  it("accepts an offer, an answer and an ICE candidate", () => {
    expect(sig(offer)).toEqual({ t: "sig", d: offer });
    expect(sig({ s: { type: "answer", sdp: "v=0" } })).not.toBeNull();
    expect(
      sig({
        c: { candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0", sdpMLineIndex: 0 },
      }),
    ).not.toBeNull();
  });

  it("accepts the nulls browsers send for the end-of-candidates marker", () => {
    expect(
      sig({ c: { candidate: "", sdpMid: null, sdpMLineIndex: null, usernameFragment: null } }),
    ).not.toBeNull();
  });

  it("refuses anything that is not exactly an offer, answer or candidate", () => {
    expect(sig(undefined)).toBeNull();
    expect(sig({})).toBeNull();
    expect(sig("hello")).toBeNull();
    expect(sig({ s: { type: "pranswer", sdp: "x" } })).toBeNull();
    expect(sig({ s: { type: "offer" } })).toBeNull();
    expect(sig({ c: { candidate: 5 } })).toBeNull();
    expect(sig({ c: { candidate: "x", sdpMLineIndex: -1 } })).toBeNull();
    expect(sig({ c: { candidate: "x", sdpMLineIndex: 1.5 } })).toBeNull();
  });

  it("refuses oversized descriptions and candidates", () => {
    expect(sig({ s: { type: "offer", sdp: "x".repeat(MAX_SDP_LENGTH) } })).not.toBeNull();
    expect(sig({ s: { type: "offer", sdp: "x".repeat(MAX_SDP_LENGTH + 1) } })).toBeNull();
    expect(sig({ c: { candidate: "x".repeat(2001) } })).toBeNull();
  });

  it("strips fields it does not know, so the channel cannot carry anything else", () => {
    const parsed = sig({ s: { type: "offer", sdp: "v=0", smuggled: "hello" }, extra: [1, 2, 3] });
    expect(parsed).toEqual({ t: "sig", d: { s: { type: "offer", sdp: "v=0" } } });
  });
});
