import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "../src/admin/csv.js";
import { fillHours, startOfHour } from "../src/admin/hours.js";
import { ADMIN_MS, AdminSessions } from "../src/admin/session.js";
import type { Db } from "../src/db.js";
import { HourlyStats } from "../src/stats.js";

const SECRET = "admin-session-secret-1234";

describe("admin sign-ins", () => {
  const clock = () => {
    let t = 1_800_000_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("accepts a sign-in it created, and nothing else", () => {
    const c = clock();
    const s = new AdminSessions(SECRET, c.now);
    const token = s.create();
    expect(s.valid(token)).toBe(true);
    expect(s.valid(undefined)).toBe(false);
    expect(s.valid("")).toBe(false);
    expect(s.valid("a.b.c")).toBe(false);
    expect(s.valid(token + "x")).toBe(false);
    expect(s.valid("not a token")).toBe(false);
  });

  it("refuses a cookie signed with another secret, or edited", () => {
    const c = clock();
    const mine = new AdminSessions(SECRET, c.now);
    const theirs = new AdminSessions("another-secret-entirely-1234", c.now);
    const forged = theirs.create();
    expect(mine.valid(forged)).toBe(false);
    const token = mine.create();
    const [id, expiry, sig] = token.split(".") as [string, string, string];
    expect(mine.valid(`${id}.${Number(expiry) + 9_999_999}.${sig}`)).toBe(false); // longer life
    expect(mine.valid(`${id}x.${expiry}.${sig}`)).toBe(false);
  });

  it("refuses a validly signed cookie that this server never issued (after a restart)", () => {
    const c = clock();
    const before = new AdminSessions(SECRET, c.now);
    const token = before.create();
    const after = new AdminSessions(SECRET, c.now); // a restarted server remembers nothing
    expect(after.valid(token)).toBe(false);
  });

  it("expires after twelve hours", () => {
    const c = clock();
    const s = new AdminSessions(SECRET, c.now);
    const token = s.create();
    c.advance(ADMIN_MS - 1000);
    expect(s.valid(token)).toBe(true);
    c.advance(2000);
    expect(s.valid(token)).toBe(false);
  });

  it("ends one sign-in on sign-out, even if the cookie is copied", () => {
    const c = clock();
    const s = new AdminSessions(SECRET, c.now);
    const a = s.create();
    const b = s.create();
    s.revoke(a);
    expect(s.valid(a)).toBe(false);
    expect(s.valid(b)).toBe(true);
  });

  it("can end every sign-in", () => {
    const s = new AdminSessions(SECRET);
    const tokens = [s.create(), s.create(), s.create()];
    s.revokeAll();
    expect(tokens.some((t) => s.valid(t))).toBe(false);
    expect(s.size).toBe(0);
  });

  it("forgets expired sign-ins so memory does not grow forever", () => {
    const c = clock();
    const s = new AdminSessions(SECRET, c.now);
    for (let i = 0; i < 20; i++) s.create();
    c.advance(ADMIN_MS + 1);
    s.create();
    expect(s.size).toBe(1);
  });

  it("gives every sign-in its own ID", () => {
    const s = new AdminSessions(SECRET);
    expect(new Set(Array.from({ length: 50 }, () => s.create())).size).toBe(50);
  });
});

describe("CSV cells", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("login")).toBe("login");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes cells with commas, quotes or line breaks, doubling the quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("defuses spreadsheet formulas", () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("=1")).toBe("'=1");
  });

  it("does not touch a minus or plus in the middle", () => {
    expect(csvCell("a-b+c")).toBe("a-b+c");
  });

  it("makes a row end with a Windows line break", () => {
    expect(csvRow(["a", "b,c", 3])).toBe('a,"b,c",3\r\n');
  });
});

describe("the last 24 hours", () => {
  const HOUR = 3_600_000;
  const now = Date.UTC(2026, 9, 9, 14, 37, 12);
  const row = (hoursAgo: number, over: Record<string, number> = {}) => ({
    hour: new Date(startOfHour(now) - hoursAgo * HOUR),
    visitors: 0,
    chats: 0,
    videoChats: 0,
    messages: 0,
    reports: 0,
    bans: 0,
    peakOnline: 0,
    ...over,
  });

  it("always has 24 entries, oldest first, ending with the current hour", () => {
    const hours = fillHours([], now);
    expect(hours).toHaveLength(24);
    expect(hours.at(-1)!.hour).toBe("2026-10-09T14:00:00.000Z");
    expect(hours[0]!.hour).toBe("2026-10-08T15:00:00.000Z");
    for (let i = 1; i < hours.length; i++) {
      expect(Date.parse(hours[i]!.hour) - Date.parse(hours[i - 1]!.hour)).toBe(HOUR);
    }
  });

  it("puts recorded hours in the right place and fills the rest with zeros", () => {
    const hours = fillHours([row(0, { chats: 5, peakOnline: 9 }), row(3, { visitors: 2 })], now);
    expect(hours[23]).toMatchObject({ chats: 5, peakOnline: 9 });
    expect(hours[20]).toMatchObject({ visitors: 2 });
    expect(hours[22]).toMatchObject({ visitors: 0, chats: 0, messages: 0 });
  });

  it("ignores rows older than 24 hours", () => {
    const hours = fillHours([row(30, { chats: 99 })], now);
    expect(hours.every((h) => h.chats === 0)).toBe(true);
  });
});

describe("the hourly counters", () => {
  it("adds up what happened this hour and remembers the peak", () => {
    const stats = new HourlyStats(() => Date.UTC(2026, 9, 9, 14, 5));
    stats.add("chats");
    stats.add("chats");
    stats.add("chatSeconds", 90);
    stats.online(3);
    stats.online(7);
    stats.online(4);
    const [row] = [...stats.pending().values()];
    expect(row).toMatchObject({ chats: 2, chatSeconds: 90, peakOnline: 7 });
  });

  it("starts a new hour with the people who are already here as its peak", () => {
    let t = Date.UTC(2026, 9, 9, 14, 55);
    const stats = new HourlyStats(() => t);
    stats.online(5);
    t = Date.UTC(2026, 9, 9, 15, 2);
    stats.add("messages");
    const rows = [...stats.pending().entries()].sort(([a], [b]) => a - b);
    expect(rows).toHaveLength(2);
    expect(rows[1]![1]).toMatchObject({ messages: 1, peakOnline: 5 });
  });

  /** A stand-in database that records what was written, or fails on demand. */
  const fakeDb = (fail: () => boolean) => {
    const written: unknown[][] = [];
    const db = {
      $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        if (fail()) throw new Error("database is down");
        written.push(values);
        return 1;
      },
    } as unknown as Db;
    return { db, written };
  };

  it("writes the counts and starts again from zero", async () => {
    const stats = new HourlyStats(() => Date.UTC(2026, 9, 9, 14, 5));
    stats.add("visitors", 3);
    const { db, written } = fakeDb(() => false);
    await stats.flush(db);
    expect(written).toHaveLength(1);
    expect(written[0]![1]).toBe(3); // visitors
    await stats.flush(db);
    expect(written[1]![1]).toBe(0); // nothing new was counted
  });

  it("keeps the counts when the database is down and adds them to the next write", async () => {
    const stats = new HourlyStats(() => Date.UTC(2026, 9, 9, 14, 5));
    stats.add("visitors", 3);
    let down = true;
    const { db, written } = fakeDb(() => down);
    await expect(stats.flush(db)).rejects.toThrow("database is down");
    stats.add("visitors", 2); // counted while it was down
    down = false;
    await stats.flush(db);
    expect(written.at(-1)![1]).toBe(5);
  });
});
