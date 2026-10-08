import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prismaBans, prismaReports } from "../src/chat/stores.js";
import { createDb, type Db } from "../src/db.js";

let db: Db;
beforeAll(() => {
  db = createDb(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("bans in Postgres", () => {
  it("returns nothing for someone who was never banned", async () => {
    expect(await prismaBans(db).get("nobody")).toBeNull();
  });

  it("stores a ban and finds it again", async () => {
    const bans = prismaBans(db);
    const added = await bans.add("visitor-1", 24, "age");
    const found = await bans.get("visitor-1");
    expect(found).toEqual(added);
    expect(found!.reason).toBe("age");
    expect(found!.until - Date.now()).toBeGreaterThan(23.9 * 3600e3);
  });

  it("replaces an earlier ban for the same person instead of failing", async () => {
    const bans = prismaBans(db);
    await bans.add("visitor-2", 1, "rules");
    await bans.add("visitor-2", 48, "reports");
    const found = await bans.get("visitor-2");
    expect(found!.reason).toBe("reports");
    expect(found!.until - Date.now()).toBeGreaterThan(47 * 3600e3);
    expect(await db.ban.count({ where: { visitor: "visitor-2" } })).toBe(1);
  });

  it("lets an expired ban go, and removes it from the table", async () => {
    const bans = prismaBans(db);
    await bans.add("visitor-3", 0.00005, "age"); // about 0.2 seconds
    await new Promise((r) => setTimeout(r, 400));
    expect(await bans.get("visitor-3")).toBeNull();
    expect(await db.ban.count({ where: { visitor: "visitor-3" } })).toBe(0);
  });

  it("treats an unknown reason in old data as a rules ban rather than crashing", async () => {
    await db.ban.create({
      data: { visitor: "visitor-4", until: new Date(Date.now() + 3600e3), reason: "something-old" },
    });
    expect((await prismaBans(db).get("visitor-4"))!.reason).toBe("rules");
  });
});

describe("reports in Postgres", () => {
  it("saves a report with its transcript, open and ready for a moderator", async () => {
    await prismaReports(db).file({
      reporter: "system",
      reported: "visitor-9",
      reason: "underage",
      mode: "text",
      transcript: [
        { who: "reporter", x: "hi" },
        { who: "reported", x: "im 14" },
      ],
    });
    const row = await db.report.findFirstOrThrow({ where: { reported: "visitor-9" } });
    expect(row).toMatchObject({
      reporter: "system",
      reason: "underage",
      mode: "text",
      status: "open",
    });
    expect(row.transcript).toEqual([
      { who: "reporter", x: "hi" },
      { who: "reported", x: "im 14" },
    ]);
  });
});
