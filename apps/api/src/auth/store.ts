import type { Db } from "../db.js";

/** An account as stored. `passwordHash` must never be sent to a browser. */
export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  /** Null for someone who only signs in with Google. */
  passwordHash: string | null;
  /** Google's permanent ID for the person, once they have signed in with Google. */
  googleSub: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  loginCount: number;
  premiumUntil: Date | null;
  disabledAt: Date | null;
  sessionVersion: number;
  /** Scrambled ID of the address that signed up. */
  signupRef: string;
}

export interface NewUser {
  email: string;
  displayName: string;
  passwordHash: string | null;
  googleSub?: string | null;
  signupRef: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("that email already has an account");
  }
}

export class DuplicateGoogleError extends Error {
  constructor() {
    super("that Google account is already connected");
  }
}

/** Where accounts live. Postgres in production; a simple in-memory one in tests. */
export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  findByGoogleSub(sub: string): Promise<UserRecord | null>;
  /** Throws DuplicateEmailError (or DuplicateGoogleError) if taken, even by a request that raced this one. */
  create(user: NewUser): Promise<UserRecord>;
  /** Note a sign-in: last sign-in time and the count. */
  recordLogin(id: string): Promise<UserRecord>;
  /** Replace the password and bump the session version, which signs the account out everywhere. */
  setPassword(id: string, passwordHash: string): Promise<UserRecord>;
  /** Connect (or, with null, disconnect) a Google account. Throws DuplicateGoogleError if another account has it. */
  setGoogleSub(id: string, sub: string | null): Promise<UserRecord>;
  delete(id: string): Promise<void>;
}

/** Prisma says "unique constraint failed" with this code. */
const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === "P2002";

export function prismaUsers(db: Db): UserStore {
  return {
    findByEmail: async (email) => (await db.user.findUnique({ where: { email } })) ?? null,
    findById: async (id) => (await db.user.findUnique({ where: { id } })) ?? null,
    findByGoogleSub: async (googleSub) =>
      (await db.user.findUnique({ where: { googleSub } })) ?? null,
    async create(user) {
      try {
        return await db.user.create({ data: user });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Work out which of the two unique rules was broken, by looking.
        if (await db.user.findUnique({ where: { email: user.email } }))
          throw new DuplicateEmailError();
        if (
          user.googleSub &&
          (await db.user.findUnique({ where: { googleSub: user.googleSub } }))
        ) {
          throw new DuplicateGoogleError();
        }
        throw err;
      }
    },
    recordLogin: async (id) =>
      await db.user.update({
        where: { id },
        data: { lastLoginAt: new Date(), loginCount: { increment: 1 } },
      }),
    setPassword: async (id, passwordHash) =>
      await db.user.update({
        where: { id },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      }),
    async setGoogleSub(id, googleSub) {
      try {
        return await db.user.update({ where: { id }, data: { googleSub } });
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateGoogleError();
        throw err;
      }
    },
    async delete(id) {
      await db.user.delete({ where: { id } });
    },
  };
}
