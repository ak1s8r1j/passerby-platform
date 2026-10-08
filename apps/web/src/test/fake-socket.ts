import { vi } from "vitest";
import type { ClientMessage } from "@passerby/shared";

/** A stand-in for the browser's WebSocket that tests can drive: see what was sent, push messages in, drop it. */
export class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  /** The most recently opened connection. */
  static get last(): FakeSocket {
    const s = FakeSocket.instances.at(-1);
    if (!s) throw new Error("no connection has been opened yet");
    return s;
  }

  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string) {
    this.sent.push(data);
  }
  /** Both a visitor-side close and a server-side drop end up here. */
  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Everything the page has sent, parsed. Pings are left out. */
  get messages(): ClientMessage[] {
    return this.sent.map((s) => JSON.parse(s) as ClientMessage).filter((m) => m.t !== "ping");
  }
  /** What the page has sent of one kind. */
  of<T extends ClientMessage["t"]>(t: T): Extract<ClientMessage, { t: T }>[] {
    return this.messages.filter((m): m is Extract<ClientMessage, { t: T }> => m.t === t);
  }
  /** Pretend the server sent this. */
  receive(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) });
  }
  /** Pretend the server sent something that is not even JSON. */
  receiveRaw(data: string) {
    this.onmessage?.({ data });
  }
}

export function installFakeSocket() {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
}
