import { vi } from "vitest";

/** Stand-ins for the browser's camera, microphone and WebRTC connection, so tests can drive video. */

export class FakeTrack {
  enabled = true;
  stopped = false;
  constructor(public kind: "audio" | "video") {}
  stop() {
    this.stopped = true;
  }
}

export class FakeStream {
  tracks = [new FakeTrack("video"), new FakeTrack("audio")];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

export class FakePeer {
  static instances: FakePeer[] = [];
  /** Make every new connection fail when asked for an offer (set before the call starts). */
  static failOffers = false;
  static get last(): FakePeer {
    const p = FakePeer.instances.at(-1);
    if (!p) throw new Error("no peer connection has been created yet");
    return p;
  }

  tracks: [FakeTrack, unknown][] = [];
  closed = false;
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  connectionState = "new";
  addedCandidates: unknown[] = [];
  failOffer = FakePeer.failOffers;
  failRemote = false;
  failCandidates = false;
  ontrack: ((e: { streams: unknown[] }) => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): unknown } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(public config?: RTCConfiguration) {
    FakePeer.instances.push(this);
  }

  addTrack(track: FakeTrack, stream: unknown) {
    this.tracks.push([track, stream]);
  }
  async createOffer() {
    if (this.failOffer) throw new Error("no offer");
    return { type: "offer", sdp: "offer-sdp" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "answer-sdp" };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    if (this.failRemote) throw new Error("bad description");
    this.remoteDescription = d;
  }
  async addIceCandidate(c: unknown) {
    if (this.failCandidates) throw new Error("bad candidate");
    this.addedCandidates.push(c);
  }
  close() {
    this.closed = true;
  }

  // ---- what tests do to it ----
  emitCandidate(c: unknown) {
    this.onicecandidate?.({ candidate: { toJSON: () => c } });
  }
  emitEndOfCandidates() {
    this.onicecandidate?.({ candidate: null });
  }
  emitTrack(stream: unknown) {
    this.ontrack?.({ streams: [stream] });
  }
  setState(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

/** Let promises that are already resolved run their callbacks. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface FakeMedia {
  /** Every call to getUserMedia. */
  asked: unknown[];
  /** Streams handed out. */
  streams: FakeStream[];
}

/** Install a fake camera (or a blocked one) and a fake RTCPeerConnection for the current test. */
export function installFakeMedia(options: { deny?: boolean } = {}): FakeMedia {
  const media: FakeMedia = { asked: [], streams: [] };
  FakePeer.instances = [];
  FakePeer.failOffers = false;
  const getUserMedia = vi.fn(async (constraints: unknown) => {
    media.asked.push(constraints);
    if (options.deny) throw new DOMException("Permission denied", "NotAllowedError");
    const stream = new FakeStream();
    media.streams.push(stream);
    return stream;
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  return media;
}
