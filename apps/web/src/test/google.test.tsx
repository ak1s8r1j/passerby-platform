import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { FakeAccounts } from "./fake-accounts.js";
import { installFakeSocket } from "./fake-socket.js";
import { stubApi } from "./fetch.js";

let accounts: FakeAccounts;
const open = (path = "/account", a = new FakeAccounts(), googleSignIn = true) => {
  accounts = stubApi({ accounts: a, config: { googleSignIn } }).accounts;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  localStorage.clear();
  installFakeSocket();
});
afterEach(() => vi.unstubAllGlobals());

const button = (name: RegExp | string) => screen.getByRole("button", { name });
const field = (label: RegExp | string) => screen.getByLabelText(label);
const type = (label: RegExp | string, text: string) => userEvent.type(field(label), text);
const googleLink = () => screen.queryByRole("link", { name: /Continue with Google/ });

describe("the Continue with Google button", () => {
  it("is not shown when the site has no Google sign-in set up", async () => {
    open("/account", new FakeAccounts(), false);
    await screen.findByRole("form", { name: "Sign in" });
    expect(googleLink()).not.toBeInTheDocument();
  });

  it("is shown on the sign-in tab and goes straight to the start address", async () => {
    open();
    await screen.findByRole("form", { name: "Sign in" });
    expect(googleLink()).toHaveAttribute("href", "/api/v1/auth/google/start");
  });

  it("on the sign-up tab, refuses to leave until the 18+ box is ticked", async () => {
    open();
    await screen.findByRole("form", { name: "Sign in" });
    await userEvent.click(button("Create account"));
    await userEvent.click(googleLink()!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm that you are 18 or older.");
  });

  it("on the sign-up tab, carries the 18+ confirmation once it is ticked", async () => {
    open();
    await screen.findByRole("form", { name: "Sign in" });
    await userEvent.click(button("Create account"));
    await userEvent.click(screen.getByRole("checkbox"));
    expect(googleLink()).toHaveAttribute("href", "/api/v1/auth/google/start?adult=1");
  });
});

describe("coming back from Google", () => {
  it("says what happened for a known result", async () => {
    open("/account?google=email_in_use");
    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/);
  });

  it("welcomes a new Google account and shows it signed in", async () => {
    open("/account?google=created", FakeAccounts.googleOnly("Riley"));
    expect(await screen.findByRole("heading", { name: "Riley" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Account created with Google");
  });

  it("gives a general message for a code it does not know, never echoing it", async () => {
    open("/account?google=<b>hello</b>");
    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent("Google sign-in didn't work");
    expect(message).not.toHaveTextContent("hello");
  });
});

describe("a Google-only account", () => {
  const signedIn = async () => {
    open("/account", FakeAccounts.googleOnly("Riley", "riley@example.com"));
    await screen.findByRole("heading", { name: "Riley" });
  };

  it("shows how it can sign in: no password, Google connected", async () => {
    await signedIn();
    expect(screen.getByText("Password: not set")).toBeInTheDocument();
    expect(screen.getByText("Google: connected")).toBeInTheDocument();
  });

  it("cannot disconnect Google until there is a password, and says so", async () => {
    await signedIn();
    expect(screen.queryByRole("button", { name: "Disconnect Google" })).not.toBeInTheDocument();
    expect(screen.getByText(/Set a password below/)).toBeInTheDocument();
  });

  it("sets a password without asking for a current one, then offers to disconnect Google", async () => {
    await signedIn();
    await userEvent.click(screen.getByText("Set a password", { selector: "summary" }));
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    await type(/^Password/, "brand new pass");
    await userEvent.click(button("Set password"));
    expect(await screen.findByRole("status")).toHaveTextContent(/Password set/);
    expect(accounts.calls).toEqual([{ path: "/password", body: { next: "brand new pass" } }]);
    expect(await screen.findByText("Password: set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect Google" })).toBeInTheDocument();
    // the form is now the ordinary change-password one
    expect(screen.getByText("Change password", { selector: "summary" })).toBeInTheDocument();
  });

  it("refuses a weak new password without asking the server", async () => {
    await signedIn();
    await userEvent.click(screen.getByText("Set a password", { selector: "summary" }));
    await type(/^Password/, "short");
    await userEvent.click(button("Set password"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Use a new password of 8 to 128 characters.",
    );
    expect(accounts.calls).toEqual([]);
  });

  it("deletes by typing the email address, and rejects a different one", async () => {
    await signedIn();
    await userEvent.click(screen.getByText("Delete my account", { selector: "summary" }));
    expect(screen.queryByLabelText("Your password")).not.toBeInTheDocument();
    await type(/email address/, "someone@else.com");
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't the email");
    expect(accounts.user).not.toBeNull();

    await userEvent.clear(field(/email address/));
    await type(/email address/, "riley@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
    expect(accounts.user).toBeNull();
  });
});

describe("a password account", () => {
  it("offers Connect Google, pointing at the link flow", async () => {
    open("/account", FakeAccounts.signedInAs("Sam"));
    await screen.findByRole("heading", { name: "Sam" });
    expect(screen.getByText("Google: not connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Connect Google/ })).toHaveAttribute(
      "href",
      "/api/v1/auth/google/start?link=1",
    );
  });

  it("can disconnect Google, and then offers to connect it again", async () => {
    const a = FakeAccounts.signedInAs("Sam");
    a.user!.google = true;
    open("/account", a);
    await screen.findByRole("heading", { name: "Sam" });
    await userEvent.click(button("Disconnect Google"));
    expect(await screen.findByRole("status")).toHaveTextContent("Google is disconnected");
    await waitFor(() => expect(screen.getByText("Google: not connected")).toBeInTheDocument());
    expect(accounts.calls).toEqual([{ path: "/google/unlink", body: {} }]);
    expect(accounts.user?.google).toBe(false);
  });

  it("hides the sign-in methods box when the site has no Google and the account has none", async () => {
    open("/account", FakeAccounts.signedInAs("Sam"), false);
    await screen.findByRole("heading", { name: "Sam" });
    expect(screen.queryByText("Ways to sign in")).not.toBeInTheDocument();
  });
});
