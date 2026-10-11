import type { StatCounter, StatsSink } from "./chat/engine.js";
import type { Db } from "./db.js";

const HOUR = 3_600_000;

type Row = Record<StatCounter, number> & { peakOnline: number };

const blank = (peak = 0): Row => ({
  visitors: 0,
  chats: 0,
  videoChats: 0,
  messages: 0,
  reports: 0,
  bans: 0,
  chatsEnded: 0,
  chatSeconds: 0,
  peakOnline: peak,
});

/**
 * Counts what happened this hour (visitors, chats, messages and so on) in memory, and writes the totals to
 * the database every so often, so the dashboard's charts cost the chat nothing. If a write fails the
 * numbers are kept and added to the next one.
 */
export class HourlyStats implements StatsSink {
  private rows = new Map<number, Row>();
  private lastOnline = 0;

  constructor(private now: () => number = Date.now) {}

  add(counter: StatCounter, n = 1): void {
    this.row()[counter] += n;
  }

  online(n: number): void {
    this.lastOnline = n;
    const r = this.row();
    r.peakOnline = Math.max(r.peakOnline, n);
  }

  /** The hour being counted now. A new hour starts with however many people are already here. */
  private row(): Row {
    const hour = Math.floor(this.now() / HOUR) * HOUR;
    let r = this.rows.get(hour);
    if (!r) {
      r = blank(this.lastOnline);
      this.rows.set(hour, r);
    }
    return r;
  }

  /** What is waiting to be written (for tests). */
  pending(): Map<number, Row> {
    return this.rows;
  }

  /** Write what has been counted so far, then start again from zero. */
  async flush(db: Db): Promise<void> {
    this.row(); // make sure the current hour exists, so its peak is recorded even in a quiet hour
    const batch = [...this.rows];
    this.rows = new Map();
    for (const [hour, r] of batch) {
      try {
        await db.$executeRaw`
          INSERT INTO "hourly_stats"
            ("hour", "visitors", "chats", "videoChats", "messages", "reports", "bans", "chatsEnded", "chatSeconds", "peakOnline")
          VALUES
            (${new Date(hour)}, ${r.visitors}, ${r.chats}, ${r.videoChats}, ${r.messages}, ${r.reports}, ${r.bans}, ${r.chatsEnded}, ${r.chatSeconds}, ${r.peakOnline})
          ON CONFLICT ("hour") DO UPDATE SET
            "visitors" = "hourly_stats"."visitors" + EXCLUDED."visitors",
            "chats" = "hourly_stats"."chats" + EXCLUDED."chats",
            "videoChats" = "hourly_stats"."videoChats" + EXCLUDED."videoChats",
            "messages" = "hourly_stats"."messages" + EXCLUDED."messages",
            "reports" = "hourly_stats"."reports" + EXCLUDED."reports",
            "bans" = "hourly_stats"."bans" + EXCLUDED."bans",
            "chatsEnded" = "hourly_stats"."chatsEnded" + EXCLUDED."chatsEnded",
            "chatSeconds" = "hourly_stats"."chatSeconds" + EXCLUDED."chatSeconds",
            "peakOnline" = GREATEST("hourly_stats"."peakOnline", EXCLUDED."peakOnline")`;
      } catch (err) {
        this.restore(hour, r);
        throw err;
      }
    }
  }

  /** Put numbers back after a failed write, adding to anything counted since. */
  private restore(hour: number, r: Row): void {
    const now = this.rows.get(hour);
    if (!now) {
      this.rows.set(hour, r);
      return;
    }
    for (const key of Object.keys(r) as (keyof Row)[]) {
      now[key] = key === "peakOnline" ? Math.max(now[key], r[key]) : now[key] + r[key];
    }
  }
}
