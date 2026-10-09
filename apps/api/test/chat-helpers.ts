import type { BanReason, ClientMessage, ServerMessage } from "@passerby/shared";
import {
  ChatEngine,
  type Ban,
  type BanStore,
  type ReportInput,
  type ReportSink,
} from "../src/chat/engine.js";

/** Bans held in memory, with the same expiry rule as the database version. */
export class MemoryBans implements BanStore {
  bans = new Map<string, Ban>();
  /** Set to make the next lookups slow, to test someone leaving while a ban check is running. */
  gate: Promise<void> | null = null;

  async get(visitor: string) {
    if (this.gate) await this.gate;
    const b = this.bans.get(visitor);
    if (!b) return null;
    if (b.until <= Date.now()) {
      this.bans.delete(visitor);
      return null;
    }
    return b;
  }

  async add(visitor: string, hours: number, reason: BanReason) {
    const ban = { until: Date.now() + hours * 3600e3, reason };
    this.bans.set(visitor, ban);
    return ban;
  }
}

export class MemoryReports implements ReportSink {
  filed: ReportInput[] = [];
  async file(r: ReportInput) {
    this.filed.push(r);
  }
}

export interface Person {
  id: string;
  visitor: string;
  /** Everything the server has sent this person so far. */
  got: ServerMessage[];
  /** The types of what was sent, in order. */
  types(): string[];
  /** Remove and return the first message of this type. */
  take<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined;
  say(msg: ClientMessage): Promise<void>;
  hello(over?: Partial<Extract<ClientMessage, { t: "hello" }>>): Promise<void>;
  find(): Promise<void>;
  text(text: string): Promise<void>;
  leave(): void;
}

/** A chat engine wired to a recording transport, with people who can talk to it. */
export function world(options: { videoEnabled?: boolean } = {}) {
  const sent = new Map<string, ServerMessage[]>();
  const closed: { id: string; code: number }[] = [];
  const bans = new MemoryBans();
  const reports = new MemoryReports();
  let presence = 0;
  const engine = new ChatEngine({
    transport: {
      send: (id, msg) => {
        const list = sent.get(id) ?? [];
        list.push(msg);
        sent.set(id, list);
      },
      close: (id, code) => closed.push({ id, code }),
    },
    bans,
    reports,
    onPresence: () => presence++,
    ...options,
  });

  const person = (id: string, visitor = id): Person => {
    engine.connect(id, visitor);
    const got = () => sent.get(id) ?? [];
    const p: Person = {
      id,
      visitor,
      get got() {
        return got();
      },
      types: () => got().map((m) => m.t),
      take(t) {
        const list = got();
        const i = list.findIndex((m) => m.t === t);
        return (i >= 0 ? list.splice(i, 1)[0] : undefined) as never;
      },
      say: (msg) => engine.handle(id, msg),
      hello: (over = {}) =>
        engine.handle(id, { t: "hello", adult: true, mode: "text", tags: [], ...over }),
      find: () => engine.handle(id, { t: "find" }),
      text: (text) => engine.handle(id, { t: "msg", text }),
      leave: () => engine.disconnect(id),
    };
    return p;
  };

  return { engine, person, bans, reports, closed, presence: () => presence };
}
