import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Limiter } from "../src/auth/limiter.js";
import { argon2 } from "../src/auth/passwords.js";
import { Accounts } from "../src/auth/service.js";
import { prismaUsers } from "../src/auth/store.js";
import { createDb, type Db } from "../src/db.js";
import { prismaEvents } from "../src/events.js";
import { silent } from "./helpers.js";

let db: Db;
beforeAll(() => {
  db = createDb(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await db.$disconnect();
});

let n = 0;
const email = () => `gender${Date.now()}${++n}@gender.test`;
const accounts = () =>
  new Accounts({
    store: prismaUsers(db),
    hasher: argon2,
    events: prismaEvents(db, silent),
    limiter: new Limiter(),
  });
const sign = (gender: "m" | "f") => ({
  email: email(),
  name: "Gee",
  password: "correct horse",
  gender,
  adult: true as const,
});

describe("how an account identifies, in Postgres", () => {
  it("is stored as m or f", async () => {
    const he = await accounts().register(sign("m"), "gv-1");
    const she = await accounts().register(sign("f"), "gv-2");
    expect((await db.user.findUniqueOrThrow({ where: { id: he.id } })).gender).toBe("m");
    expect((await db.user.findUniqueOrThrow({ where: { id: she.id } })).gender).toBe("f");
  });

  it("can be changed", async () => {
    const a = accounts();
    const user = await a.register(sign("m"), "gv-4");
    expect((await a.setGender(user, "f", "gv-4")).gender).toBe("f");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).gender).toBe("f");
    expect((await a.setGender(user, "m", "gv-4")).gender).toBe("m");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).gender).toBe("m");
  });

  it("is what the owner sees and what 'download my data' holds", async () => {
    const a = accounts();
    const user = await a.register(sign("f"), "gv-5");
    const stored = await prismaUsers(db).findById(user.id);
    expect(a.publicUser(stored!).gender).toBe("f");
    expect(a.exportData(stored!).account.gender).toBe("f");
  });

  it("does not change what existing accounts look like: an account with nothing stored reads as 'not said'", async () => {
    const old = await db.user.create({
      data: { email: email(), displayName: "Old", passwordHash: "x", signupRef: "r" },
    });
    expect(old.gender).toBeNull();
    expect(accounts().publicUser((await prismaUsers(db).findById(old.id))!).gender).toBeNull();
  });
});
