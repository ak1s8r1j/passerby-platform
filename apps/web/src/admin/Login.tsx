import { useState, type FormEvent } from "react";
import { useAdmin } from "./AdminContext.js";
import { Icon } from "./ui/Icon.js";

/** The owner's sign-in. Plain words for every problem, and nothing that says which half was wrong. */
export function Login() {
  const admin = useAdmin();
  const [user, setUser] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!user.trim() || !key) {
      setError("Enter the admin name and key.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await admin.signIn(user.trim(), key);
      setKey("");
    } catch (err) {
      setKey("");
      setError(err instanceof Error ? err.message : "Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm adm-center">
      <form
        className="adm-card adm-login"
        onSubmit={(e) => void submit(e)}
        noValidate
        aria-label="Admin sign in"
      >
        <span className="adm-brand-mark big" aria-hidden="true">
          <Icon name="shield" size={26} />
        </span>
        <h1>Admin</h1>
        <p className="adm-muted">Sign in to review reports and manage the site.</p>
        <label htmlFor="adm-user">Name</label>
        <input
          id="adm-user"
          className="adm-input"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <label htmlFor="adm-key">Key</label>
        <input
          id="adm-key"
          className="adm-input"
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        {error && (
          <p className="adm-form-error" role="alert">
            {error}
          </p>
        )}
        <button className="adm-btn" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

/** Shown when the server has no ADMIN_KEY: explains how to switch the admin area on. */
export function Disabled() {
  return (
    <div className="adm adm-center">
      <div className="adm-card adm-login">
        <span className="adm-brand-mark big" aria-hidden="true">
          <Icon name="shield" size={26} />
        </span>
        <h1>Admin isn&rsquo;t set up</h1>
        <p className="adm-muted">
          Set <code>ADMIN_KEY</code> (at least 12 characters) and, if you like,{" "}
          <code>ADMIN_USER</code> in the server&rsquo;s settings, then restart it.
        </p>
      </div>
    </div>
  );
}
