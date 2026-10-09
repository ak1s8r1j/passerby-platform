import { hash, verify } from "@node-rs/argon2";

/** Turns passwords into safe-to-store hashes, and checks a password against one. */
export interface Hasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

// argon2id (this library's default, checked by a test) with the settings OWASP recommends:
// 19 MiB of memory, 2 passes, 1 thread.
// A stolen database then costs an attacker real memory and time for every guess.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const argon2: Hasher = {
  hash: (password) => hash(password, OPTIONS),
  async verify(hashed, password) {
    try {
      return await verify(hashed, password);
    } catch {
      return false; // a malformed hash is a "no", never a crash
    }
  },
};
