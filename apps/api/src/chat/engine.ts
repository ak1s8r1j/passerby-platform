import {
  isCountryCode,
  cleanTags,
  MAX_MESSAGE_LENGTH,
  type BanReason,
  type ChatMode,
  type ClientMessage,
  type GameMessage,
  type Reaction,
  type ReportReason,
  type ServerMessage,
} from "@passerby/shared";
import type { EventSink } from "../events.js";
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
/** This many different people reporting the same person within the window pauses that person automatically. */
export const REPORT_BAN_COUNT = 3;
export const REPORT_WINDOW_HOURS = 24;
export const REPORT_BAN_HOURS = 24;
/** A chat can still be reported for this long after it ends (the other person often leaves first). */
export const RECENT_CHAT_MS = 5 * 60_000;
/** A video chat needs a few dozen setup messages. This many is plenty; more is someone abusing the channel. */
export const MAX_SIGNALS = 300;
/** Game moves and invitations relayed in one chat. A few games use a few dozen; more is abuse. */
export const MAX_GAME_MESSAGES = 400;
/** Reactions relayed in one chat. Plenty for a conversation; more is someone spamming. */
export const MAX_REACTIONS = 150;
/** The least time between one person's reactions, so they cannot flood the other screen. */
export const REACTION_GAP_MS = 250;
/** The least time between one person's game invitations in a chat, so nobody can be pestered. */
export const GAME_INVITE_GAP_MS = 15_000;

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
  /**
   * How many different people have reported this visitor within the last `hours` hours.
   * Automatic reports and reports made from the same address do not count.
   */
  reportersOf(visitor: string, hours: number): Promise<number>;
}

/** The counters behind the admin dashboard's charts. */
export type StatCounter =
  | "visitors"
  | "chats"
  | "videoChats"
  | "messages"
  | "reports"
  | "bans"
  | "chatsEnded"
  | "chatSeconds";

export interface StatsSink {
  add(counter: StatCounter, n?: number): void;
  /** Tell it how many people are online now, so it can remember the peak. */
  online(n: number): void;
}

/** What the admin dashboard shows as "right now". */
export interface LiveSnapshot {
  online: number;
  text: number;
  video: number;
  searching: number;
  chatting: number;
}

export interface EngineDeps {
  transport: Transport;
  bans: BanStore;
  reports: ReportSink;
  /** Called when someone arrives or leaves, so the live count can be pushed out. */
  onPresence?: () => void;
  onError?: (err: unknown, what: string) => void;
  /** When false, everyone is treated as a text chatter, even if they ask for video. Default true. */
  videoEnabled?: boolean;
  /** Counters for the dashboard. */
  stats?: StatsSink;
  /** The activity log (reports and bans). */
  events?: EventSink;
}

// ---- state ----

type State = "new" | "idle" | "cooldown" | "searching" | "chatting";

interface Chat {
  startedAt: number;
  messages: number;
  /** Video setup messages relayed so far in this chat. */
  signals: number;
  /** Game messages relayed so far in this chat. */
  games: number;
  /** When each person (by connection) last sent a game invitation. */
  invited: Map<string, number>;
  /** Reactions relayed so far in this chat. */
  reactions: number;
  /** When each person (by connection) last sent a reaction. */
  reacted: Map<string, number>;
  log: { from: string; x: string }[];
  /** Connection IDs of people who have reported this chat. */
  reported: Set<string>;
}

/** What someone remembers of the chat that just ended, so they can still report it. */
interface Recent {
  /** The other person's visitor ID. */
  visitor: string;
  log: Chat["log"];
  /** The connection ID that marks "my" lines in the log. */
  mine: string;
  mode: ChatMode;
  at: number;
  reported: boolean;
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
  recent: Recent | null;
  tags: string[];
  lang: string;
  gender: string;
  seek: string;
  country: string;
  seekCountries: string[];
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

  /** A count of who is doing what, for the admin dashboard. */
  snapshot(): LiveSnapshot {
    const out: LiveSnapshot = { online: 0, text: 0, video: 0, searching: 0, chatting: 0 };
    for (const s of this.sessions.values()) {
      if (s.state === "new") continue;
      out.online++;
      if (s.mode === "video") out.video++;
      else out.text++;
      if (s.state === "searching" || s.state === "cooldown") out.searching++;
      if (s.state === "chatting") out.chatting++;
    }
    return out;
  }

  /** Connection IDs of everyone counted in `online()`. */
  presentIds(): string[] {
    return [...this.sessions.values()].filter((s) => s.state !== "new").map((s) => s.id);
  }

