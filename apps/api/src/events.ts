import type { Db } from "./db.js";
import type { Logger } from "./logger.js";

/**
 * The activity log: what visitors, moderators and the server did. It never holds message text,
 * passwords, emails or raw IP addresses. People appear only as the first 8 characters of their scrambled ID.
 */
export interface AppEvent {
  kind: "user" | "admin" | "system";
  /** A short name such as "register" or "login_failed". */
  type: string;
  /** The scrambled visitor ID (only its first 8 characters are kept), if there is one. */
  visitor?: string;
  detail?: string;
}

export interface EventSink {
  /** Fire and forget: a problem writing the log must never break what the visitor was doing. */
  record(event: AppEvent): void;
}

export function prismaEvents(db: Db, logger: Logger): EventSink {
  return {
    record(e) {
      db.event
        .create({
          data: {
            kind: e.kind,
            type: e.type,
            visitor: (e.visitor ?? "").slice(0, 8),
            detail: (e.detail ?? "").slice(0, 200),
          },
        })
        .catch((err) => logger.warn({ err }, "could not record an event"));
    },
  };
}

export const noEvents: EventSink = { record() {} };
