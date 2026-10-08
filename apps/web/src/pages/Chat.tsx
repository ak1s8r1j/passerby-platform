import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  cleanTags,
  LanguageCode,
  type ChatMode,
  type ClientMessage,
  type ServerMessage,
} from "@passerby/shared";
import { useLayout } from "../components/Layout.js";
import { Setup, type Prefs } from "../components/Setup.js";
import { chatReducer, initialChat, statusText } from "../chat/state.js";
import { useChatSocket } from "../hooks/useChatSocket.js";
import { useStoredState } from "../hooks/useStoredState.js";
import { useUnreadTitle } from "../hooks/useUnreadTitle.js";

const SITE = "Passerby";
const TYPING_SHOWN_MS = 2500;
const TYPING_SENT_EVERY_MS = 1500;

const isTags = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const isLang = (v: unknown): v is Prefs["lang"] => v === "" || LanguageCode.safeParse(v).success;
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
  if (mode === "video") {
    return (
      <section className="doc">
        <h1>Video chat</h1>
        <p>Video chat is the next thing to be built. Text chat works now.</p>
        <div className="row">
          <Link className="btn go" to="/text">
            Go to text chat
          </Link>
        </div>
      </section>
    );
  }
  return <TextChat />;
}

/** The text chat screen. Only rendered once the visitor has confirmed they are 18 or older. */
function TextChat() {
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [tags, setTags] = useStoredState<string[]>("tags", [], isTags);
  const [lang, setLang] = useStoredState<Prefs["lang"]>("lang", "", isLang);
  const [gender, setGender] = useStoredState<Prefs["gender"]>("me", "", isGender);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const notify = useUnreadTitle();
  const { setLiveCount } = useLayout();
  const typingOff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTyping = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const pane = useRef<HTMLDivElement>(null);

  // What to tell the server about this visitor, read fresh each time the connection opens.
  const prefs = useRef({ tags, lang, gender });
  useEffect(() => {
    prefs.current = { tags, lang, gender };
  });
  const hello = (): ClientMessage => ({
    t: "hello",
    adult: true,
    mode: "text",
    tags: cleanTags(prefs.current.tags),
    ...(prefs.current.lang ? { lang: prefs.current.lang } : {}),
    ...(prefs.current.gender ? { gender: prefs.current.gender } : {}),
  });

  const onMessage = (msg: ServerMessage) => {
    dispatch({ type: "server", msg, now: Date.now(), siteName: SITE });
    // Bring the clock up to date in the same step, so the first countdown shown is right.
    if (msg.t === "wait") setNow(Date.now());
    if (msg.t === "typing") {
      clearTimeout(typingOff.current);
      typingOff.current = setTimeout(() => dispatch({ type: "typingOff" }), TYPING_SHOWN_MS);
    }
    if (msg.t === "msg" || msg.t === "matched") notify();
  };

  const { status, online, send } = useChatSocket({
    enabled: true,
    hello,
    onMessage,
    onDrop: () => dispatch({ type: "dropped" }),
  });
  const connected = status === "ready";

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

  const inChat = state.phase === "chatting";
  const busy = state.phase === "searching" || state.phase === "cooldown";
  const out = state.phase === "banned";

  const start = () => {
    if (out || !connected) return;
    dispatch({ type: "start" });
    send(hello()); // the latest choices, in case they changed since the connection opened
    send({ t: "find" });
  };
  const stop = () => {
    send({ t: "stop" });
    dispatch({ type: "stop" });
  };

  // Esc = Next, like the original.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || state.phase === "idle" || out) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      start();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !inChat) return;
    send({ t: "msg", text });
    dispatch({ type: "sent", text });
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

  const placeholder = inChat
    ? "Type a message"
    : out
      ? "You can't chat right now"
      : state.phase === "ended"
        ? "Press Next to meet someone else"
        : busy
          ? "Looking for someone…"
          : "Press Start to meet someone";

  return (
    <section className="chat">
      <h1 className="sr">Text chat with a stranger</h1>
      <div className="status">
        <span id="status" role="status" className={busy ? "busy" : inChat ? "live" : ""}>
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{statusText(state, now, connected)}</span>
        </span>
      </div>

      <div className="pane" ref={pane}>
        {state.phase === "idle" && (
          <Setup
            tags={tags}
            lang={lang}
            gender={gender}
            onTags={setTags}
            onLang={setLang}
            onGender={setGender}
          />
        )}
        <div className="log" role="log" aria-live="polite" aria-label="Conversation">
          {state.lines.map((l) => (
            <p
              key={l.id}
              className={l.kind === "sys" ? "sys" : `b ${l.kind === "me" ? "me" : "them"}`}
            >
              {l.text}
            </p>
          ))}
        </div>
      </div>

      <form className="bar" onSubmit={submit}>
        <button
          type="button"
          className="btn go"
          title="Shortcut: Esc"
          onClick={start}
          disabled={out || !connected}
        >
          {state.phase === "idle" || out ? "Start" : "Next"}
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
        <button className="btn" disabled={!inChat || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
