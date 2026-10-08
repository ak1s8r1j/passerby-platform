import {
  cleanTags,
  MAX_MESSAGE_LENGTH,
  type BanReason,
  type ChatMode,
  type ClientMessage,
  type ServerMessage,
} from "@passerby/shared";
import { statedMinorAge } from "./age.js";
import { bestPartner, FALLBACK_MS, sharedTags, type Seeker } from "./matching.js";

/** People who skip are made to wait this long before the next search (not for premium, from phase 5). */
export const SKIP_MS = 3000;
/** At most this many messages in the window; more are dropped with an error. */
export const FLOOD_MAX = 6;
export const FLOOD_WINDOW_MS = 3000;
/** How many recent messages are kept so a moderator can see what happened. */
export const LOG_KEEP = 40;
export const AGE_BAN_HOURS = 24;

// ---- what the engine needs from outside ----

export interface Transport {
  send(id: string, msg: ServerMessage): void;
  close(id: string, code: number, reason: string): void;
}

export interface Ban {
  /** Milliseconds since 1970. */
  until: number;
  reason: BanReason;
}

export interface BanStore {
  get(visitor: string): Promise<Ban | null>;
  add(visitor: string, hours: number, reason: BanReason): Promise<Ban>;
}

export interface ReportInput {
  /** The reporter's visitor ID, or "system" for automatic reports. */
  reporter: string;
  reported: string;
  reason: string;
  mode: ChatMode;
  transcript: { who: "reporter" | "reported"; x: string }[];
}

export interface ReportSink {
  file(report: ReportInput): Promise<void>;
}

export interface EngineDeps {
  transport: Transport;
  bans: BanStore;
  reports: ReportSink;
  /** Called when someone arrives or leaves, so the live count can be pushed out. */
  onPresence?: () => void;
  onError?: (err: unknown, what: string) => void;
}

// ---- state ----

type State = "new" | "idle" | "cooldown" | "searching" | "chatting";

interface Chat {
  startedAt: number;
  messages: number;
  log: { from: string; x: string }[];
}

interface Session extends Seeker {
  state: State;
  /** Earliest time the next search may start (the skip cool-down). */
  nextAt: number;
  cooldownTimer: ReturnType<typeof setTimeout> | null;
  retryTimers: ReturnType<typeof setTimeout>[];
  partner: Session | null;
  chat: Chat | null;
  sent: number[];
  blocked: Set<string>;
  tags: string[];
  lang: string;
  gender: string;
}

/**
 * All the rules of the chat, with no sockets and no database in it:
 * who is looking, who gets paired, what is relayed, who is removed.
 * The outside world is passed in, so the same code runs in production and in fast tests.
 */
export class ChatEngine {
  private sessions = new Map<string, Session>();
  private waiting: Session[] = [];

  constructor(private deps: EngineDeps) {}

