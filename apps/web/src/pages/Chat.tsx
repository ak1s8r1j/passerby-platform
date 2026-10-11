import {
  Fragment,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type TouchEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  cleanTags,
  isCountryCode,
  LanguageCode,
  type CountryCode,
  type ChatMode,
  type ClientMessage,
  type GameMessage,
  type IceServer,
  type Reaction,
  type ReportReason,
  type ServerMessage,
} from "@passerby/shared";
import { AdSlot } from "../ads/AdSlot.js";
import { usePlus } from "../ads/PlusContext.js";
import { SponsoredCard } from "../ads/SponsoredCard.js";
import { useAuth } from "../auth/AuthContext.js";
import { useLayout } from "../components/Layout.js";
import { FilterPopover, summarizeFilters } from "../components/FilterPopover.js";
import { GamePanel } from "../components/GamePanel.js";
import { ReactionBar, ReactionLayer, type Floating } from "../components/Reactions.js";
import { useGame } from "../games/useGame.js";
import { Flag } from "../components/Flag.js";
import { countryName } from "../lib/countries.js";
import { ReportDialog } from "../components/ReportDialog.js";
import type { Prefs } from "../components/Setup.js";
import { VideoPanel } from "../components/VideoPanel.js";
import { canReport, chatReducer, initialChat, statusText } from "../chat/state.js";
import { useChatSocket } from "../hooks/useChatSocket.js";
import { useSiteConfig } from "../hooks/useSiteConfig.js";
import { useStoredState } from "../hooks/useStoredState.js";
import { usePageTitle } from "../hooks/usePageTitle.js";
import { useUnreadTitle } from "../hooks/useUnreadTitle.js";
import { useVideoCall } from "../hooks/useVideoCall.js";

const SITE = "Passerby";
const TYPING_SHOWN_MS = 2500;
/** After the stranger leaves, how long before the page starts looking for someone new by itself. */
export const AUTO_NEXT_MS = 2500;
/** How long a reaction takes to rise. Matches the animation in brand.css. */
const FLOAT_MS = 2600;
/** The least time between the visitor's own reactions (a little over what the server allows). */
const REACT_GAP_MS = 300;
const TYPING_SENT_EVERY_MS = 1500;

export const CAMERA_BLOCKED =
  "Video chat needs your camera and microphone. Allow them in your browser, then press Start.";
export const VIRTUAL_SELF =
  "Your camera looks like a virtual camera, and the other person will see a notice about it.";
const IP_NOTE =
  "In video chat your browser connects directly to the other person's, which can reveal your IP address to them.";

/** Things to say when you don't know how to start. Pressing one sends it. */
const ICEBREAKERS = [
  "Hot take: pineapple on pizza?",
  "What's your most-played song right now?",
  "Describe your vibe in 3 emojis",
  "Best movie you've seen this year?",
];

const isTags = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const isLang = (v: unknown): v is Prefs["lang"] => v === "" || LanguageCode.safeParse(v).success;
const isCountries = (v: unknown): v is CountryCode[] =>
  Array.isArray(v) && v.length <= 10 && v.every(isCountryCode);
const isGender = (v: unknown): v is Prefs["gender"] => v === "" || v === "m" || v === "f";

export function Chat({ mode }: { mode: ChatMode }) {
  const [adult, setAdult] = useStoredState("adult", false);
  const [minor, setMinor] = useStoredState("minor", false);

  if (minor) {
    return (
      <section className="doc">
        <h1>Adults only</h1>
        <p>{SITE} is only for people 18 and older, so you can&rsquo;t chat here.</p>
      </section>
    );
  }
  if (!adult) {
    return (
      <section className="doc">
        <h1>Adults only</h1>
        <p>
          You must be 18 or older to use {SITE}. Don&rsquo;t share personal details, and report
          anyone who breaks the rules.
        </p>
        <div className="row">
          <button className="btn go" onClick={() => setAdult(true)}>
            I&rsquo;m 18 or older
          </button>
          <button className="btn ghost" onClick={() => setMinor(true)}>
            I&rsquo;m under 18
          </button>
        </div>
      </section>
    );
  }
  return <Screen mode={mode} />;
}

