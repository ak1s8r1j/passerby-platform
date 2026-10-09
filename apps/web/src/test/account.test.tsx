import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { FakeAccounts } from "./fake-accounts.js";
import { installFakeSocket } from "./fake-socket.js";
import { stubApi } from "./fetch.js";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

let accounts: FakeAccounts;
const open = (a = new FakeAccounts(), config = {}) => {
  accounts = stubApi({ accounts: a, config }).accounts;
  return renderAt("/account");
};

beforeEach(() => {
  localStorage.clear();
  installFakeSocket();
});
afterEach(() => vi.unstubAllGlobals());

const button = (name: RegExp | string) => screen.getByRole("button", { name });
const field = (label: RegExp | string) => screen.getByLabelText(label);
const alert = () => screen.getByRole("alert");
const type = (label: RegExp | string, text: string) => userEvent.type(field(label), text);

async function openSignUp() {
  open();
  await screen.findByRole("form", { name: "Sign in" });
  await userEvent.click(button("Create account"));
  return screen.getByRole("form", { name: "Create account" });
}

const fillSignUp = async (over: Partial<Record<"name" | "email" | "password", string>> = {}) => {
  await type("Display name", over.name ?? "Sam");
  await type("Email", over.email ?? "sam@example.com");
  await type(/^Password/, over.password ?? "correct horse");
};