  /** People who have said hello (confirmed 18+) and are connected. */
  online(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.state !== "new") n++;
    return n;
  }

  /** Connection IDs of everyone counted in `online()`. */
  presentIds(): string[] {
    return [...this.sessions.values()].filter((s) => s.state !== "new").map((s) => s.id);
  }

  connect(id: string, visitor: string): void {
    this.sessions.set(id, {
      id,
      visitor,
      mode: "text",
      tags: [],
      lang: "",
      gender: "",
      queuedAt: 0,
      lastPartner: "",
      blocked: new Set(),
      state: "new",
      nextAt: 0,
      cooldownTimer: null,
      retryTimers: [],
      partner: null,
      chat: null,
      sent: [],
    });
  }

  disconnect(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.leave(s);
    this.sessions.delete(id);
    if (s.state !== "new") this.deps.onPresence?.();
  }

  /** Handle one message from one connection. Messages from the same connection must be handled in order. */
  async handle(id: string, msg: ClientMessage): Promise<void> {
    const s = this.sessions.get(id);
    if (!s || msg.t === "ping") return;
    if (msg.t === "hello") return this.hello(s, msg);
    if (s.state === "new") return; // nothing else is allowed before hello
    switch (msg.t) {
      case "find":
        return this.find(s);
      case "stop":
        return this.stop(s);
      case "msg":
        return this.message(s, msg.text);
      case "typing":
        if (s.partner) this.send(s.partner, { t: "typing" });
        return;
    }
  }

  /** Remove someone from the site for a while: ends their chats and closes every connection of theirs. */
  async ban(visitor: string, hours: number, reason: BanReason): Promise<Ban> {
    const ban = await this.deps.bans.add(visitor, hours, reason);
    this.kick(visitor, ban);
    return ban;
  }

  /** Never match this connection with that visitor again (used after a report). */
  block(id: string, visitor: string): void {
    this.sessions.get(id)?.blocked.add(visitor);
  }

  // ---- steps ----

  private async hello(s: Session, msg: Extract<ClientMessage, { t: "hello" }>): Promise<void> {
    if (await this.refuseIfBanned(s)) return;
    if (!this.sessions.has(s.id)) return; // they left while we checked
    this.leave(s);
    const first = s.state === "new";
    s.mode = msg.mode;
    s.tags = cleanTags(msg.tags);
    s.lang = msg.lang ?? "";
    s.gender = msg.gender ?? "";
    s.state = "idle";
    if (first) this.deps.onPresence?.();
    this.send(s, { t: "ready", online: this.online() });
  }

  private async find(s: Session): Promise<void> {
    if (await this.refuseIfBanned(s)) return;
    if (!this.sessions.has(s.id)) return;
    this.leave(s);
    const now = Date.now();
    const wait = Math.max(0, s.nextAt - now);
    s.nextAt = now + wait + SKIP_MS;
    if (wait > 0) {
      s.state = "cooldown";
      this.send(s, { t: "wait", ms: wait });
      s.cooldownTimer = setTimeout(() => {
        s.cooldownTimer = null;
        this.enqueue(s);
      }, wait);
    } else {
      this.enqueue(s);
    }
  }

  private stop(s: Session): void {
    this.leave(s);
  }

  private message(s: Session, raw: string): void {
    const partner = s.partner;
    if (s.state !== "chatting" || !partner || !s.chat) return;
    const text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) return;

    const now = Date.now();
    s.sent = s.sent.filter((t) => now - t < FLOOD_WINDOW_MS);
    if (s.sent.length >= FLOOD_MAX) {
      this.send(s, {
        t: "error",
        code: "too_fast",
        text: "That message wasn't sent. You're sending messages too fast.",
      });
      return;
    }
    s.sent.push(now);

    s.chat.log.push({ from: s.id, x: text });
    if (s.chat.log.length > LOG_KEEP) s.chat.log.shift();

    if (statedMinorAge(text) !== null) {
      // The message is not delivered. A moderator can review the report.
      this.removeMinor(s).catch((err) =>
        this.deps.onError?.(err, "removing someone who said they are under 18"),
      );
      return;
    }
    s.chat.messages++;
    this.send(partner, { t: "msg", text });
  }

  // ---- matching ----

  private enqueue(s: Session): void {
    s.state = "searching";
    s.queuedAt = Date.now();
    this.waiting.push(s);
    this.send(s, { t: "waiting" });
    this.seek(s);
    if (s.state === "searching") {
      // Interests are only required for a few seconds: look again when the fallback opens up.
      s.retryTimers = [
        setTimeout(() => this.seek(s), FALLBACK_MS + 50),
        setTimeout(() => this.seek(s), 2 * FALLBACK_MS + 50),
      ];
    }
  }

  private seek(s: Session): void {
    if (s.state !== "searching") return;
    const other = bestPartner(s, this.waiting, Date.now());
    if (other) this.pair(s, other);
  }

  private pair(a: Session, b: Session): void {
    this.dequeue(a);
    this.dequeue(b);
    const chat: Chat = { startedAt: Date.now(), messages: 0, log: [] };
    a.partner = b;
    b.partner = a;
    a.chat = b.chat = chat;
    a.state = b.state = "chatting";
    a.lastPartner = b.id;
    b.lastPartner = a.id;
    const common = sharedTags(a, b);
    this.send(a, { t: "matched", common, init: true });
    this.send(b, { t: "matched", common, init: false });
  }

  private dequeue(s: Session): void {
    if (s.cooldownTimer) clearTimeout(s.cooldownTimer);
    s.cooldownTimer = null;
    for (const t of s.retryTimers) clearTimeout(t);
    s.retryTimers = [];
    const i = this.waiting.indexOf(s);
    if (i >= 0) this.waiting.splice(i, 1);
  }

  /** Stop searching and leave any chat. The other person is told. Back to idle. */
  private leave(s: Session): void {
    this.dequeue(s);
    const partner = s.partner;
    if (partner) {
      s.partner = partner.partner = null;
      s.chat = partner.chat = null;
      partner.state = "idle";
      this.send(partner, { t: "ended" });
    }
    if (s.state !== "new") s.state = "idle";
  }

  // ---- removal ----

  private async refuseIfBanned(s: Session): Promise<boolean> {
    const ban = await this.deps.bans.get(s.visitor);
    if (!ban) return false;
    this.kick(s.visitor, ban);
    return true;
  }

  private kick(visitor: string, ban: Ban): void {
    for (const s of [...this.sessions.values()]) {
      if (s.visitor !== visitor) continue;
      this.leave(s);
      this.send(s, { t: "banned", until: ban.until, reason: ban.reason });
      this.deps.transport.close(s.id, 4003, "banned");
    }
  }

  private async removeMinor(s: Session): Promise<void> {
    const transcript = (s.chat?.log ?? []).map((e) => ({
      who: e.from === s.id ? ("reported" as const) : ("reporter" as const),
      x: e.x,
    }));
    await this.deps.reports.file({
      reporter: "system",
      reported: s.visitor,
      reason: "underage",
      mode: s.mode,
      transcript,
    });
    await this.ban(s.visitor, AGE_BAN_HOURS, "age");
  }

  private send(s: Session, msg: ServerMessage): void {
    this.deps.transport.send(s.id, msg);
  }
}