/** Works out whether this kind of chat is available, then shows it. */
function Screen({ mode }: { mode: ChatMode }) {
  const site = useSiteConfig();
  if (mode === "video") {
    if (!site.ready) {
      return (
        <section className="doc">
          <h1>Video chat</h1>
          <p role="status">Loading…</p>
        </section>
      );
    }
    if (!site.config.video) {
      return (
        <section className="doc">
          <h1>Video chat</h1>
          <p>Video chat is switched off right now. Text chat is still here.</p>
          <div className="row">
            <Link className="btn go" to="/text">
              Go to text chat
            </Link>
          </div>
        </section>
      );
    }
  }
  return <Conversation mode={mode} iceServers={site.config.iceServers} />;
}

/** The chat screen, for text or video. Only shown once the visitor has confirmed they are 18 or older. */
function Conversation({ mode, iceServers }: { mode: ChatMode; iceServers: IceServer[] }) {
  const isVideo = mode === "video";
  usePageTitle(isVideo ? "Video chat" : "Text chat");
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [tags, setTags] = useStoredState<string[]>("tags", [], isTags);
  const [lang, setLang] = useStoredState<Prefs["lang"]>("lang", "", isLang);
  const [gender, setGender] = useStoredState<Prefs["gender"]>("me", "", isGender);
  const [seek, setSeek] = useStoredState<Prefs["seek"]>("seek", "", isGender);
  const [countries, setCountries] = useStoredState<CountryCode[]>("countries", [], isCountries);
  const { config } = useSiteConfig();
  const { adsVisible, filtersLocked, openPlus } = usePlus();
  // While country and who-to-talk-to are locked they are not applied, and any that were saved are dropped.
  useEffect(() => {
    if (!filtersLocked) return;
    if (countries.length) setCountries([]);
    if (seek) setSeek("");
  }, [filtersLocked, countries, seek, setCountries, setSeek]);

  // Someone signed in who said how they identify starts with "I am" filled in. Their own choice here, once
  // made (even "Rather not say"), is never overwritten.
  const accountGender = useAuth().user?.gender ?? null;
  useEffect(() => {
    if (accountGender && localStorage.getItem("pb_me") === null) setGender(accountGender);
  }, [accountGender, setGender]);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  /** Waiting for the browser to say yes or no to the camera. */
  const [asking, setAsking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [gamesOpen, setGamesOpen] = useState(false);
  /** Phone video call: the conversation over the picture is hidden until the screen is tapped again. */
  const [chatHidden, setChatHidden] = useState(false);
  /** Reactions rising over the chat right now. */
  const [floats, setFloats] = useState<Floating[]>([]);
  const floatId = useRef(0);
  const lastReact = useRef(0);

  const notify = useUnreadTitle();
  const { setLiveCount } = useLayout();
  const typingOff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTyping = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const pane = useRef<HTMLDivElement>(null);

  // The video call and the game need to send through the chat connection, which is created after them.
  const sendRef = useRef<(m: ClientMessage) => void>(() => undefined);
  const gameRef = useRef<{ receive(g: GameMessage): void; reset(): void } | null>(null);
  const video = useVideoCall({
    iceServers,
    sendSignal: (d) => sendRef.current({ t: "sig", d }),
  });

  // What to tell the server about this visitor, read fresh each time the connection opens.
  const prefs = useRef({ tags, lang, gender, seek, countries });
  useEffect(() => {
    prefs.current = { tags, lang, gender, seek, countries };
  });
  const hello = (): ClientMessage => ({
    t: "hello",
    adult: true,
    mode,
    tags: cleanTags(prefs.current.tags),
    ...(prefs.current.lang ? { lang: prefs.current.lang } : {}),
    ...(prefs.current.gender ? { gender: prefs.current.gender } : {}),
    ...(prefs.current.seek ? { seek: prefs.current.seek } : {}),
    ...(prefs.current.countries.length ? { countries: prefs.current.countries } : {}),
  });

  /** Show a reaction rising for a couple of seconds. At most a dozen are on screen at once. */
  const float = (emoji: Reaction, side: "me" | "them") => {
    const id = ++floatId.current;
    setFloats((all) => [...all.slice(-11), { id, emoji, side, x: Math.random() }]);
    setTimeout(() => setFloats((all) => all.filter((f) => f.id !== id)), FLOAT_MS);
  };

  const onMessage = (msg: ServerMessage) => {
    dispatch({ type: "server", msg, now: Date.now(), siteName: SITE });
    // Bring the clock up to date in the same step, so the first countdown shown is right.
    if (msg.t === "wait") setNow(Date.now());
    if (msg.t === "typing") {
      clearTimeout(typingOff.current);
      typingOff.current = setTimeout(() => dispatch({ type: "typingOff" }), TYPING_SHOWN_MS);
    }
    if (msg.t === "msg" || msg.t === "matched") notify();
    if (msg.t === "game") gameRef.current?.receive(msg.g);
    if (msg.t === "react") float(msg.e, "them");
    if (msg.t === "matched" || msg.t === "ended" || msg.t === "reported" || msg.t === "banned") {
      setFloats([]);
      gameRef.current?.reset();
      setGamesOpen(false);
    }
    if (isVideo) {
      if (msg.t === "matched") video.begin(msg.init);
      else if (msg.t === "sig") video.signal(msg.d);
      else if (msg.t === "ended" || msg.t === "reported") video.hangUp();
      else if (msg.t === "banned") {
        video.hangUp();
        video.releaseCamera();
      }
    }
  };

  const { status, online, send } = useChatSocket({
    enabled: true,
    hello,
    onMessage,
    onDrop: () => {
      dispatch({ type: "dropped" });
      setFloats([]);
      gameRef.current?.reset();
      setGamesOpen(false);
      video.hangUp();
      video.releaseCamera();
    },
  });
  const connected = status === "ready";
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  const game = useGame({
    send: (g) => send({ t: "game", g }),
    onResult: (text) => dispatch({ type: "notice", text }),
  });
  useEffect(() => {
    gameRef.current = game;
  });

  // The header shows the same live count as this connection.
  useEffect(() => {
    setLiveCount(connected ? online : null);
    return () => setLiveCount(null);
  }, [connected, online, setLiveCount]);

  // Tick while counting down the cool-down.
  useEffect(() => {
    if (state.phase !== "cooldown") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.phase]);

  // Stay at the bottom as lines arrive, unless the visitor has scrolled up to read.
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    const mine = state.lines.at(-1)?.kind === "me";
    if (nearBottom || mine) el.scrollTop = el.scrollHeight;
  }, [state.lines]);

  useEffect(() => {
    if (state.phase === "chatting") input.current?.focus();
  }, [state.phase]);

  // If the chat ends while the report form is open, the form still applies to that chat for a few minutes.
  const reportable = canReport(state);
  useEffect(() => {
    if (!reportable) setReporting(false);
  }, [reportable]);

  const inChat = state.phase === "chatting";

  // The other person is told when this camera looks like a virtual one (and when that changes).
  const sendNow = useRef(send);
  useEffect(() => {
    sendNow.current = send;
  });
  const virtualCamera = isVideo && video.virtualCamera;
  useEffect(() => {
    if (isVideo && state.phase === "chatting")
      sendNow.current({ t: "cam", virtual: virtualCamera });
  }, [isVideo, state.phase, virtualCamera]);
  // ...and the visitor is told that they are being flagged, once in each chat.
  useEffect(() => {
    if (virtualCamera && state.phase === "chatting")
      dispatch({ type: "notice", text: VIRTUAL_SELF });
  }, [virtualCamera, state.phase]);
  /** Where the other person is connecting from, once the server has worked it out (never guessed). */
  const strangerCountry = state.lines.find((l) => l.country)?.country;
  const busy = state.phase === "searching" || state.phase === "cooldown";
  const out = state.phase === "banned";

  const start = async () => {
    if (out || !connected || asking) return;
    if (isVideo) {
      video.hangUp(); // the previous person's connection, if any
      if (!video.hasCamera()) {
        setAsking(true);
        const ok = await video.ensureCamera();
        setAsking(false);
        if (!ok) {
          dispatch({ type: "notice", text: CAMERA_BLOCKED });
          return;
        }
      }
    }
    game.reset();
    setFloats([]);
    setGamesOpen(false);
    dispatch({ type: "start" });
    send(hello()); // the latest choices, in case they changed since the connection opened
    send({ t: "find" });
  };
  // On a phone in a video call, a quick swipe up on the picture skips to the next person, like the Skip button.
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const swipeStart = (e: TouchEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const t = e.touches[0];
    const onControl = target.closest(
      "button, a, input, select, textarea, .pane, .game, .filter-pop, .vdev",
    );
    swipe.current = !onControl && t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
  };
  const swipeEnd = (e: TouchEvent<HTMLElement>) => {
    const from = swipe.current;
    swipe.current = null;
    const t = e.changedTouches[0];
    if (!from || !t || state.phase !== "chatting" || !connected || asking || out) return;
    const up = from.y - t.clientY;
    if (up > 90 && Math.abs(t.clientX - from.x) < 60 && Date.now() - from.t < 700) void start();
  };

  // A tap on the picture (or on the conversation itself) hides the conversation, and another tap brings it back.
  // Buttons, the message box and open panels keep their own taps.
  const tapScreen = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "button, a, input, select, textarea, label, .bar, .reactions, .game, .filter-pop, .vdev",
      )
    )
      return;
    if (state.phase !== "chatting") return;
    setChatHidden((hidden) => !hidden);
  };

  // Show the conversation again when the stranger says something, and at the end of a chat.
  const lastLine = state.lines[state.lines.length - 1];
  useEffect(() => {
    if (lastLine?.kind === "them") setChatHidden(false);
  }, [lastLine?.id, lastLine?.kind]);
  useEffect(() => {
    if (state.phase !== "chatting") setChatHidden(false);
  }, [state.phase]);

  // When the stranger skips or leaves, look for the next person after a short pause instead of waiting for a
  // press of Skip. Not after the visitor reported (they chose to end it), while the report box is open, when
  // they pressed Stop (that goes to idle, not ended), or when they are banned or offline.
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (state.phase !== "ended" || state.reported || reporting || !connected) return;
    const t = setTimeout(() => void startRef.current(), AUTO_NEXT_MS);
    return () => clearTimeout(t);
  }, [state.phase, state.reported, reporting, connected]);

  const stop = () => {
    send({ t: "stop" });
    game.reset();
    setFloats([]);
    setGamesOpen(false);
    dispatch({ type: "stop" });
    if (isVideo) {
      video.hangUp();
      video.releaseCamera();
    }
  };

  // Esc = Skip, like the original.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || state.phase === "idle" || out) return;
      if (document.querySelector("dialog[open], .filter-pop")) return;
      e.preventDefault();
      void start();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const sendReport = (reason: ReportReason) => {
    send({ t: "report", reason });
    setReporting(false);
  };

  const sendText = (text: string) => {
    if (!text || !inChat) return;
    send({ t: "msg", text });
    dispatch({ type: "sent", text });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !inChat) return;
    sendText(text);
    setDraft("");
    input.current?.focus();
  };

  const onType = (value: string) => {
    setDraft(value);
    const t = Date.now();
    if (inChat && t - lastTyping.current > TYPING_SENT_EVERY_MS) {
      lastTyping.current = t;
      send({ t: "typing" });
    }
  };

  const react = (e: Reaction) => {
    const t = Date.now();
    if (!inChat || t - lastReact.current < REACT_GAP_MS) return;
    lastReact.current = t;
    send({ t: "react", e });
    float(e, "me");
  };

  const placeholder = inChat
    ? "Type a message"
    : out
      ? "You can't chat right now"
      : state.phase === "ended"
        ? "Press Skip to meet someone else"
        : busy
          ? "Looking for someone…"
          : "Press Start to meet someone";

  // What to say over the video picture.
  const videoNote = asking
    ? "Waiting for your camera…"
    : video.note ||
      (state.phase === "idle"
        ? "Your camera turns on when you press Start."
        : busy
          ? "Looking for someone…"
          : "");

  // The sponsored card: text chat only, one per match, right after the stranger's first message. The match's
  // first message has an id nobody else shares, so the same sponsor stays in place as the chat grows.
  const firstFromThem = isVideo ? -1 : state.lines.findIndex((l) => l.kind === "them");
  const sponsor =
    adsVisible && firstFromThem >= 0 && config.ads.sponsors.length > 0
      ? config.ads.sponsors[state.lines[firstFromThem]!.id % config.ads.sponsors.length]
      : undefined;

  const classes = [
    "chat",
    isVideo && "video",
    state.phase === "idle" && "idle",
    chatHidden && "chat-hidden",
  ].filter(Boolean);

  return (
    <section
      className={classes.join(" ")}
      onClick={isVideo ? tapScreen : undefined}
      onTouchStart={isVideo ? swipeStart : undefined}
      onTouchEnd={isVideo ? swipeEnd : undefined}
    >
      <h1 className="sr">{isVideo ? "Video" : "Text"} chat with a stranger</h1>
      {isVideo && (
        <VideoPanel
          local={video.local}
          remote={video.remote}
          note={videoNote}
          controls={state.phase !== "idle"}
          cameras={video.cameras}
          mics={video.mics}
          cameraId={video.cameraId}
          micId={video.micId}
          mirror={video.mirror}
          onPickCamera={(id) => void video.pickCamera(id)}
          onPickMic={(id) => void video.pickMic(id)}
          onFlip={() => void video.flip()}
          common={inChat ? state.common : []}
        />
      )}
      {!isVideo && (
        <aside className="peer" aria-label="About this chat">
          <div className="peer-avatar" aria-hidden="true">
            {inChat && strangerCountry ? (
              <Flag code={strangerCountry} round />
            ) : (
              <svg viewBox="0 0 24 24" width="56" height="56">
                <circle cx="12" cy="8.5" r="4" fill="currentColor" opacity="0.9" />
                <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" opacity="0.9" />
              </svg>
            )}
          </div>
          <h2 className="peer-name">Stranger</h2>
          <p className="peer-from">
            {inChat
              ? strangerCountry
                ? `Connecting from ${countryName(strangerCountry)}`
                : "Location unknown"
              : "Press Start to meet someone"}
          </p>
          {inChat && state.common.length > 0 && (
            <>
              <h3 className="peer-h">You both like</h3>
              <ul className="peer-chips">
                {state.common.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
          <h3 className="peer-h">Looking for</h3>
          <p className="peer-looking">
            {summarizeFilters({ tags, lang, gender, seek, countries })}
          </p>
          <AdSlot slot="profile" width={300} height={250} desktopOnly />
          <p className="hint peer-safe">Be kind, and don&rsquo;t share personal details.</p>
        </aside>
      )}
      <div className="col">
        <div className="status">
          {isVideo && state.phase !== "idle" && !out && (
            <button type="button" className="vclose" aria-label="Leave chat" onClick={stop}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {isVideo && inChat && (
            <span className="vwho">
              {strangerCountry && <Flag code={strangerCountry} round />}
              <span>{strangerCountry ? `${strangerCountry} · Stranger` : "Stranger"}</span>
            </span>
          )}
          <span
            id="status"
            role="status"
            className={busy || asking ? "busy" : inChat ? "live" : ""}
          >
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{asking ? "Waiting for your camera…" : statusText(state, now, connected)}</span>
          </span>
          {/* Filters, Games and Report. On a phone video call these become a column of round buttons. */}
          <div className="vrail">
            <FilterPopover
              open={filtersOpen}
              onOpen={setFiltersOpen}
              prefs={{ tags, lang, gender, seek, countries }}
              onCountries={setCountries}
              onTags={setTags}
              onLang={setLang}
              onGender={setGender}
              onSeek={setSeek}
              locked={filtersLocked}
              onLocked={openPlus}
            />
            {inChat && (
              <button
                type="button"
                className="gamebtn"
                aria-expanded={gamesOpen || game.state !== null}
                onClick={() => setGamesOpen(!gamesOpen)}
              >
                Games
              </button>
            )}
            {reportable && (
              <button type="button" className="link danger" onClick={() => setReporting(true)}>
                Report
              </button>
            )}
          </div>
        </div>

        {inChat && (
          <GamePanel
            state={game.state}
            menuOpen={gamesOpen}
            onPick={(id) => {
              game.invite(id);
              setGamesOpen(false);
            }}
            onCloseMenu={() => setGamesOpen(false)}
            onAccept={game.accept}
            onDecline={game.decline}
            onMove={game.move}
            onWrite={game.write}
            onQuit={game.quit}
            onDismiss={game.dismiss}
          />
        )}

        <ReactionLayer items={floats} />
        <div className="pane" ref={pane}>
          {state.phase === "idle" && (
            <div className="welcome">
              <h2>Welcome to {SITE}.</h2>
              <p>
                <span className="badge18">18+</span>{" "}
                <strong className="accent">You must be 18 or older</strong>
              </p>
              <p>No nudity, hate speech or harassment</p>
              <p>Don&rsquo;t share personal details, yours or anyone else&rsquo;s</p>
              <p>Report anyone who breaks the rules</p>
              {isVideo && <p className="hint">{IP_NOTE}</p>}
            </div>
          )}
          {inChat && strangerCountry && (
            <div className="origin" aria-label="Connecting from">
              <Flag code={strangerCountry} round />
              <span>{countryName(strangerCountry)}</span>
            </div>
          )}
          <div className="log" role="log" aria-live="polite" aria-label="Conversation">
            {state.lines.map((l, i) => (
              <Fragment key={l.id}>
                <p
                  className={
                    l.kind === "sys"
                      ? `sys${l.warn ? " warn" : ""}`
                      : `b ${l.kind === "me" ? "me" : "them"}`
                  }
                >
                  {l.country && (
                    <>
                      <Flag code={l.country} round />{" "}
                    </>
                  )}
                  {l.text}
                </p>
                {i === firstFromThem && sponsor && <SponsoredCard sponsor={sponsor} />}
              </Fragment>
            ))}
          </div>
        </div>

        {inChat && <ReactionBar onReact={react} />}

        {inChat && (
          <div className="icebreakers" aria-label="Things to say">
            <span aria-hidden="true">Try:</span>
            {ICEBREAKERS.map((t) => (
              <button key={t} type="button" onClick={() => sendText(t)}>
                {t}
              </button>
            ))}
          </div>
        )}

        <form className="bar" onSubmit={submit}>
          <button
            type="button"
            className="btn go"
            title="Shortcut: Esc"
            onClick={() => void start()}
            disabled={out || !connected || asking}
          >
            {state.phase === "idle" || out ? (
              "Start"
            ) : (
              <>
                Skip
                <small className="kbd">Esc</small>
              </>
            )}
          </button>
          {state.phase !== "idle" && !out && (
            <button type="button" className="btn ghost" onClick={stop}>
              Stop
            </button>
          )}
          <input
            ref={input}
            value={draft}
            maxLength={1000}
            autoComplete="off"
            aria-label="Message"
            placeholder={placeholder}
            disabled={!inChat}
            onChange={(e) => onType(e.target.value)}
          />
          <button className="btn send" aria-label="Send" disabled={!inChat || !draft.trim()}>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <path
                d="M3 20.5V3.5L21.5 12 3 20.5zm2.2-3.4L16.8 12 5.2 6.9V10.6l7.3 1.4-7.3 1.4v3.7z"
                fill="currentColor"
              />
            </svg>
          </button>
        </form>
        {isVideo && inChat && chatHidden && (
          <p className="chat-hint" aria-hidden="true">
            Tap the screen to show the chat
          </p>
        )}
        {isVideo && inChat && (
          <p className="swipe-hint" aria-hidden="true">
            ↑ swipe up to skip
          </p>
        )}
      </div>
      <ReportDialog open={reporting} onCancel={() => setReporting(false)} onSend={sendReport} />
    </section>
  );
}