describe("the header", () => {
  it("offers Sign in to a visitor with no account", async () => {
    open();
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("shows the visitor's name once it knows they are signed in", async () => {
    open(FakeAccounts.signedInAs("Riley"));
    const link = await screen.findByRole("link", { name: "Riley" });
    expect(link).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("says just Account while it finds out, rather than flashing the wrong thing", async () => {
    const a = new FakeAccounts();
    a.hold = new Promise(() => undefined); // the server never answers
    accounts = stubApi({ accounts: a }).accounts;
    renderAt("/account");
    expect(await screen.findByRole("link", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("treats a broken server as signed out, and the page still works", async () => {
    const a = new FakeAccounts();
    a.meBroken = true;
    open(a);
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("the signed-out account page", () => {
  it("shows a sign-in form, labelled, with the right keyboard hints for password managers", async () => {
    open();
    const form = await screen.findByRole("form", { name: "Sign in" });
    expect(within(form).getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(within(form).getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(within(form).getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByText(/account is optional/i)).toBeInTheDocument();
    expect(screen.getByText(/chats stay anonymous/i)).toBeInTheDocument();
  });

  it("switches between sign in and create account, saying which is chosen", async () => {
    open();
    await screen.findByRole("form", { name: "Sign in" });
    const tabs = within(screen.getByRole("group", { name: /sign in or create/i }));
    expect(tabs.getByRole("button", { name: "Sign in" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button("Create account"));
    expect(tabs.getByRole("button", { name: "Create account" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("autocomplete", "new-password");
    expect(screen.queryByRole("form", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("sets the page title", async () => {
    open();
    await screen.findByRole("form", { name: "Sign in" });
    expect(document.title).toBe("Account | Passerby");
  });
});

describe("signing in", () => {
  it("signs in, shows the account, and clears the password box", async () => {
    open(
      Object.assign(new FakeAccounts(), {
        user: {
          name: "Sam",
          email: "sam@example.com",
          password: "correct horse",
          google: false,
          createdAt: "2026-03-14T10:00:00.000Z",
        },
      }),
    );
    await screen.findByRole("form", { name: "Sign in" });
    await type("Email", "sam@example.com");
    await type("Password", "correct horse");
    await userEvent.click(
      within(screen.getByRole("form", { name: "Sign in" })).getByRole("button", {
        name: "Sign in",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sam" })).toBeInTheDocument(); // the header agrees
    expect(accounts.calls).toEqual([
      { path: "/login", body: { email: "sam@example.com", password: "correct horse" } },
    ]);
  });

  it("shows the server's message for a wrong password, and stays signed out", async () => {
    const a = FakeAccounts.signedInAs();
    a.signedIn = false; // the account exists, but nobody is signed in
    open(a);
    await screen.findByRole("form", { name: "Sign in" });
    await type("Email", "sam@example.com");
    await type("Password", "wrong");
    await userEvent.click(
      within(screen.getByRole("form", { name: "Sign in" })).getByRole("button", {
        name: "Sign in",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument();
    expect(field("Password")).toHaveValue("wrong"); // kept, so a typo can be fixed
  });

  it("explains when the server can't be reached", async () => {
    open();
    await screen.findByRole("form", { name: "Sign in" });
    accounts.down = true;
    await type("Email", "a@b.co");
    await type("Password", "x");
    await userEvent.click(
      within(screen.getByRole("form", { name: "Sign in" })).getByRole("button", {
        name: "Sign in",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't reach the server/i);
  });

  it("shows the server's message when sign-in is locked out", async () => {
    open();
    await screen.findByRole("form", { name: "Sign in" });
    accounts.failNext = {
      status: 429,
      code: "too_many",
      message: "Too many attempts. Try again in a few minutes.",
    };
    await type("Email", "a@b.co");
    await type("Password", "x");
    await userEvent.click(
      within(screen.getByRole("form", { name: "Sign in" })).getByRole("button", {
        name: "Sign in",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a few minutes.",
    );
  });

  it("only sends one request however often the button is pressed while waiting", async () => {
    const a = new FakeAccounts();
    let release!: () => void;
    open(a);
    await screen.findByRole("form", { name: "Sign in" });
    a.hold = new Promise<void>((r) => (release = r));
    await type("Email", "a@b.co");
    await type("Password", "x");
    const submit = within(screen.getByRole("form", { name: "Sign in" })).getByRole("button", {
      name: "Sign in",
    });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    release();
    await screen.findByRole("alert");
    expect(a.calls).toHaveLength(1);
  });
});

describe("creating an account", () => {
  it("links to the terms and the privacy notice next to the 18+ tick box", async () => {
    const form = await openSignUp();
    expect(within(form).getByRole("link", { name: "terms" })).toHaveAttribute("href", "/terms");
    expect(within(form).getByRole("link", { name: "privacy notice" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(within(form).getByRole("checkbox")).not.toBeChecked();
  });

  it.each([
    [{ email: "nope" }, "Enter a valid email address."],
    [{ name: "A" }, "Pick a name of 2 to 24 letters, numbers or spaces."],
    [{ password: "short" }, "Use a password of 8 to 128 characters."],
  ])("tells the visitor at once about %j, and sends nothing", async (over, message) => {
    await openSignUp();
    await fillSignUp(over);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      within(screen.getByRole("form", { name: "Create account" })).getByRole("button", {
        name: "Create account",
      }),
    );
    expect(alert()).toHaveTextContent(message);
    expect(accounts.calls).toEqual([]);
  });

  it("insists on the 18+ confirmation, and sends nothing without it", async () => {
    await openSignUp();
    await fillSignUp();
    await userEvent.click(
      within(screen.getByRole("form", { name: "Create account" })).getByRole("button", {
        name: "Create account",
      }),
    );
    expect(alert()).toHaveTextContent("Confirm that you are 18 or older.");
    expect(accounts.calls).toEqual([]);
  });

  it("creates the account, sends tidied details, signs in, and says welcome", async () => {
    await openSignUp();
    await fillSignUp({ name: "  Sam   Q  ", email: " Sam@Example.COM " });
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      within(screen.getByRole("form", { name: "Create account" })).getByRole("button", {
        name: "Create account",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Sam Q" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Account created. Welcome!");
    expect(accounts.calls).toEqual([
      {
        path: "/register",
        body: { email: "sam@example.com", name: "Sam Q", password: "correct horse", adult: true },
      },
    ]);
    expect(screen.getByRole("link", { name: "Sam Q" })).toBeInTheDocument();
  });

  it("shows the server's message when the email is taken", async () => {
    const a = FakeAccounts.signedInAs();
    a.signedIn = false;
    open(a);
    await screen.findByRole("form", { name: "Sign in" });
    await userEvent.click(button("Create account"));
    await fillSignUp();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      within(screen.getByRole("form", { name: "Create account" })).getByRole("button", {
        name: "Create account",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That email already has an account. Try signing in.",
    );
  });
});

describe("a signed-in visitor", () => {
  const signedIn = async () => {
    open(FakeAccounts.signedInAs("Sam", "sam@example.com"));
    return screen.findByRole("heading", { name: "Sam" });
  };

  it("sees their name, email and when they joined, straight away on a return visit", async () => {
    await signedIn();
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Member since/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("can sign out, and the page and header go back to signed out", async () => {
    await signedIn();
    await userEvent.click(button("Sign out"));
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You're signed out.");
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(accounts.signedIn).toBe(false);
  });

  it("can download their data, as a file the browser saves", async () => {
    await signedIn();
    const link = screen.getByRole("link", { name: "Download my data" });
    expect(link).toHaveAttribute("href", "/api/v1/auth/export");
    expect(link).toHaveAttribute("download", "my-data.json");
  });

  it("keeps the change-password and delete forms tucked away until asked for", async () => {
    await signedIn();
    expect(
      screen.getByText("Change password", { selector: "summary" }).closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByText("Delete my account", { selector: "summary" }).closest("details"),
    ).not.toHaveAttribute("open");
  });

  describe("changing the password", () => {
    const openForm = async () => {
      await signedIn();
      await userEvent.click(screen.getByText("Change password", { selector: "summary" }));
    };

    it("refuses a weak new password without asking the server", async () => {
      await openForm();
      await type("Current password", "correct horse");
      await type(/^New password/, "short");
      await userEvent.click(screen.getByRole("button", { name: "Change password" }));
      expect(alert()).toHaveTextContent("Use a new password of 8 to 128 characters.");
      expect(accounts.calls).toEqual([]);
    });

    it("shows the server's message for a wrong current password, and keeps what was typed", async () => {
      await openForm();
      await type("Current password", "wrong");
      await type(/^New password/, "brand new pass");
      await userEvent.click(screen.getByRole("button", { name: "Change password" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("That password isn't right.");
    });

    it("changes it, empties both boxes, and says other devices were signed out", async () => {
      await openForm();
      await type("Current password", "correct horse");
      await type(/^New password/, "brand new pass");
      await userEvent.click(screen.getByRole("button", { name: "Change password" }));
      expect(await screen.findByRole("status")).toHaveTextContent(/Password changed.*signed out/);
      expect(field("Current password")).toHaveValue("");
      expect(field(/^New password/)).toHaveValue("");
      expect(accounts.user?.password).toBe("brand new pass");
      expect(accounts.calls).toEqual([
        { path: "/password", body: { password: "correct horse", next: "brand new pass" } },
      ]);
    });
  });

  describe("deleting the account", () => {
    const openForm = async () => {
      await signedIn();
      await userEvent.click(screen.getByText("Delete my account", { selector: "summary" }));
    };

    it("warns that it is permanent", async () => {
      await openForm();
      expect(screen.getByText(/permanently deletes your account/i)).toBeInTheDocument();
    });

    it("keeps the account when the password is wrong", async () => {
      await openForm();
      await type("Your password", "wrong");
      await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("That password isn't right.");
      expect(accounts.user).not.toBeNull();
      expect(screen.getByRole("heading", { name: "Sam" })).toBeInTheDocument();
    });

    it("deletes it, signs the visitor out everywhere on the page, and says so", async () => {
      await openForm();
      await type("Your password", "correct horse");
      await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
      expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Your account was deleted.");
      expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
      expect(accounts.user).toBeNull();
    });
  });
});

describe("what the page never shows", () => {
  it("keeps every password box a password box, and never prints a password on the page", async () => {
    await openSignUp();
    await fillSignUp({ password: "super secret pw" });
    expect(field(/^Password/)).toHaveAttribute("type", "password");
    expect(document.body.textContent).not.toContain("super secret pw");
  });
});

describe("the rules, terms and privacy pages", () => {
  const visit = async (path: string, config = {}) => {
    stubApi({ config });
    renderAt(path);
  };

  it("are linked from every page's footer", async () => {
    await visit("/");
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Rules" })).toHaveAttribute("href", "/rules");
    expect(within(footer).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("explain the rules, including the age rule and what happens to someone who breaks it", async () => {
    await visit("/rules");
    expect(screen.getByRole("heading", { name: "Rules", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/You must be 18 or older/)).toBeInTheDocument();
    expect(screen.getByText(/removes you for 24 hours/)).toBeInTheDocument();
    expect(document.title).toBe("Rules | Passerby");
  });

  it("cover accounts in the terms", async () => {
    await visit("/terms");
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "account page" })).toHaveAttribute("href", "/account");
  });

  it("describe what is stored about people, and how to download or delete it", async () => {
    await visit("/privacy");
    expect(screen.getByRole("heading", { name: "Privacy", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/hashed password/)).toBeInTheDocument();
    expect(screen.getByText(/only cookie we keep is a sign-in cookie/)).toBeInTheDocument();
    expect(screen.getByText(/never contains your email address/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "account page" })).toHaveAttribute("href", "/account");
    expect(document.title).toBe("Privacy | Passerby");
  });

  it("show the operator's contact address as a mail link when one is set", async () => {
    await visit("/privacy", { contact: "help@example.com" });
    expect(await screen.findByRole("link", { name: "help@example.com" })).toHaveAttribute(
      "href",
      "mailto:help@example.com",
    );
  });

  it("say 'the site operator' when no contact address is set", async () => {
    await visit("/privacy");
    await waitFor(() => expect(screen.getAllByText(/the site operator/).length).toBeGreaterThan(0));
    expect(screen.queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
  });

  it("use the site's configured name", async () => {
    await visit("/rules", { name: "Strollr" });
    expect(await screen.findByText(/Strollr only works if people/)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Rules | Strollr"));
  });
});

describe("page titles", () => {
  it("name each page, and restore the home title when coming back", async () => {
    stubApi();
    renderAt("/");
    await waitFor(() => expect(document.title).toBe("Passerby | Chat with a stranger"));
    await userEvent.click(screen.getByRole("link", { name: "Rules" }));
    await waitFor(() => expect(document.title).toBe("Rules | Passerby"));
    await userEvent.click(screen.getByRole("link", { name: "passerby" }));
    await waitFor(() => expect(document.title).toBe("Passerby | Chat with a stranger"));
  });

  it("names the not-found page", async () => {
    stubApi();
    renderAt("/nowhere");
    await waitFor(() => expect(document.title).toBe("Page not found | Passerby"));
  });
});
