interface FakeUser {
  name: string;
  email: string;
  /** null = a Google-only account. */
  password: string | null;
  google: boolean;
  createdAt: string;
}

/** A stand-in for the account part of the server, remembering one account and who is signed in. */
export class FakeAccounts {
  user: FakeUser | null = null;
  signedIn = false;
  /** Every request the page made: path and body. */
  calls: { path: string; body: Record<string, unknown> }[] = [];
  /** Make the next request fail with this answer. */
  failNext: { status: number; code: string; message: string } | null = null;
  /** Make every request fail as if the network were down. */
  down = false;
  /** Hold every answer until `release()` is called, to test the "waiting" state. */
  hold: Promise<void> | null = null;
  /** Make /me answer with a server error. */
  meBroken = false;

  /** Start with an account that exists and is signed in, like a returning visitor with a cookie. */
  static signedInAs(name = "Sam", email = "sam@example.com") {
    const a = new FakeAccounts();
    a.user = {
      name,
      email,
      password: "correct horse",
      google: false,
      createdAt: "2026-03-14T10:00:00.000Z",
    };
    a.signedIn = true;
    return a;
  }

  /** An account made through Google: no password, Google connected. */
  static googleOnly(name = "Riley", email = "riley@example.com") {
    const a = FakeAccounts.signedInAs(name, email);
    a.user!.password = null;
    a.user!.google = true;
    return a;
  }

  private pub() {
    const u = this.user!;
    return {
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      hasPassword: u.password !== null,
      google: u.google,
    };
  }
  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
  }
  private error(status: number, code: string, message: string) {
    return this.json({ error: { code, message } }, status);
  }

  async handle(path: string, init?: RequestInit): Promise<Response> {
    if (this.down) throw new TypeError("Failed to fetch");
    if (this.hold) await this.hold;
    const route = path.replace("/api/v1/auth", "");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (init?.method === "POST") this.calls.push({ path: route, body });

    if (this.failNext) {
      const f = this.failNext;
      this.failNext = null;
      return this.error(f.status, f.code, f.message);
    }
    if (route === "/me") {
      if (this.meBroken) return new Response("boom", { status: 500 });
      return this.json({ user: this.signedIn && this.user ? this.pub() : null });
    }
    if (route === "/register") {
      if (this.user && this.user.email === body.email) {
        return this.error(
          409,
          "duplicate_email",
          "That email already has an account. Try signing in.",
        );
      }
      this.user = {
        name: String(body.name),
        email: String(body.email),
        password: String(body.password),
        google: false,
        createdAt: "2026-10-09T08:00:00.000Z",
      };
      this.signedIn = true;
      return this.json({ user: this.pub() });
    }
    if (route === "/login") {
      if (
        !this.user ||
        this.user.password === null ||
        this.user.email !== body.email ||
        this.user.password !== body.password
      ) {
        return this.error(401, "bad_credentials", "Wrong email or password.");
      }
      this.signedIn = true;
      return this.json({ user: this.pub() });
    }
    if (route === "/logout") {
      this.signedIn = false;
      return this.json({ ok: true });
    }
    if (route === "/google/unlink") {
      if (!this.signedIn || !this.user) return this.error(401, "not_signed_in", "Sign in first.");
      if (this.user.password === null) {
        return this.error(409, "no_password", "Set a password first.");
      }
      this.user.google = false;
      return this.json({ ok: true });
    }
    if (route === "/password" || route === "/delete") {
      if (!this.signedIn || !this.user) return this.error(401, "not_signed_in", "Sign in first.");
      if (this.user.password !== null) {
        if (this.user.password !== body.password) {
          return this.error(401, "wrong_password", "That password isn't right.");
        }
      } else if (route === "/delete" && body.email !== this.user.email) {
        return this.error(401, "wrong_confirmation", "That isn't the email on this account.");
      }
      if (route === "/password") this.user.password = String(body.next);
      else {
        this.user = null;
        this.signedIn = false;
      }
      return this.json({ ok: true });
    }
    return this.error(404, "not_found", "There is no such API route.");
  }
}
