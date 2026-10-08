import { useState, type KeyboardEvent } from "react";
import { cleanTags, LANGUAGES, MAX_TAGS, type LanguageCode } from "@passerby/shared";

const IDEAS = ["music", "movies", "gaming", "travel", "books", "sports", "food", "anime"];

export interface Prefs {
  tags: string[];
  lang: LanguageCode | "";
  gender: "m" | "f" | "";
}

interface Props extends Prefs {
  onTags(tags: string[]): void;
  onLang(lang: LanguageCode | ""): void;
  onGender(gender: "m" | "f" | ""): void;
}

/** What the visitor wants to talk about, their language, and whether they say what they are. */
export function Setup({ tags, lang, gender, onTags, onLang, onGender }: Props) {
  const [draft, setDraft] = useState("");

  const add = (value: string) => {
    setDraft("");
    const next = cleanTags([...tags, value]);
    if (next.length !== tags.length) onTags(next);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onTags(tags.slice(0, -1));
    }
  };

  return (
    <div className="setup">
      <label htmlFor="tags">What do you want to talk about?</label>
      <div className="chips">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            className="chip"
            aria-label={`Remove ${t}`}
            onClick={() => onTags(tags.filter((x) => x !== t))}
          >
            {t} ×
          </button>
        ))}
        <input
          id="tags"
          value={draft}
          maxLength={24}
          autoComplete="off"
          disabled={tags.length >= MAX_TAGS}
          placeholder={
            tags.length >= MAX_TAGS
              ? "That's the most interests"
              : "Add an interest, then press Enter"
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => draft && add(draft)}
        />
      </div>
      {tags.length === 0 && (
        <div className="sugs" aria-label="Suggested interests">
          <span>Try:</span>
          {IDEAS.map((t) => (
            <button key={t} type="button" className="sug" onClick={() => add(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="two">
        <div>
          <label htmlFor="me">I am</label>
          <select
            id="me"
            value={gender}
            onChange={(e) => onGender(e.target.value as Prefs["gender"])}
          >
            <option value="">Rather not say</option>
            <option value="m">Male</option>
            <option value="f">Female</option>
          </select>
        </div>
        <div>
          <label htmlFor="lang">Language</label>
          <select id="lang" value={lang} onChange={(e) => onLang(e.target.value as Prefs["lang"])}>
            <option value="">Any language</option>
            {Object.entries(LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
