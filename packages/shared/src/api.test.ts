import { describe, expect, it } from "vitest";
import {
  ChangePasswordRequest,
  DeleteAccountRequest,
  LoginRequest,
  RegisterRequest,
  SiteConfig,
} from "./api.js";

const good = { email: "sam@example.com", name: "Sam", password: "correct horse", adult: true };
const register = (over: Record<string, unknown>) => RegisterRequest.safeParse({ ...good, ...over });
const message = (r: ReturnType<typeof register>) => (r.success ? null : r.error.issues[0]?.message);

describe("RegisterRequest", () => {
  it("accepts a good sign-up", () => {
    expect(register({}).success).toBe(true);
  });

  it("tidies the email and the name", () => {
    const r = register({ email: "  Sam@Example.COM ", name: "  Sam   Q  Public " });
    expect(r.success && r.data.email).toBe("sam@example.com");
    expect(r.success && r.data.name).toBe("Sam Q Public");
  });

  it("insists on the 18+ confirmation", () => {
    expect(message(register({ adult: false }))).toBe("Confirm that you are 18 or older.");
    expect(message(register({ adult: undefined }))).toBe("Confirm that you are 18 or older.");
    expect(message(register({ adult: "yes" }))).toBe("Confirm that you are 18 or older.");
  });

  it.each([
    "nope",
    "a@b",
    "a b@c.com",
    "@example.com",
    "sam@",
    "sam@example.",
    "x".repeat(121) + "@e.com",
    "",
  ])("refuses the email %j", (email) => {
    expect(message(register({ email }))).toBe("Enter a valid email address.");
  });

  it.each(["a+tag@example.com", "first.last@sub.example.co.uk", "=1+1@example.com"])(
    "accepts the email %j",
    (email) => {
      expect(register({ email }).success).toBe(true);
    },
  );

  it("turns line breaks and tabs inside a name into single spaces, so a stored name is always one line", () => {
    const r = register({ name: "a\n\tb" });
    expect(r.success && r.data.name).toBe("a b");
  });

  // Invisible characters could be used to impersonate someone, so they are refused outright.
  it.each(["A", "x".repeat(25), "<script>", "Sam!", "   ", "Sam​", "‮Sam", "Sam\u0000"])(
    "refuses the name %j",
    (name) => {
      expect(message(register({ name }))).toBe(
        "Pick a name of 2 to 24 letters, numbers or spaces.",
      );
    },
  );

  it.each(["Sam", "Zoë", "音楽家", "Anna-Marie", "J. R. Smith", "user_42"])(
    "accepts the name %j",
    (name) => {
      expect(register({ name }).success).toBe(true);
    },
  );

  it("holds passwords to 8 to 128 characters, and accepts any characters in them", () => {
    expect(message(register({ password: "short" }))).toBe("Use a password of 8 to 128 characters.");
    expect(message(register({ password: "x".repeat(129) }))).toBe(
      "Use a password of 8 to 128 characters.",
    );
    expect(register({ password: "x".repeat(128) }).success).toBe(true);
    expect(register({ password: "pässwörd 密码 🔒" }).success).toBe(true);
    expect(register({ password: "        " }).success).toBe(true); // spaces are allowed: it is only length we check
  });

  it("refuses a missing or non-text field", () => {
    expect(register({ email: undefined }).success).toBe(false);
    expect(register({ name: 5 }).success).toBe(false);
    expect(register({ password: null }).success).toBe(false);
    expect(RegisterRequest.safeParse("nope").success).toBe(false);
  });

  it("drops fields it does not know, so a request cannot set things like premium", () => {
    const r = register({ premiumUntil: "2999-01-01", isAdmin: true });
    expect(r.success && Object.keys(r.data).sort()).toEqual(["adult", "email", "name", "password"]);
  });
});

describe("LoginRequest", () => {
  it("is lenient about the password so it never teaches what a good one looks like", () => {
    expect(LoginRequest.safeParse({ email: "Sam@Example.com ", password: "x" }).success).toBe(true);
    const r = LoginRequest.safeParse({ email: " Sam@Example.com ", password: "x" });
    expect(r.success && r.data.email).toBe("sam@example.com");
  });

  it("still caps lengths, so nobody can hand the hasher a huge password", () => {
    expect(LoginRequest.safeParse({ email: "a@b.co", password: "x".repeat(129) }).success).toBe(
      false,
    );
    expect(LoginRequest.safeParse({ email: "x".repeat(121), password: "x" }).success).toBe(false);
  });
});

describe("ChangePasswordRequest and DeleteAccountRequest", () => {
  it("holds the new password to the same rules as sign-up", () => {
    expect(
      ChangePasswordRequest.safeParse({ password: "old", next: "brand new pass" }).success,
    ).toBe(true);
    const bad = ChangePasswordRequest.safeParse({ password: "old", next: "short" });
    expect(!bad.success && bad.error.issues[0]?.message).toBe(
      "Use a new password of 8 to 128 characters.",
    );
  });

  it("needs a password, or for a Google-only account the email, to delete an account", () => {
    expect(DeleteAccountRequest.safeParse({ password: "x" }).success).toBe(true);
    expect(DeleteAccountRequest.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(DeleteAccountRequest.safeParse({}).success).toBe(false);
    expect(DeleteAccountRequest.safeParse({ password: 5 }).success).toBe(false);
  });
});

describe("SiteConfig", () => {
  it("fills in the name and contact when an older server does not send them", () => {
    const c = SiteConfig.parse({ video: true, iceServers: [] });
    expect(c.name).toBe("Passerby");
    expect(c.contact).toBeNull();
  });
});
