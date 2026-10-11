import { vi } from "vitest";

/** Stand-ins for the browser's camera, microphone and WebRTC connection, so tests can drive video. */

export class FakeTrack {
  enabled = true;
  stopped = false;
  constructor(
    public kind: "audio" | "video",
    public label = kind === "video" ? "Integrated Camera" : "Microphone Array",
    public deviceId = `${kind}-default`,
  ) {}
  stop() {
    this.stopped = true;
  }
  getSettings() {
    return { deviceId: this.deviceId };
  }
}

export class FakeStream {
  tracks: FakeTrack[] = [new FakeTrack("video"), new FakeTrack("audio")];
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
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
  /** What replaceTrack was asked to send instead. */
  replaced: FakeTrack[] = [];
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
  getSenders() {
    return this.tracks.map(([track], i) => ({
      track,
      replaceTrack: async (next: FakeTrack) => {
        this.replaced.push(next);
        this.tracks[i] = [next, this.tracks[i]![1]];
      },
    }));
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

export interface FakeDevice {
  kind: "videoinput" | "audioinput";
  deviceId: string;
  label: string;
}

export interface FakeMedia {
  /** What is plugged in. Change it, then call `plugged()` to tell the page. */
  devices: FakeDevice[];
  /** Every call to getUserMedia. */
  asked: unknown[];
  /** Streams handed out. */
  streams: FakeStream[];
}

/** Install a fake camera (or a blocked one) and a fake RTCPeerConnection for the current test. */
export function installFakeMedia(
  options: { deny?: boolean; devices?: FakeDevice[] } = {},
): FakeMedia {
  const devices: FakeDevice[] = options.devices ?? [
    { kind: "videoinput", deviceId: "cam-a", label: "Integrated Camera" },
    { kind: "audioinput", deviceId: "mic-a", label: "Microphone Array" },
  ];
  const media: FakeMedia = { devices, asked: [], streams: [] };
  FakePeer.instances = [];
  FakePeer.failOffers = false;
  const getUserMedia = vi.fn(async (constraints: unknown) => {
    media.asked.push(constraints);
    if (options.deny) throw new DOMException("Permission denied", "NotAllowedError");
    const c = constraints as {
      video?: true | { deviceId?: { exact?: string } };
      audio?: true | { deviceId?: { exact?: string } };
    };
    const find = (kind: FakeDevice["kind"], want?: true | { deviceId?: { exact?: string } }) => {
      const exact = typeof want === "object" ? want.deviceId?.exact : undefined;
      return exact
        ? devices.find((d) => d.kind === kind && d.deviceId === exact)
        : devices.find((d) => d.kind === kind);
    };
    const stream = new FakeStream();
    stream.tracks = [];
    if (c.video) {
      const d = find("videoinput", c.video);
      if (!d) throw new DOMException("Requested device not found", "NotFoundError");
      stream.tracks.push(new FakeTrack("video", d.label, d.deviceId));
    }
    if (c.audio) {
      const d = find("audioinput", c.audio);
      if (!d) throw new DOMException("Requested device not found", "NotFoundError");
      stream.tracks.push(new FakeTrack("audio", d.label, d.deviceId));
    }
    media.streams.push(stream);
    return stream;
  });
  const enumerateDevices = vi.fn(async () => devices.map((d) => ({ ...d })));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices, addEventListener() {}, removeEventListener() {} },
  });
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  return media;
}
