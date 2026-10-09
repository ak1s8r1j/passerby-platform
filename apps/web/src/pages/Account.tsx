import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChangePasswordRequest, RegisterRequest, type PublicUser } from "@passerby/shared";
import * as api from "../api.js";
import { useAuth } from "../auth/AuthContext.js";
import { usePageTitle } from "../hooks/usePageTitle.js";
import { useSiteConfig } from "../hooks/useSiteConfig.js";

/** A message under the heading. Errors are announced to screen readers straight away. */
interface Note {
  text: string;
  bad?: boolean;
}

const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : "Something went wrong. Try again.";

const GOOGLE_START = "/api/v1/auth/google/start";
const GOOGLE_FAILED: Note = { text: "Google sign-in didn't work. Please try again.", bad: true };

/**
 * What to say for each result the server reports after a trip to Google (`/account?google=...`).
 * The address carries only a short code, never a message, so nobody can make this page say something
 * of their choosing; anything not listed here gets the general "didn't work" message.
 */
const GOOGLE_RESULTS: Record<string, Note> = {
  ok: { text: "Signed in with Google." },
  created: { text: "Account created with Google. Welcome!" },
  linked: { text: "Google is now connected to your account." },
  cancelled: { text: "Google sign-in was cancelled.", bad: true },
  expired: {
    text: "That Google sign-in took too long, or didn't start on this browser. Please try again.",
    bad: true,
  },
  failed: GOOGLE_FAILED,
  email_in_use: {
    text: "An account with this email already exists. Sign in with your password, then connect Google from your account page.",
    bad: true,
  },
  adult_required: {
    text: "To create an account with Google, tick the 18+ box on the Create account tab first.",
    bad: true,
  },
  google_unverified: {
    text: "Google says that email address isn't verified, so we can't use it.",
    bad: true,
  },
  google_in_use: {
    text: "That Google account is already connected to a different account here.",
    bad: true,
  },
  suspended: { text: "This account is suspended. Contact the site operator.", bad: true },
  banned: { text: "You can't create an account right now.", bad: true },
  too_many: { text: "Too many attempts. Try again in a few minutes.", bad: true },
  not_signed_in: { text: "Sign in first, then connect Google.", bad: true },
};

export function Account() {
  usePageTitle("Account");
  const auth = useAuth();
  const [note, setNote] = useState<Note | null>(null);

  // Coming back from Google: show what happened, then tidy the address so a reload doesn't repeat it.
  const [params, setParams] = useSearchParams();
  const fromGoogle = params.get("google");
  useEffect(() => {
    if (fromGoogle === null) return;
    setNote(GOOGLE_RESULTS[fromGoogle] ?? GOOGLE_FAILED);
    setParams({}, { replace: true });
  }, [fromGoogle, setParams]);

  if (auth.status === "loading") {
    return (
      <section className="doc">
        <h1>Account</h1>
        <p role="status">Loading…</p>
      </section>
    );
  }

  return (
    <section className="doc">
      <h1>Account</h1>
      {note && (
        <p role={note.bad ? "alert" : "status"} className={note.bad ? "err" : "okmsg"}>
          {note.text}
        </p>
      )}
      {auth.user ? <Profile user={auth.user} say={setNote} /> : <SignedOut say={setNote} />}
    </section>
  );
}

/** Runs a form action: stops double-submits, and turns any problem into a message. */
function useAction(say: (n: Note | null) => void) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<Note | void>) => {
    setBusy(true);
    say(null);
    try {
      const done = await work();
      if (done) say(done);
    } catch (err) {
      say({ text: messageOf(err), bad: true });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function SignedOut({ say }: { say: (n: Note | null) => void }) {
  const auth = useAuth();
  const { config } = useSiteConfig();
  const [mode, setMode] = useState<"in" | "up">("in");
  const { busy, run } = useAction(say);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [adult, setAdult] = useState(false);

  const pick = (m: "in" | "up") => {
    setMode(m);
    say(null);
  };

  const submitIn = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await auth.signIn({ email, password });
      setPassword("");
    });
  };

  const submitUp = (e: FormEvent) => {
    e.preventDefault();
    // Check here first so the visitor gets the answer at once; the server checks again.
    const parsed = RegisterRequest.safeParse({ email, name, password, adult: adult || undefined });
    if (!parsed.success) {
      say({ text: parsed.error.issues[0]?.message ?? "Check the form and try again.", bad: true });
      return;
    }
    void run(async () => {
      await auth.register(parsed.data);
      setPassword("");
      return { text: "Account created. Welcome!" };
    });
  };

  // Creating an account with Google needs the same 18+ confirmation as the form.
  const googleHref = mode === "up" && adult ? `${GOOGLE_START}?adult=1` : GOOGLE_START;
  const googleClick = (e: { preventDefault(): void }) => {
    if (mode === "up" && !adult) {
      e.preventDefault();
      say({ text: "Confirm that you are 18 or older.", bad: true });
    }
  };

  return (
    <>
      <p>
        An account is optional. It lets you manage your details, and later keeps a premium pass on
        every device. Your chats stay anonymous either way.
      </p>
      <div className="row" role="group" aria-label="Sign in or create an account">
        <button
          type="button"
          className={mode === "in" ? "btn go" : "btn ghost"}
          aria-pressed={mode === "in"}
          onClick={() => pick("in")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === "up" ? "btn go" : "btn ghost"}
          aria-pressed={mode === "up"}
          onClick={() => pick("up")}
        >
          Create account
        </button>
      </div>

      {mode === "in" ? (
        <form className="aform" onSubmit={submitIn} noValidate aria-label="Sign in">
          <label htmlFor="in-email">Email</label>
          <input
            id="in-email"
            type="email"
            autoComplete="email"
            maxLength={120}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="in-password">Password</label>
          <input
            id="in-password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn go" disabled={busy}>
            Sign in
          </button>
        </form>
      ) : (
        <form className="aform" onSubmit={submitUp} noValidate aria-label="Create account">
          <label htmlFor="up-name">Display name</label>
          <input
            id="up-name"
            autoComplete="nickname"
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="up-email">Email</label>
          <input
            id="up-email"
            type="email"
            autoComplete="email"
            maxLength={120}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="up-password">Password (8 or more characters)</label>
          <input
            id="up-password"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className="chk">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>
              I am 18 or older, and I agree to the <Link to="/terms">terms</Link> and{" "}
              <Link to="/privacy">privacy notice</Link>.
            </span>
          </label>
          <button className="btn go" disabled={busy}>
            Create account
          </button>
        </form>
      )}

      {config.googleSignIn && (
        <div className="alt">
          <p className="or">or</p>
          <a className="btn ghost gbtn" href={googleHref} onClick={googleClick}>
            <span className="g" aria-hidden="true">
              G
            </span>
            Continue with Google
          </a>
          <p className="hint">
            {mode === "up"
              ? "Tick the 18+ box above first. We only use your name and email."
              : "Signed up with Google before? Use this button. We only use your name and email."}
          </p>
        </div>
      )}
    </>
  );
}

