import { useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { cleanTags, MAX_TAGS } from "@passerby/shared";
import { AdSlot } from "../ads/AdSlot.js";
import { adsenseRequested } from "../ads/adsense.js";
import { usePageTitle } from "../hooks/usePageTitle.js";
import { useSiteConfig } from "../hooks/useSiteConfig.js";
import { useStoredState } from "../hooks/useStoredState.js";

const isTags = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Moods to start from. Each one is just an interest, so matching works exactly as it does for typed ones. */
const VIBES = [
  { label: "Chill", tag: "chill" },
  { label: "Gaming", tag: "gaming" },
  { label: "Language swap", tag: "language swap" },
  { label: "Debate me", tag: "debate" },
  { label: "Music nerds", tag: "music" },
  { label: "Late-night thoughts", tag: "late night" },
];

const POINTS = [
  {
    text: "Matched by interests",
    icon: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 5a4 4 0 100 8 4 4 0 000-8zm0 3a1 1 0 100 2 1 1 0 000-2z",
  },
  {
    text: "Report in one tap",
    icon: "M12 3l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z",
  },
  {
    text: "Text or video",
    icon: "M4 6h11a2 2 0 012 2v1.5l4-2.5v10l-4-2.5V16a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z",
  },
  { text: "No sign-up", icon: "M13 2L4 14h6l-1 8 9-12h-6l1-8z" },
];

/** The front door: say what you are into, then start a video or text chat. */
export function Home() {
  usePageTitle();
  const { ready, config } = useSiteConfig();
  // Offer video until the server says it is off.
  const video = !ready || config.video;
  // Saved under the same key as the chat screen, so interests chosen here are already there when chatting.
  const [tags, setTags] = useStoredState<string[]>("tags", [], isTags);
  const [draft, setDraft] = useState("");

  const add = (value: string) => {
    setDraft("");
    const next = cleanTags([...tags, value]);
    if (next.length !== tags.length) setTags(next);
  };
  const toggle = (tag: string) => {
    if (tags.includes(tag)) setTags(tags.filter((x) => x !== tag));
    else add(tag);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      setTags(tags.slice(0, -1));
    }
  };

  return (
    <section className="home">
      <div className="home-stage">
        <div className="home-deco" aria-hidden="true">
          <div className="deco-card a">
            <div className="face" />
            <span>anime · music</span>
          </div>
          <div className="deco-card b">
            <div className="face" />
            <span>travel · f1</span>
          </div>
          <div className="deco-bubble">wait, you like f1 too?? 😭</div>
        </div>

        <p className="home-badge">Adults only · No sign-up</p>
        <h1>
          Say hi to <span className="grad">a total stranger</span>
        </h1>
        <p className="home-lede">
          {config.name} pairs you with one stranger at a time for a text{video ? " or video" : ""}{" "}
          chat, matched by what you&rsquo;re into. Simple, fast, and adults only.
        </p>

        <div className="home-search">
          <div className="home-interests">
            <label className="sr" htmlFor="home-tags">
              What do you want to talk about?
            </label>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="home-chip"
                aria-label={`Remove ${t}`}
                onClick={() => setTags(tags.filter((x) => x !== t))}
              >
                {t} ×
              </button>
            ))}
            <input
              id="home-tags"
              value={draft}
              maxLength={24}
              autoComplete="off"
              disabled={tags.length >= MAX_TAGS}
              placeholder={tags.length ? "Add another" : "Add your interests (optional)"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => draft && add(draft)}
            />
          </div>
          {video && (
            <Link
              className="home-btn solid"
              to="/video"
              aria-label="Video chat"
              onClick={(e) => {
                // Google's ad script must not follow anyone into video chat, so after it has run on this page
                // the way to video is a full page load, which leaves it behind.
                if (adsenseRequested()) {
                  e.preventDefault();
                  window.location.assign("/video");
                }
              }}
            >
              Video
            </Link>
          )}
          <Link className="home-btn outline" to="/text" aria-label="Text chat">
            Text
          </Link>
        </div>

        <div className="home-vibes" role="group" aria-label="Pick a vibe">
          {VIBES.map((v) => {
            const on = tags.includes(v.tag);
            return (
              <button
                key={v.tag}
                type="button"
                className="vibe"
                aria-pressed={on}
                disabled={!on && tags.length >= MAX_TAGS}
                onClick={() => toggle(v.tag)}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        <ul className="home-points">
          {POINTS.map((p) => (
            <li key={p.text}>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
                <path
                  d={p.icon}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
              {p.text}
            </li>
          ))}
        </ul>
        <div className="home-ad">
          <AdSlot slot="landing" width={728} height={90} desktopOnly />
        </div>
        <p className="home-note">Chats are moderated. Please keep it respectful.</p>
      </div>
    </section>
  );
}
