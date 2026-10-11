import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LANGUAGES,
  MAX_COUNTRIES,
  POPULAR_COUNTRIES,
  type CountryCode,
  type LanguageCode,
} from "@passerby/shared";
import { countryName, otherCountries } from "../lib/countries.js";
import { Flag } from "./Flag.js";
import { Setup, type Prefs } from "./Setup.js";

/** A short description of the filters in force, shown on the pill ("Smart Match" when there are none). */
export function summarizeFilters(p: Prefs): string {
  const parts: string[] = [];
  if (p.countries.length) {
    parts.push(
      p.countries.length === 1 ? countryName(p.countries[0]!) : `${p.countries.length} countries`,
    );
  }
  if (p.seek) parts.push(p.seek === "m" ? "Male" : "Female");
  if (p.lang) parts.push(LANGUAGES[p.lang]);
  if (p.tags.length) parts.push(p.tags.length === 1 ? p.tags[0]! : `${p.tags.length} interests`);
  return parts.length ? parts.join(" · ") : "Smart Match";
}

interface Props {
  open: boolean;
  onOpen(open: boolean): void;
  prefs: Prefs;
  onTags(tags: string[]): void;
  onLang(lang: Prefs["lang"]): void;
  onGender(g: Prefs["gender"]): void;
  onSeek(s: Prefs["seek"]): void;
  onCountries(c: CountryCode[]): void;
}

type Tab = "country" | "language" | "more";

/** One choice in a list. Memoised: pressing one tile should not redraw the other 250. */
const Tile = memo(function Tile({
  on,
  value,
  onPick,
  badge,
  children,
}: {
  on: boolean;
  value: string;
  onPick(value: string): void;
  badge?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      className={`tile${on ? " on" : ""}`}
      aria-pressed={on}
      onClick={() => onPick(value)}
    >
      {badge && <Flag code={badge} round />}
      <span>{children}</span>
    </button>
  );
});

/**
 * The "Smart Match" pill and the panel it opens, as tabs: which countries, which language, and who to talk to.
 * Changes apply to the next person you are matched with.
 */
export function FilterPopover({
  open,
  onOpen,
  prefs,
  onTags,
  onLang,
  onGender,
  onSeek,
  onCountries,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("country");
  const [multiple, setMultiple] = useState(false);
  const [search, setSearch] = useState("");
  const summary = summarizeFilters(prefs);
  const active = summary !== "Smart Match";
  const rest = useMemo(otherCountries, []);

  // Close on Escape or on a press anywhere outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onOpen]);

  const reset = () => {
    onCountries([]);
    onTags([]);
    onLang("");
    onSeek("");
    onGender("");
  };

  const pickCountry = (code: CountryCode) => {
    const has = prefs.countries.includes(code);
    if (multiple || (has && prefs.countries.length > 1)) {
      if (has) onCountries(prefs.countries.filter((c) => c !== code));
      else if (prefs.countries.length < MAX_COUNTRIES) onCountries([...prefs.countries, code]);
    } else {
      onCountries(has ? [] : [code]);
    }
  };
  // The tiles get functions that never change, which call the latest logic: so only the tile that
  // changed is redrawn when one is pressed.
  const latest = useRef({ pickCountry, onLang });
  useEffect(() => {
    latest.current = { pickCountry, onLang };
  });
  const pick = useCallback((code: string) => latest.current.pickCountry(code as CountryCode), []);
  const pickLanguage = useCallback(
    (code: string) => latest.current.onLang(code as Prefs["lang"]),
    [],
  );

  const term = search.trim().toLowerCase();
  const matches = (c: CountryCode) => !term || countryName(c).toLowerCase().includes(term);
  const popular = POPULAR_COUNTRIES.filter(matches);
  const others = rest.filter(matches);

  const tabs: { id: Tab; label: string }[] = [
    { id: "country", label: "Country" },
    { id: "language", label: "Language" },
    { id: "more", label: "Preferences" },
  ];

  const countryTile = (c: CountryCode) => (
    <Tile key={c} value={c} on={prefs.countries.includes(c)} badge={c} onPick={pick}>
      {countryName(c)}
    </Tile>
  );

  return (
    <div className="filter" ref={root}>
      <button
        type="button"
        className={`filter-pill${active ? " on" : ""}`}
        aria-expanded={open}
        aria-controls="filters"
        aria-label={`Match filters: ${summary}`}
        onClick={() => onOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        <span>{summary}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div className="filter-pop" id="filters" role="group" aria-label="Match filters">
          <div className="filter-head">
            <strong>Match filter</strong>
            <span>
              <button type="button" className="filter-link" onClick={reset}>
                Reset
              </button>
              <button
                type="button"
                className="filter-x"
                aria-label="Close filters"
                onClick={() => onOpen(false)}
              >
                &times;
              </button>
            </span>
          </div>

          <div className="filter-tabs" role="tablist" aria-label="Filter by">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`ftab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="fpanel"
                className={tab === t.id ? "on" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="filter-body" id="fpanel" role="tabpanel" aria-labelledby={`ftab-${tab}`}>
            {tab === "country" && (
              <>
                <div className="filter-row">
                  <span id="multi-label">Select multiple</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={multiple}
                    aria-labelledby="multi-label"
                    className="mini-switch"
                    onClick={() => setMultiple(!multiple)}
                  >
                    <span />
                  </button>
                </div>
                <label className="sr" htmlFor="country-search">
                  Search countries
                </label>
                <input
                  id="country-search"
                  type="search"
                  className="filter-search"
                  placeholder="Search countries"
                  value={search}
                  autoComplete="off"
                  onChange={(e) => setSearch(e.target.value)}
                />
                <p className="filter-note">
                  Matched by where people connect from. Someone whose country can&rsquo;t be worked
                  out won&rsquo;t be matched when you pick a country.
                </p>
                {!term && (
                  <button
                    type="button"
                    className={`tile wide${prefs.countries.length === 0 ? " on" : ""}`}
                    aria-pressed={prefs.countries.length === 0}
                    onClick={() => onCountries([])}
                  >
                    <span aria-hidden="true">{"🌍"}</span>
                    <span>Smart Match</span>
                  </button>
                )}
                {popular.length > 0 && <div className="tiles">{popular.map(countryTile)}</div>}
                {others.length > 0 && (
                  <>
                    <h3 className="filter-sub">All countries (A&ndash;Z)</h3>
                    <div className="tiles">{others.map(countryTile)}</div>
                  </>
                )}
                {!popular.length && !others.length && (
                  <p className="filter-note">No country matches.</p>
                )}
              </>
            )}

            {tab === "language" && (
              <div className="tiles">
                <Tile value="" on={prefs.lang === ""} onPick={pickLanguage}>
                  Any language
                </Tile>
                {(Object.entries(LANGUAGES) as [LanguageCode, string][]).map(([code, name]) => (
                  <Tile key={code} value={code} on={prefs.lang === code} onPick={pickLanguage}>
                    {name}
                  </Tile>
                ))}
              </div>
            )}

            {tab === "more" && (
              <Setup
                {...prefs}
                onTags={onTags}
                onLang={onLang}
                onGender={onGender}
                onSeek={onSeek}
                hideLanguage
              />
            )}
          </div>
          <p className="hint">These apply to the next person you are matched with.</p>
        </div>
      )}
    </div>
  );
}
