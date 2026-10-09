import { randomUUID } from "node:crypto";
import type { EventSink, AppEvent } from "../src/events.js";
import { Limiter } from "../src/auth/limiter.js";
import type { Hasher } from "../src/auth/passwords.js";
import { Accounts } from "../src/auth/service.js";
import {
  DuplicateEmailError,
  DuplicateGoogleError,
  type NewUser,
  type UserRecord,
  type UserStore,
} from "../src/auth/store.js";

/** Accounts held in memory, enforcing the same rule as the database: one account per email. */
export class MemoryUsers implements UserStore {
  users = new Map<string, UserRecord>();

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async findByGoogleSub(sub: string) {
    return [...this.users.values()].find((u) => u.googleSub === sub) ?? null;
  }
  async create(data: NewUser) {
    // Checked here, not just before: this is what catches two sign-ups that raced.
    if ([...this.users.values()].some((u) => u.email === data.email))
      throw new DuplicateEmailError();
    if (data.googleSub && [...this.users.values()].some((u) => u.googleSub === data.googleSub)) {
      throw new DuplicateGoogleError();
    }
    const user: UserRecord = {
      id: randomUUID().replace(/-/g, "").slice(0, 25),
      googleSub: null,
      ...data,
      createdAt: new Date(),
      lastLoginAt: null,
      loginCount: 0,
      premiumUntil: null,
      disabledAt: null,
      sessionVersion: 1,
    };
    this.users.set(user.id, user);
    return user;
  }
  async recordLogin(id: string) {
    const u = this.users.get(id)!;
    u.lastLoginAt = new Date();
    u.loginCount++;
    return u;
  }
  async setPassword(id: string, passwordHash: string) {
    const u = this.users.get(id)!;
    u.passwordHash = passwordHash;
    u.sessionVersion++;
    return u;
  }
  async setGoogleSub(id: string, sub: string | null) {
    if (sub && [...this.users.values()].some((u) => u.googleSub === sub && u.id !== id)) {
      throw new DuplicateGoogleError();
    }
    const u = this.users.get(id)!;
    u.googleSub = sub;
    return u;
  }
  async delete(id: string) {
    this.users.delete(id);
  }

  /** What a moderator will be able to do (phase 4). */
  suspend(id: string) {
    const u = this.users.get(id)!;
    u.disabledAt = new Date();
    u.sessionVersion++;
  }
}

/**
 * A quick stand-in for argon2, so hundreds of tests run in milliseconds. It is plainly NOT a secure hash,
 * and every test that checks "the password is never stored" looks for its `fake$` marker.
 */
export class FakeHasher implements Hasher {
  verifies = 0;
  /** Set to slow hashing down, to make two requests overlap. */
  gate: Promise<void> | null = null;
  async hash(password: string) {
    if (this.gate) await this.gate;
    return `fake$${[...password].reverse().join("")}$salt${Math.random().toString(36).slice(2, 8)}`;
  }
  async verify(hash: string, password: string) {
    this.verifies++;
    return hash.startsWith(`fake$${[...password].reverse().join("")}$`);
  }
}

export class MemoryEvents implements EventSink {
  events: AppEvent[] = [];
  record(e: AppEvent) {
    this.events.push(e);
  }
  types() {
    return this.events.map((e) => e.type);
  }
}

/** Accounts wired to in-memory parts, with everything a test may want to look at. */
export function accountsWorld() {
  const store = new MemoryUsers();
  const hasher = new FakeHasher();
  const events = new MemoryEvents();
  let t = Date.now();
  const limiter = new Limiter(() => t);
  const accounts = new Accounts({ store, hasher, events, limiter });
  return {
    store,
    hasher,
    events,
    limiter,
    accounts,
    /** Move the clock forward, for lock-outs that expire. */
    advance: (ms: number) => (t += ms),
  };
}

export const SAM = {
  email: "sam@example.com",
  name: "Sam",
  password: "correct horse",
  adult: true as const,
};
