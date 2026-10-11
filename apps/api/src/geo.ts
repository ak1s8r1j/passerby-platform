import { createRequire } from "node:module";

/** Works out the country a connection comes from. Returns "" when it cannot be told. */
export type CountryLookup = (address: string) => string;

/**
 * Looks addresses up in a database that ships with the server, so no address is ever sent to another
 * company. Private and local addresses have no country, and give "".
 */
export function offlineCountryLookup(): CountryLookup {
  // Loaded on first use: the database is large and a server that never needs it should not pay for it.
  let lookup: ((ip: string) => { country?: string } | null) | null = null;
  return (address) => {
    try {
      lookup ??= (
        createRequire(import.meta.url)("geoip-lite") as { lookup: typeof lookup & object }
      ).lookup;
      const found = lookup!(address.replace(/^::ffff:/i, "")); // an IPv4 address written the IPv6 way
      return found?.country && /^[A-Z]{2}$/.test(found.country) ? found.country : "";
    } catch {
      return "";
    }
  };
}
