import type { IceServer, Signal } from "@passerby/shared";

export const NOTE_CONNECTING = "Connecting video…";
export const NOTE_FAILED =
  "Video couldn't connect with this person. Press Next to try someone else.";

export interface CallOptions {
  iceServers: IceServer[];
  /** Pass a setup message to the other person (through the server). */
  send(signal: Signal): void;
  /** The other person's picture and sound, or null when there is none. */
  onRemote(stream: MediaStream | null): void;
  /** A short message about how the connection is going ("" = nothing to say). */
  onNote(text: string): void;
  /** Overridable so tests can use a fake. */
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
}

/**
 * One video connection to one other person (WebRTC), with the browser's API wrapped so it can be tested.
 *
 * Who does what: the person marked `initiator` makes the offer; the other answers. Both then trade
 * candidates (possible network routes) until a direct path works. The server only carries the messages.
 */
export class Call {
  private peer: RTCPeerConnection | null = null;
  /** Candidates that arrived before the other side's description; they can only be used after it. */
  private pending: RTCIceCandidateInit[] = [];

  constructor(private options: CallOptions) {}

  /** Begin a new connection, dropping any old one. */
  start(local: MediaStream, initiator: boolean): void {
    this.stop();
    const make = this.options.createPeer ?? ((config) => new RTCPeerConnection(config));
    const me = (this.peer = make({ iceServers: this.options.iceServers }));
    this.options.onNote(NOTE_CONNECTING);

    for (const track of local.getTracks()) me.addTrack(track, local);

    me.ontrack = (e) => {
      if (me === this.peer) this.options.onRemote(e.streams[0] ?? null);
    };
    me.onicecandidate = (e) => {
      if (me !== this.peer || !e.candidate) return;
      this.options.send({ c: e.candidate.toJSON() as Extract<Signal, { c: unknown }>["c"] });
    };
    me.onconnectionstatechange = () => {
      if (me !== this.peer) return;
      if (me.connectionState === "failed") this.options.onNote(NOTE_FAILED);
      else if (me.connectionState === "connected") this.options.onNote("");
    };

    if (initiator) {
      me.createOffer()
        .then((offer) => me.setLocalDescription(offer))
        .then(() => this.sendDescription(me))
        .catch(() => this.fail(me));
    }
  }

  /** The other person sent a setup message. */
  signal(d: Signal): void {
    const me = this.peer;
    if (!me) return; // a late message from a connection that has already ended
    if ("s" in d) {
      me.setRemoteDescription({ type: d.s.type, sdp: d.s.sdp })
        .then(() => {
          const queued = this.pending;
          this.pending = [];
          for (const c of queued) me.addIceCandidate(c).catch(() => undefined);
          if (d.s.type !== "offer") return;
          return me
            .createAnswer()
            .then((answer) => me.setLocalDescription(answer))
            .then(() => this.sendDescription(me));
        })
        .catch(() => this.fail(me));
    } else if (me.remoteDescription) {
      me.addIceCandidate(d.c).catch(() => undefined); // a stray bad candidate is not worth ending the call
    } else {
      this.pending.push(d.c);
    }
  }

  /** End the connection and clear the other person's picture. */
  stop(): void {
    const old = this.peer;
    this.peer = null;
    this.pending = [];
    if (old) {
      old.ontrack = old.onicecandidate = old.onconnectionstatechange = null;
      old.close();
      this.options.onRemote(null);
      this.options.onNote("");
    }
  }

  private sendDescription(me: RTCPeerConnection): void {
    const d = me.localDescription;
    if (me !== this.peer || !d || (d.type !== "offer" && d.type !== "answer")) return;
    this.options.send({ s: { type: d.type, sdp: d.sdp } });
  }

  private fail(me: RTCPeerConnection): void {
    if (me === this.peer) this.options.onNote(NOTE_FAILED);
  }
}
