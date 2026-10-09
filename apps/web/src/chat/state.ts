import type { BanReason, ServerMessage } from "@passerby/shared";

/** Where the visitor is in the chat. */
export type Phase = "idle" | "cooldown" | "searching" | "chatting" | "ended" | "banned";

export interface Line {
  id: number;
  /** me = sent by this visitor, them = the stranger, sys = a notice from the site. */
  kind: "me" | "them" | "sys";
  text: string;
}

export interface ChatState {
  phase: Phase;
  lines: Line[];
  /** The stranger is typing right now. */
  typing: boolean;
  /** When the cool-down before searching ends (milliseconds since 1970), or null. */
  waitUntil: number | null;
  banned: { until: number; reason: BanReason } | null;
  /** Incremented for every new line, so each has a stable key. */
  nextId: number;
}

export const initialChat: ChatState = {
  phase: "idle",
  lines: [],
  typing: false,
  waitUntil: null,
  banned: null,
  nextId: 1,
};

export type Action =
  | { type: "server"; msg: ServerMessage; now: number; siteName: string }
  /** The visitor pressed Start or Next. */
  | { type: "start" }
  /** The visitor sent a message. */
  | { type: "sent"; text: string }
  /** The visitor pressed Stop. */
  | { type: "stop" }
  /** The connection to the server dropped. */
  | { type: "dropped" }
  /** The "stranger is typing" notice timed out. */
  | { type: "typingOff" }
  /** Something to tell the visitor in the conversation (for example, the camera was blocked). */
  | { type: "notice"; text: string };

const add = (s: ChatState, kind: Line["kind"], text: string): ChatState => ({
  ...s,
  lines: [...s.lines, { id: s.nextId, kind, text }],
  nextId: s.nextId + 1,
});

const when = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export function bannedNotice(siteName: string, b: { until: number; reason: BanReason }): string {
  return b.reason === "age"
    ? `${siteName} is for adults only. You're blocked until ${when(b.until)}.`
    : `You were removed for breaking the rules. You can come back after ${when(b.until)}.`;
}

export function chatReducer(s: ChatState, a: Action): ChatState {
  switch (a.type) {
    case "start":
      if (s.phase === "banned") return s;
      return { ...s, phase: "searching", lines: [], typing: false, waitUntil: null };

    case "stop":
      if (s.phase === "banned") return s;
      return { ...s, phase: "idle", lines: [], typing: false, waitUntil: null };

    case "sent":
      return s.phase === "chatting" ? add(s, "me", a.text) : s;

    case "notice":
      return add(s, "sys", a.text);

    case "typingOff":
      return s.typing ? { ...s, typing: false } : s;

    case "dropped":
      if (s.phase === "idle" || s.phase === "banned") return s;
      return add(
        { ...s, phase: "idle", typing: false, waitUntil: null },
        "sys",
        "The connection dropped. Press Start to try again.",
      );

    case "server":
      return onServer(s, a.msg, a.now, a.siteName);
  }
}

function onServer(s: ChatState, msg: ServerMessage, now: number, siteName: string): ChatState {
  switch (msg.t) {
    case "waiting":
      // Ignore a late "waiting" if the visitor has already stopped.
      return s.phase === "searching" || s.phase === "cooldown"
        ? { ...s, phase: "searching", waitUntil: null }
        : s;

    case "wait":
      return s.phase === "searching" || s.phase === "cooldown"
        ? { ...s, phase: "cooldown", waitUntil: now + msg.ms }
        : s;

    case "matched": {
      if (s.phase !== "searching" && s.phase !== "cooldown") return s;
      const hello = msg.common.length
        ? `You both like ${msg.common.join(", ")}. Say hi.`
        : "You're connected. Say hi.";
      return add(
        { ...s, phase: "chatting", lines: [], typing: false, waitUntil: null },
        "sys",
        hello,
      );
    }

    case "msg":
      return s.phase === "chatting" ? add({ ...s, typing: false }, "them", msg.text) : s;

    case "typing":
      return s.phase === "chatting" ? { ...s, typing: true } : s;

    case "ended":
      return s.phase === "chatting"
        ? add({ ...s, phase: "ended", typing: false }, "sys", "The stranger left.")
        : s;

    case "banned": {
      const banned = { until: msg.until, reason: msg.reason };
      return add(
        { ...s, phase: "banned", lines: [], typing: false, waitUntil: null, banned },
        "sys",
        bannedNotice(siteName, banned),
      );
    }

    case "error":
      return add(s, "sys", msg.text);

    case "ready":
    case "count":
    case "sig": // video setup is handled by the video call, not the conversation
      return s;
  }
}

/** The line of text under the header: what is going on right now. */
export function statusText(s: ChatState, now: number, connected: boolean): string {
  switch (s.phase) {
    case "idle":
      return connected ? "Ready when you are" : "Connecting…";
    case "cooldown": {
      const left = Math.max(1, Math.ceil(((s.waitUntil ?? now) - now) / 1000));
      return `Finding someone in ${left} ${left === 1 ? "second" : "seconds"}.`;
    }
    case "searching":
      return "Looking for someone…";
    case "chatting":
      return s.typing ? "Stranger is typing…" : "You're talking to a stranger";
    case "ended":
      return "Chat ended. Press Next to meet someone else.";
    case "banned":
      return "You can't chat right now";
  }
}
