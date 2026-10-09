import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  cleanTags,
  LanguageCode,
  type ChatMode,
  type ClientMessage,
  type IceServer,
  type ServerMessage,
} from "@passerby/shared";
import { useLayout } from "../components/Layout.js";
import { Setup, type Prefs } from "../components/Setup.js";
import { VideoPanel } from "../components/VideoPanel.js";
import { chatReducer, initialChat, statusText } from "../chat/state.js";
import { useChatSocket } from "../hooks/useChatSocket.js";
import { useSiteConfig } from "../hooks/useSiteConfig.js";
import { useStoredState } from "../hooks/useStoredState.js";
import { usePageTitle } from "../hooks/usePageTitle.js";
import { useUnreadTitle } from "../hooks/useUnreadTitle.js";
import { useVideoCall } from "../hooks/useVideoCall.js";

const SITE = "Passerby";
const TYPING_SHOWN_MS = 2500;
const TYPING_SENT_EVERY_MS = 1500;

export const CAMERA_BLOCKED =
  "Video chat needs your camera and microphone. Allow them in your browser, then press Start.";
const IP_NOTE =
  "In video chat your browser connects directly to the other person's, which can reveal your IP address to them.";

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
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  /** Waiting for the browser to say yes or no to the camera. */
  const [asking, setAsking] = useState(false);

  const notify = useUnreadTitle();
  const { setLiveCount } = useLayout();
  const typingOff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTyping = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const pane = useRef<HTMLDivElement>(null);

  // The video call needs to send through the chat connection, which is created after it.
  const sendRef = useRef<(m: ClientMessage) => void>(() => undefined);
  const video = useVideoCall({
    iceServers,
    sendSignal: (d) => sendRef.current({ t: "sig", d }),
  });

  // What to tell the server about this visitor, read fresh each time the connection opens.
  const prefs = useRef({ tags, lang, gender });
  useEffect(() => {
    prefs.current = { tags, lang, gender };
  });
  const hello = (): ClientMessage => ({
    t: "hello",
    adult: true,
    mode,
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
    if (isVideo) {
      if (msg.t === "matched") video.begin(msg.init);
      else if (msg.t === "sig") video.signal(msg.d);
      else if (msg.t === "ended") video.hangUp();
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
      video.hangUp();
      video.releaseCamera();
    },
  });
  const connected = status === "ready";
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

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
    dispatch({ type: "start" });
    send(hello()); // the latest choices, in case they changed since the connection opened
    send({ t: "find" });
  };
  const stop = () => {
    send({ t: "stop" });
    dispatch({ type: "stop" });
    if (isVideo) {
      video.hangUp();
      video.releaseCamera();
    }
  };

  // Esc = Next, like the original.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || state.phase === "idle" || out) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      void start();
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

  // What to say over the video picture.
  const videoNote = asking
    ? "Waiting for your camera…"
    : video.note ||
      (state.phase === "idle"
        ? "Your camera turns on when you press Start."
        : busy
          ? "Looking for someone…"
          : "");

  const classes = ["chat", isVideo && "video", state.phase === "idle" && "idle"].filter(Boolean);

  return (
    <section className={classes.join(" ")}>
      <h1 className="sr">{isVideo ? "Video" : "Text"} chat with a stranger</h1>
      {isVideo && (
        <VideoPanel
          local={video.local}
          remote={video.remote}
          note={videoNote}
          controls={state.phase !== "idle"}
          micOn={video.micOn}
          camOn={video.camOn}
          onMic={video.toggleMic}
          onCam={video.toggleCam}
        />
      )}
      <div className="col">
        <div className="status">
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
        </div>

        <div className="pane" ref={pane}>
          {state.phase === "idle" && (
            <>
              <Setup
                tags={tags}
                lang={lang}
                gender={gender}
                onTags={setTags}
                onLang={setLang}
                onGender={setGender}
              />
              {isVideo && <p className="hint">{IP_NOTE}</p>}
            </>
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
            onClick={() => void start()}
            disabled={out || !connected || asking}
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
      </div>
    </section>
  );
}