function Profile({ user, say }: { user: PublicUser; say: (n: Note | null) => void }) {
  const auth = useAuth();
  const { config } = useSiteConfig();
  const { busy, run } = useAction(say);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    const parsed = ChangePasswordRequest.safeParse({
      password: user.hasPassword ? current : undefined,
      next,
    });
    if (!parsed.success) {
      say({ text: parsed.error.issues[0]?.message ?? "Check the form and try again.", bad: true });
      return;
    }
    void run(async () => {
      await api.changePassword(parsed.data);
      setCurrent("");
      setNext("");
      if (!user.hasPassword) await auth.refresh(); // now there is a password, so the page can offer more
      return {
        text: `Password ${user.hasPassword ? "changed" : "set"}. Any other device that was signed in has been signed out.`,
      };
    });
  };

  const submitDelete = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.deleteAccount(user.hasPassword ? { password: confirm } : { email: confirm });
      setConfirm("");
      auth.forget();
      return { text: "Your account was deleted." };
    });
  };

  return (
    <>
      <div className="card">
        <h2>{user.name}</h2>
        <p className="line">{user.email}</p>
        <p className="line muted">Member since {new Date(user.createdAt).toLocaleDateString()}</p>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await auth.signOut();
              return { text: "You're signed out." };
            })
          }
        >
          Sign out
        </button>
        <a className="btn ghost" href={api.EXPORT_URL} download="my-data.json">
          Download my data
        </a>
      </div>

      {(config.googleSignIn || user.google) && (
        <div className="card methods">
          <h3>Ways to sign in</h3>
          <p className="line">Password: {user.hasPassword ? "set" : "not set"}</p>
          <p className="line">Google: {user.google ? "connected" : "not connected"}</p>
          {user.google ? (
            user.hasPassword ? (
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.unlinkGoogle();
                    await auth.refresh();
                    return { text: "Google is disconnected from your account." };
                  })
                }
              >
                Disconnect Google
              </button>
            ) : (
              <p className="hint">
                Set a password below if you want to be able to disconnect Google.
              </p>
            )
          ) : (
            <a className="btn ghost gbtn" href={`${GOOGLE_START}?link=1`}>
              <span className="g" aria-hidden="true">
                G
              </span>
              Connect Google
            </a>
          )}
        </div>
      )}

      <details>
        <summary>{user.hasPassword ? "Change password" : "Set a password"}</summary>
        <form
          className="aform"
          onSubmit={submitPassword}
          noValidate
          aria-label={user.hasPassword ? "Change password" : "Set a password"}
        >
          {user.hasPassword && (
            <>
              <label htmlFor="pw-current">Current password</label>
              <input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </>
          )}
          <label htmlFor="pw-new">
            {user.hasPassword ? "New password" : "Password"} (8 or more characters)
          </label>
          <input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <button className="btn" disabled={busy}>
            {user.hasPassword ? "Change password" : "Set password"}
          </button>
        </form>
      </details>

      <details>
        <summary>Delete my account</summary>
        <form className="aform" onSubmit={submitDelete} noValidate aria-label="Delete my account">
          <p>
            This permanently deletes your account. Chats aren&rsquo;t stored, so there is nothing
            else to remove. It can&rsquo;t be undone.
          </p>
          {user.hasPassword ? (
            <>
              <label htmlFor="del-password">Your password</label>
              <input
                id="del-password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor="del-email">Type your email address to confirm</label>
              <input
                id="del-email"
                type="email"
                autoComplete="off"
                maxLength={120}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </>
          )}
          <button className="btn stop" disabled={busy}>
            Delete my account
          </button>
        </form>
      </details>
    </>
  );
}
