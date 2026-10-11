import { COUNTRY_CODES, POPULAR_COUNTRIES, type CountryCode } from "@passerby/shared";

const names = (() => {
  try {
    return typeof Intl !== "undefined" && "DisplayNames" in Intl
      ? new Intl.DisplayNames(
          [typeof navigator !== "undefined" ? navigator.language : "en", "en"],
          {
            type: "region",
          },
        )
      : null;
  } catch {
    return null;
  }
})();

/** A country's name in the visitor's own language, or its code if the browser cannot say. */
const cache = new Map<string, string>();
export function countryName(code: string): string {
  const known = cache.get(code);
  if (known !== undefined) return known;
  let name = code;
  try {
    name = names?.of(code) ?? code;
  } catch {
    // keep the code
  }
  cache.set(code, name);
  return name;
}

/** Every country, by name (A to Z), with the popular ones left for the top of the list. */
export function otherCountries(): CountryCode[] {
  return COUNTRY_CODES.filter((c) => !POPULAR_COUNTRIES.includes(c)).sort((a, b) =>
    countryName(a).localeCompare(countryName(b)),
  );
}
