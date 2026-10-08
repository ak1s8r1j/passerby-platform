import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, dbHealth, type Db } from "../src/db.js";

let db: Db;
beforeAll(() => {
  db = createDb(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("database", () => {
  it("answers the health check", async () => {
    expect(await dbHealth(db).ping()).toBe(true);
  });

  it("has every table from the schema after migrating", async () => {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = rows.map((r) => r.table_name);
    for (const t of ["users", "pass_claims", "bans", "reports", "events", "hourly_stats"]) {
      expect(names).toContain(t);
    }
  });

  it("keeps emails unique", async () => {
    const make = (email: string) =>
      db.user.create({ data: { email, displayName: "Sam", passwordHash: "x", signupRef: "ref" } });
    await make("sam@example.com");
    await expect(make("sam@example.com")).rejects.toThrow();
  });

  it("stores and reads log events newest first", async () => {
    await db.event.createMany({
      data: [
        { kind: "user", type: "join", visitor: "abc12345", detail: "text" },
        { kind: "admin", type: "login", detail: "signed in" },
        { kind: "system", type: "start" },
      ],
    });
    const latest = await db.event.findMany({ orderBy: { id: "desc" }, take: 3 });
    expect(latest.map((e) => e.type)).toEqual(["start", "login", "join"]);
    expect(await db.event.count({ where: { kind: "admin" } })).toBe(1);
  });

  it("stores a report with its transcript", async () => {
    const r = await db.report.create({
      data: {
        mode: "text",
        reason: "spam",
        reporter: "r1",
        reported: "r2",
        transcript: [{ who: "reported", x: "buy now" }],
      },
    });
    const back = await db.report.findUniqueOrThrow({ where: { id: r.id } });
    expect(back.status).toBe("open");
    expect(back.transcript).toEqual([{ who: "reported", x: "buy now" }]);
  });

  it("links a premium pass to an account and lets the account be deleted", async () => {
    const u = await db.user.create({
      data: { email: "pass@example.com", displayName: "P", passwordHash: "x", signupRef: "r" },
    });
    await db.passClaim.create({
      data: { sessionId: "cs_test_1", until: new Date(Date.now() + 3600e3), userId: u.id },
    });
    await db.user.delete({ where: { id: u.id } });
    const claim = await db.passClaim.findUniqueOrThrow({ where: { sessionId: "cs_test_1" } });
    expect(claim.userId).toBeNull(); // the pass record stays; it just isn't tied to anyone
  });
});
