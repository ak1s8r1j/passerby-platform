import { createHash } from "node:crypto";

/**
 * Turns an IP address into a scrambled ID that can't be reversed (the secret is mixed in).
 * It is how bans and reports follow a person without the database ever holding an address.
 */
export const visitorId = (ip: string, secret: string) =>
  createHash("sha256")
    .update(secret + ip)
    .digest("hex")
    .slice(0, 24);
