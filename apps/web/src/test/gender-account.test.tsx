import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { FakeAccounts } from "./fake-accounts.js";
import { FakeSocket, installFakeSocket } from "./fake-socket.js";
import { stubApi } from "./fetch.js";

let accounts: FakeAccounts;
const open = (path: string, a = new FakeAccounts()) => {
  accounts = stubApi({ accounts: a }).accounts;
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

const field = (label: RegExp | string) => screen.getByLabelText(label);

async function openSignUp() {
  open("/account");
  await screen.findByRole("form", { name: "Sign in" });
  await userEvent.click(screen.getAllByRole("button", { name: "Create account" })[0]!);
  return screen.getByRole("form", { name: "Create account" });
}

async function fillRest() {
  await userEvent.type(field("Display name"), "Sam");
  await userEvent.type(field("Email"), "sam@example.com");
  await userEvent.type(field(/^Password/), "correct horse");
  await userEvent.click(screen.getByRole("checkbox")); // 18+
}
const submit = (form: HTMLElement) =>
  userEvent.click(within(form).getByRole("button", { name: "Create account" }));

describe("the question on the sign-up form", () => {
  it("asks how the person identifies, with Male and Female, and nothing chosen at first", async () => {
    await openSignUp();
    const select = field("How do you identify?") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose…", "Male", "Female"]);
    expect(select).toHaveValue("");
  });

  it("says what the answer is used for, and that it can be changed", async () => {
    await openSignUp();
    expect(screen.getByText(/fills in .I am. when you chat/i)).toBeInTheDocument();
    expect(screen.getByText(/change it later/i)).toBeInTheDocument();
  });

  it("will not create the account until it is answered, and sends nothing", async () => {
    const form = await openSignUp();
    await fillRest(); // everything else done, including the 18+ box
    await submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose how you identify.");
    expect(accounts.calls).toEqual([]);
  });

  it.each([
    ["m", "m"],
    ["f", "f"],
  ])("sends %s as the answer", async (choice, sent) => {
    const form = await openSignUp();
    await fillRest();
    await userEvent.selectOptions(field("How do you identify?"), choice);
    await submit(form);
    await screen.findByRole("heading", { name: "Sam" });
    expect(accounts.calls[0]).toMatchObject({ path: "/register", body: { gender: sent } });
  });

  it("keeps the answer on the account", async () => {
    const form = await openSignUp();
    await fillRest();
    await userEvent.selectOptions(field("How do you identify?"), "f");
    await submit(form);
    await screen.findByRole("heading", { name: "Sam" });
    expect(accounts.user?.gender).toBe("f");
    expect(field("How you identify")).toHaveValue("f");
  });
});

describe("changing it on the account page", () => {
  it("shows the current answer", async () => {
    const a = FakeAccounts.signedInAs("Sam");
    a.user!.gender = "m";
    open("/account", a);
    await screen.findByRole("heading", { name: "Sam" });
    expect(field("How you identify")).toHaveValue("m");
  });

  it("asks someone who has not said yet, such as a new Google account, to choose", async () => {
    open("/account", FakeAccounts.googleOnly("Riley"));
    await screen.findByRole("heading", { name: "Riley" });
    const select = field("How you identify") as HTMLSelectElement;
    expect(select).toHaveValue("");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose…", "Male", "Female"]);
    expect(screen.getByRole("note")).toHaveTextContent("Please choose");
  });

  it("does not offer 'Choose…' once there is an answer, and drops the prompt", async () => {
    const a = FakeAccounts.signedInAs("Sam");
    a.user!.gender = "f";
    open("/account", a);
    await screen.findByRole("heading", { name: "Sam" });
    const select = field("How you identify") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Male", "Female"]);
    expect(screen.queryByText(/Please choose/)).not.toBeInTheDocument();
  });

  it("lets them choose, and then the prompt goes away", async () => {
    open("/account", FakeAccounts.googleOnly("Riley"));
    await screen.findByRole("heading", { name: "Riley" });
    await userEvent.selectOptions(field("How you identify"), "f");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    await waitFor(() => expect(screen.queryByText(/Please choose/)).not.toBeInTheDocument());
    expect(accounts.user?.gender).toBe("f");
  });

  it("saves a change straight away and says so", async () => {
    open("/account", FakeAccounts.signedInAs("Sam"));
    await screen.findByRole("heading", { name: "Sam" });
    await userEvent.selectOptions(field("How you identify"), "f");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(accounts.calls).toEqual([{ path: "/profile", body: { gender: "f" } }]);
    expect(accounts.user?.gender).toBe("f");
    await waitFor(() => expect(field("How you identify")).toHaveValue("f"));
  });

  it("shows the server's message if saving fails, and keeps the old answer", async () => {
    const a = FakeAccounts.signedInAs("Sam");
    a.user!.gender = "m";
    open("/account", a);
    await screen.findByRole("heading", { name: "Sam" });
    a.failNext = { status: 500, code: "internal", message: "Something went wrong." };
    await userEvent.selectOptions(field("How you identify"), "f");
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(accounts.user?.gender).toBe("m");
  });
});

describe("in the chat", () => {
  async function openChat(a: FakeAccounts) {
    localStorage.setItem("pb_adult", "true");
    open("/text", a);
    await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
    FakeSocket.last.receive({ t: "ready", online: 1 });
    await waitFor(() => expect(screen.getByRole("button", { name: /^start$/i })).toBeEnabled());
    // the filters live behind the "Smart Match" pill
    await userEvent.click(screen.getByRole("button", { name: /match filters/i }));
    await userEvent.click(screen.getByRole("tab", { name: "Preferences" }));
  }
  const iAm = () => screen.getByLabelText("I am") as HTMLSelectElement;

  it("fills in 'I am' from the account of someone signed in", async () => {
    const a = FakeAccounts.signedInAs("Sam");
    a.user!.gender = "f";
    await openChat(a);
    await waitFor(() => expect(iAm()).toHaveValue("f"));
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(FakeSocket.last.of("hello").at(-1)).toMatchObject({ gender: "f" });
  });

  it("leaves 'I am' alone for an account with no answer yet", async () => {
    await openChat(FakeAccounts.signedInAs("Sam"));
    expect(iAm()).toHaveValue("");
  });

  it("does not overwrite a choice the person already made here, even 'Rather not say'", async () => {
    localStorage.setItem("pb_me", JSON.stringify(""));
    const a = FakeAccounts.signedInAs("Sam");
    a.user!.gender = "f";
    await openChat(a);
    await new Promise((r) => setTimeout(r, 50));
    expect(iAm()).toHaveValue("");
  });

  it("does nothing for a visitor who is not signed in", async () => {
    await openChat(new FakeAccounts());
    expect(iAm()).toHaveValue("");
  });
});