  /** `country` is where the connection comes from, worked out by the server (never told by the browser). */
  connect(id: string, visitor: string, country = ""): void {
    this.sessions.set(id, {
      id,
      visitor,
      mode: "text",
      tags: [],
      lang: "",
      gender: "",
      seek: "",
      country,
      seekCountries: [],
      queuedAt: 0,
      lastPartner: "",
      blocked: new Set(),
      recent: null,
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
    if (s.state !== "new") this.presence();
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
      case "sig":
        return this.relay(s, { t: "sig", d: msg.d });
      case "report":
        return this.report(s, msg.reason);
      case "cam":
        return this.relay(s, { t: "cam", virtual: msg.virtual });
      case "game":
        return this.game(s, msg.g);
      case "react":
        return this.react(s, msg.e);
    }
  }

  /**
   * Remove someone from the site for a while: ends their chats and closes every connection of theirs.
   * `by` says who decided, for the activity log.
   */
  async ban(
    visitor: string,
    hours: number,
    reason: BanReason,
    by: "system" | "admin" = "system",
  ): Promise<Ban> {
    const ban = await this.deps.bans.add(visitor, hours, reason);
    this.deps.stats?.add("bans");
    this.deps.events?.record({ kind: by, type: "ban", visitor, detail: `${hours}h, ${reason}` });
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
    s.mode = msg.mode === "video" && this.deps.videoEnabled !== false ? "video" : "text";
    s.tags = cleanTags(msg.tags);
    s.lang = msg.lang ?? "";
    s.gender = msg.gender ?? "";
    s.seek = msg.seek ?? "";
    s.seekCountries = [...new Set(msg.countries ?? [])];
    s.state = "idle";
    if (first) {
      this.deps.stats?.add("visitors");
      this.presence();
    }
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

  /** Something typed by a person in a chat: checked, counted and remembered for reports, then delivered. */
  private message(s: Session, raw: string): void {
    const text = this.typed(s, raw);
    if (text !== null && s.partner) this.send(s.partner, { t: "msg", text });
  }

  /**
   * Everything a line of typed text goes through, whether it is a chat message or a line in a game: the
   * length limit, the flood limit, the log kept for reports, and the check for someone saying they are
   * under 18. Returns the text to deliver, or null when it must not be delivered.
   */
  private typed(s: Session, raw: string): string | null {
    const partner = s.partner;
    if (s.state !== "chatting" || !partner || !s.chat) return null;
    const text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) return null;

    const now = Date.now();
    s.sent = s.sent.filter((t) => now - t < FLOOD_WINDOW_MS);
    if (s.sent.length >= FLOOD_MAX) {
      this.send(s, {
        t: "error",
        code: "too_fast",
        text: "That message wasn't sent. You're sending messages too fast.",
      });
      return null;
    }
    s.sent.push(now);

    s.chat.log.push({ from: s.id, x: text });
    if (s.chat.log.length > LOG_KEEP) s.chat.log.shift();

    if (statedMinorAge(text) !== null) {
      // The message is not delivered. A moderator can review the report.
      this.removeMinor(s).catch((err) =>
        this.deps.onError?.(err, "removing someone who said they are under 18"),
      );
      return null;
    }
    s.chat.messages++;
    this.deps.stats?.add("messages");
    return text;
  }

  /**
   * Report the person in this chat, or in the chat that just ended. The chat ends, the reporter is never
   * matched with them again, and the last messages are saved for a moderator. Enough different reporters
   * in a day pause the person automatically.
   */
  private async report(s: Session, reason: ReportReason): Promise<void> {
    let target: { visitor: string; log: Chat["log"]; mine: string; mode: ChatMode } | null = null;
    let inChat = false;
    if (s.state === "chatting" && s.partner && s.chat) {
      if (s.chat.reported.has(s.id)) return; // already reported this chat
      s.chat.reported.add(s.id);
      target = { visitor: s.partner.visitor, log: [...s.chat.log], mine: s.id, mode: s.mode };
      inChat = true;
    } else if (s.recent && !s.recent.reported && Date.now() - s.recent.at < RECENT_CHAT_MS) {
      s.recent.reported = true;
      const r = s.recent;
      target = { visitor: r.visitor, log: r.log, mine: r.mine, mode: r.mode };
    }
    if (!target) {
      this.send(s, {
        t: "error",
        code: "nothing_to_report",
        text: "There's no recent chat to report.",
      });
      return;
    }

    if (inChat) this.leave(s); // the other person is told the chat ended; they are not told why
    s.blocked.add(target.visitor);
    const mine = target.mine;
    await this.deps.reports.file({
      reporter: s.visitor,
      reported: target.visitor,
      reason,
      mode: target.mode,
      transcript: target.log.map((e) => ({
        who: e.from === mine ? ("reporter" as const) : ("reported" as const),
        x: e.x,
      })),
    });
    this.deps.stats?.add("reports");
    this.deps.events?.record({
      kind: "user",
      type: "report",
      visitor: s.visitor,
      detail: `${reason} against ${target.visitor.slice(0, 8)}`,
    });
    this.send(s, { t: "reported" });

    // Reports from the same address (or this person's own) never count towards pausing someone.
    if (target.visitor === s.visitor) return;
    const reporters = await this.deps.reports.reportersOf(target.visitor, REPORT_WINDOW_HOURS);
    if (reporters >= REPORT_BAN_COUNT && !(await this.deps.bans.get(target.visitor))) {
      await this.ban(target.visitor, REPORT_BAN_HOURS, "reports");
    }
  }

  /**
   * Pass a video setup message (or a camera notice) to the other person. Only between two video chatters,
   * only in a chat, and only up to a generous limit per chat.
   */
  private relay(s: Session, msg: ServerMessage): void {
    const partner = s.partner;
    if (s.state !== "chatting" || !partner || !s.chat) return;
    if (s.mode !== "video" || partner.mode !== "video") return;
    if (s.chat.signals >= MAX_SIGNALS) return;
    s.chat.signals++;
    this.send(partner, msg);
  }

  /**
   * Pass a game message to the other person. Works in text and video chats, only while chatting, and only
   * up to a limit. Invitations are spaced out; the rest of the message is only shape-checked, since the
   * rules are the browsers' business.
   */
  private game(s: Session, g: GameMessage): void {
    const partner = s.partner;
    if (s.state !== "chatting" || !partner || !s.chat) return;
    if (s.chat.games >= MAX_GAME_MESSAGES) return;
    if (g.k === "invite") {
      const now = Date.now();
      const last = s.chat.invited.get(s.id);
      if (last !== undefined && now - last < GAME_INVITE_GAP_MS) return;
      s.chat.invited.set(s.id, now);
    }
    if (g.k === "say") {
      // Lines of text in a game are held to the same rules as chat messages.
      const text = this.typed(s, g.text);
      if (text === null) return;
      s.chat.games++;
      this.send(partner, { t: "game", g: { k: "say", i: g.i, text } });
      return;
    }
    s.chat.games++;
    this.send(partner, { t: "game", g });
  }

  /**
   * Pass a quick reaction to the other person. Only while chatting, no faster than one every
   * REACTION_GAP_MS, and only up to MAX_REACTIONS per chat. The emoji is one of a fixed few (checked when
   * the message is read), so there is nothing to moderate.
   */
  private react(s: Session, e: Reaction): void {
    const partner = s.partner;
    if (s.state !== "chatting" || !partner || !s.chat) return;
    if (s.chat.reactions >= MAX_REACTIONS) return;
    const now = Date.now();
    const last = s.chat.reacted.get(s.id);
    if (last !== undefined && now - last < REACTION_GAP_MS) return;
    s.chat.reacted.set(s.id, now);
    s.chat.reactions++;
    this.send(partner, { t: "react", e });
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
    const chat: Chat = {
      startedAt: Date.now(),
      messages: 0,
      signals: 0,
      games: 0,
      invited: new Map(),
      reactions: 0,
      reacted: new Map(),
      log: [],
      reported: new Set(),
    };
    this.deps.stats?.add("chats");
    if (a.mode === "video" && b.mode === "video") this.deps.stats?.add("videoChats");
    a.partner = b;
    b.partner = a;
    a.chat = b.chat = chat;
    a.state = b.state = "chatting";
    a.lastPartner = b.id;
    b.lastPartner = a.id;
    const common = sharedTags(a, b);
    const from = (s: Session) => (isCountryCode(s.country) ? { country: s.country } : {});
    this.send(a, { t: "matched", common, init: true, ...from(b) });
    this.send(b, { t: "matched", common, init: false, ...from(a) });
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
      const chat = s.chat;
      if (chat) {
        // Both people may still report it for a few minutes.
        s.recent = this.remember(s, partner, chat);
        partner.recent = this.remember(partner, s, chat);
        this.deps.stats?.add("chatsEnded");
        this.deps.stats?.add("chatSeconds", Math.round((Date.now() - chat.startedAt) / 1000));
      }
      s.partner = partner.partner = null;
      s.chat = partner.chat = null;
      partner.state = "idle";
      this.send(partner, { t: "ended" });
    }
    if (s.state !== "new") s.state = "idle";
  }

  private remember(me: Session, other: Session, chat: Chat): Recent {
    return {
      visitor: other.visitor,
      log: [...chat.log],
      mine: me.id,
      mode: me.mode,
      at: Date.now(),
      reported: chat.reported.has(me.id),
    };
  }

  private presence(): void {
    this.deps.stats?.online(this.online());
    this.deps.onPresence?.();
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
    this.deps.stats?.add("reports");
    await this.ban(s.visitor, AGE_BAN_HOURS, "age");
  }

  private send(s: Session, msg: ServerMessage): void {
    this.deps.transport.send(s.id, msg);
  }
}
