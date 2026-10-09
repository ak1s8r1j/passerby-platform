import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "@passerby/shared";
import { FakePeer, FakeStream, flush } from "../test/fake-media.js";
import { Call, NOTE_CONNECTING, NOTE_FAILED } from "./call.js";

const ICE = [{ urls: "stun:stun.example:3478" }];
const CANDIDATE = {
  candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
};

function setup() {
  FakePeer.instances = [];
  const sent: Signal[] = [];
  const remote: (unknown | null)[] = [];
  const notes: string[] = [];
  const local = new FakeStream();
  const call = new Call({
    iceServers: ICE,
    send: (s) => sent.push(s),
    onRemote: (r) => remote.push(r),
    onNote: (n) => notes.push(n),
    createPeer: (config) => new FakePeer(config) as unknown as RTCPeerConnection,
  });
  const start = (initiator: boolean) => call.start(local as unknown as MediaStream, initiator);
  return { call, start, sent, remote, notes, local };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("starting a call", () => {
  it("connects with the configured servers and adds the camera and microphone", () => {
    const t = setup();
    t.start(false);
    expect(FakePeer.last.config).toEqual({ iceServers: ICE });
    expect(FakePeer.last.tracks.map(([track]) => track.kind)).toEqual(["video", "audio"]);
    expect(t.notes).toEqual([NOTE_CONNECTING]);
  });

  it("the initiator sends an offer, and only the initiator", async () => {
    const t = setup();
    t.start(true);
    await flush();
    expect(t.sent).toEqual([{ s: { type: "offer", sdp: "offer-sdp" } }]);

    const other = setup();
    other.start(false);
    await flush();
    expect(other.sent).toEqual([]);
  });

  it("starting again drops the first connection", () => {
    const t = setup();
    t.start(true);
    const first = FakePeer.last;
    t.start(true);
    expect(first.closed).toBe(true);
    expect(FakePeer.instances).toHaveLength(2);
  });
});

describe("the conversation of setup messages", () => {
  it("answers an offer", async () => {
    const t = setup();
    t.start(false);
    t.call.signal({ s: { type: "offer", sdp: "their-offer" } });
    await flush();
    expect(FakePeer.last.remoteDescription).toEqual({ type: "offer", sdp: "their-offer" });
    expect(t.sent).toEqual([{ s: { type: "answer", sdp: "answer-sdp" } }]);
  });

  it("takes an answer without answering back", async () => {
    const t = setup();
    t.start(true);
    await flush();
    t.sent.length = 0;
    t.call.signal({ s: { type: "answer", sdp: "their-answer" } });
    await flush();
    expect(FakePeer.last.remoteDescription).toEqual({ type: "answer", sdp: "their-answer" });
    expect(t.sent).toEqual([]);
  });

  it("holds early candidates until the other side's description is in, then adds them in order", async () => {
    const t = setup();
    t.start(false);
    const c2 = { ...CANDIDATE, candidate: "candidate:2" };
    t.call.signal({ c: CANDIDATE });
    t.call.signal({ c: c2 });
    expect(FakePeer.last.addedCandidates).toEqual([]);
    t.call.signal({ s: { type: "offer", sdp: "o" } });
    await flush();
    expect(FakePeer.last.addedCandidates).toEqual([CANDIDATE, c2]);
  });

  it("adds candidates straight away once the description is in", async () => {
    const t = setup();
    t.start(false);
    t.call.signal({ s: { type: "offer", sdp: "o" } });
    await flush();
    t.call.signal({ c: CANDIDATE });
    await flush();
    expect(FakePeer.last.addedCandidates).toEqual([CANDIDATE]);
  });

  it("sends our own candidates to the other person, but not the end-of-candidates marker", () => {
    const t = setup();
    t.start(true);
    FakePeer.last.emitCandidate(CANDIDATE);
    FakePeer.last.emitEndOfCandidates();
    expect(t.sent).toEqual([{ c: CANDIDATE }]);
  });
});

describe("how the call is going", () => {
  it("shows the other person's picture and sound when it arrives", () => {
    const t = setup();
    t.start(true);
    const theirs = new FakeStream();
    FakePeer.last.emitTrack(theirs);
    expect(t.remote).toEqual([theirs]);
  });

  it("clears the note once connected, and reports a failure", () => {
    const t = setup();
    t.start(true);
    FakePeer.last.setState("connected");
    expect(t.notes.at(-1)).toBe("");
    FakePeer.last.setState("failed");
    expect(t.notes.at(-1)).toBe(NOTE_FAILED);
  });

  it("reports a failure when the offer can't be made, or their description is bad", async () => {
    const a = setup();
    FakePeer.failOffers = true;
    a.start(true);
    FakePeer.failOffers = false;
    await flush();
    expect(a.notes.at(-1)).toBe(NOTE_FAILED);

    const b = setup();
    b.start(false);
    FakePeer.last.failRemote = true;
    b.call.signal({ s: { type: "offer", sdp: "garbage" } });
    await flush();
    expect(b.notes.at(-1)).toBe(NOTE_FAILED);
  });

  it("does not end the call because of one bad candidate", async () => {
    const t = setup();
    t.start(false);
    t.call.signal({ s: { type: "offer", sdp: "o" } });
    await flush();
    FakePeer.last.failCandidates = true;
    t.call.signal({ c: CANDIDATE });
    await flush();
    expect(t.notes).not.toContain(NOTE_FAILED);
  });
});

describe("ending a call", () => {
  it("closes the connection, clears the picture and the note", () => {
    const t = setup();
    t.start(true);
    const peer = FakePeer.last;
    t.call.stop();
    expect(peer.closed).toBe(true);
    expect(peer.ontrack).toBeNull();
    expect(peer.onicecandidate).toBeNull();
    expect(t.remote.at(-1)).toBeNull();
    expect(t.notes.at(-1)).toBe("");
  });

  it("is harmless to stop twice, or to stop before starting", () => {
    const t = setup();
    expect(() => t.call.stop()).not.toThrow();
    t.start(true);
    t.call.stop();
    expect(() => t.call.stop()).not.toThrow();
  });

  it("ignores setup messages that arrive after the call ended", async () => {
    const t = setup();
    t.start(false);
    const peer = FakePeer.last;
    t.call.stop();
    t.call.signal({ s: { type: "offer", sdp: "late" } });
    t.call.signal({ c: CANDIDATE });
    await flush();
    expect(peer.remoteDescription).toBeNull();
    expect(t.sent).toEqual([]);
  });

  it("ignores setup messages before any call has started", () => {
    const t = setup();
    expect(() => t.call.signal({ c: CANDIDATE })).not.toThrow();
  });

  it("is not confused by a late event from the previous person's connection", async () => {
    const t = setup();
    t.start(true);
    const old = FakePeer.last;
    t.start(true); // the next person
    t.remote.length = 0;
    t.notes.length = 0;
    t.sent.length = 0;
    old.emitTrack(new FakeStream());
    old.emitCandidate(CANDIDATE);
    old.setState("failed");
    expect(t.remote).toEqual([]);
    expect(t.sent).toEqual([]);
    expect(t.notes).toEqual([]);
  });

  it("does not use candidates held for the previous person on the next one", async () => {
    const t = setup();
    t.start(false);
    t.call.signal({ c: CANDIDATE }); // held, no description yet
    t.start(false); // next person
    t.call.signal({ s: { type: "offer", sdp: "o" } });
    await flush();
    expect(FakePeer.last.addedCandidates).toEqual([]);
  });
});
