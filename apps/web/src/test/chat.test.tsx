import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { FakeSocket, installFakeSocket } from "./fake-socket.js";
import { stubApi } from "./fetch.js";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  stubApi();
  installFakeSocket();
});
afterEach(() => vi.unstubAllGlobals());

const status = () => screen.getByRole("status");
const log = () => screen.getByRole("log");
const button = (name: RegExp) => screen.getByRole("button", { name });

/** Open the text chat as someone who has already confirmed they are 18+, and let the server say ready. */
async function openChat() {
  localStorage.setItem("pb_adult", "true");
  renderAt("/text");
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
  FakeSocket.last.receive({ t: "ready", online: 1 });
  await waitFor(() => expect(button(/^start$/i)).toBeEnabled());
  return FakeSocket.last;
}

/** Press Start and let the server pair us with someone. */
async function startAndMatch(common: string[] = []) {
  const server = await openChat();
  await userEvent.click(button(/^start$/i));
  server.receive({ t: "waiting" });
  server.receive({ t: "matched", common, init: true });
  await screen.findByRole("textbox", { name: /message/i });
  await waitFor(() => expect(screen.getByRole("textbox", { name: /message/i })).toBeEnabled());
  return server;
}

describe("the 18+ gate", () => {
  it("asks first, and opens no connection until the visitor confirms", async () => {
    renderAt("/text");
    expect(screen.getByRole("heading", { name: /adults only/i })).toBeInTheDocument();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("connects after confirming, and remembers the answer next time", async () => {
    const view = renderAt("/text");
    await userEvent.click(button(/18 or older/i));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    view.unmount();
    renderAt("/text");
    expect(screen.queryByRole("heading", { name: /adults only/i })).not.toBeInTheDocument();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
  });

  it("locks the page for someone who says they are under 18, and keeps it locked", async () => {
    const view = renderAt("/text");
    await userEvent.click(button(/under 18/i));
    expect(screen.getByText(/can.t chat here/i)).toBeInTheDocument();
    expect(FakeSocket.instances).toHaveLength(0);
    view.unmount();
    renderAt("/text");
    expect(screen.getByText(/can.t chat here/i)).toBeInTheDocument();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("copes with junk in storage instead of crashing", async () => {
    localStorage.setItem("pb_adult", "{not json");
    localStorage.setItem("pb_tags", '"a string, not a list"');
    renderAt("/text");
    expect(screen.getByRole("heading", { name: /adults only/i })).toBeInTheDocument();
  });
});

describe("getting ready", () => {
  it("says hello with the age flag as soon as the connection opens, and shows the live count", async () => {
    const server = await openChat();
    expect(server.of("hello")[0]).toEqual({ t: "hello", adult: true, mode: "text", tags: [] });
    expect(status()).toHaveTextContent("Ready when you are");
    expect(await screen.findByText("1 person here now")).toBeInTheDocument();
  });

  it("keeps Start switched off until the server has said ready", async () => {
    localStorage.setItem("pb_adult", "true");
    renderAt("/text");
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(button(/^start$/i)).toBeDisabled();
    expect(status()).toHaveTextContent("Connecting…");
    FakeSocket.last.receive({ t: "ready", online: 2 });
    await waitFor(() => expect(button(/^start$/i)).toBeEnabled());
  });

  it("keeps the header count in step with the chat connection", async () => {
    const server = await openChat();
    server.receive({ t: "count", online: 6 });
    expect(await screen.findByText("6 people here now")).toBeInTheDocument();
  });
});

describe("interests, language and gender", () => {
  it("adds interests with Enter, cleans them, and sends them in the next hello", async () => {
    const server = await openChat();
    await userEvent.type(screen.getByLabelText(/what do you want to talk about/i), "Music!{Enter}");
    await userEvent.type(screen.getByLabelText(/what do you want to talk about/i), "chess,");
    expect(screen.getByRole("button", { name: "Remove music" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove chess" })).toBeInTheDocument();
    await userEvent.click(button(/^start$/i));
    const hellos = server.of("hello");
    expect(hellos.at(-1)).toMatchObject({ tags: ["music", "chess"] });
    expect(server.messages.at(-1)).toEqual({ t: "find" });
  });

  it("offers suggestions until something is added, and removes a chip with a click", async () => {
    await openChat();
    await userEvent.click(screen.getByRole("button", { name: "gaming" }));
    expect(screen.queryByRole("button", { name: "gaming" })).not.toBeInTheDocument(); // suggestions are gone
    await userEvent.click(screen.getByRole("button", { name: "Remove gaming" }));
    expect(screen.getByRole("button", { name: "gaming" })).toBeInTheDocument(); // and back
  });

  it("won't take a duplicate or more than eight interests", async () => {
    await openChat();
    const box = screen.getByLabelText(/what do you want to talk about/i);
    await userEvent.type(box, "a{Enter}A{Enter}");
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
    for (const t of ["b", "c", "d", "e", "f", "g", "h", "i", "j"])
      await userEvent.type(box, `${t}{Enter}`);
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(8);
    expect(box).toBeDisabled();
  });

  it("remembers choices for next time and sends language and gender", async () => {
    const server = await openChat();
    await userEvent.type(screen.getByLabelText(/what do you want to talk about/i), "jazz{Enter}");
    await userEvent.selectOptions(screen.getByLabelText("Language"), "fr");
    await userEvent.selectOptions(screen.getByLabelText("I am"), "f");
    await userEvent.click(button(/^start$/i));
    expect(server.of("hello").at(-1)).toEqual({
      t: "hello",
      adult: true,
      mode: "text",
      tags: ["jazz"],
      lang: "fr",
      gender: "f",
    });
    expect(JSON.parse(localStorage.getItem("pb_tags")!)).toEqual(["jazz"]);
    expect(JSON.parse(localStorage.getItem("pb_lang")!)).toBe("fr");
  });
});

describe("finding someone", () => {
  it("shows searching, then the match with what they have in common, and enables typing", async () => {
    const server = await openChat();
    await userEvent.click(button(/^start$/i));
    expect(status()).toHaveTextContent("Looking for someone…");
    expect(screen.getByRole("textbox", { name: /message/i })).toBeDisabled();
    expect(button(/^next$/i)).toBeInTheDocument();
    server.receive({ t: "matched", common: ["music"], init: false });
    expect(await within(log()).findByText("You both like music. Say hi.")).toBeInTheDocument();
    expect(status()).toHaveTextContent("You're talking to a stranger");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /message/i })).toBeEnabled());
  });

  it("counts down the cool-down when the server asks for a wait", async () => {
    const server = await openChat();
    await userEvent.click(button(/^start$/i));
    server.receive({ t: "wait", ms: 2000 });
    expect(await screen.findByText("Finding someone in 2 seconds.")).toBeInTheDocument();
    server.receive({ t: "waiting" });
    expect(await screen.findByText("Looking for someone…")).toBeInTheDocument();
  });

  it("shows the right countdown even when the page has been open for a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // only the clock; everything else keeps running normally
    try {
      const server = await openChat();
      vi.setSystemTime(Date.now() + 60_000); // a minute passes before the first search
      await userEvent.click(button(/^start$/i));
      server.receive({ t: "wait", ms: 2000 });
      expect(await screen.findByText("Finding someone in 2 seconds.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Stop goes back to the setup screen and tells the server", async () => {
    const server = await openChat();
    await userEvent.click(button(/^start$/i));
    await userEvent.click(button(/^stop$/i));
    expect(server.messages.at(-1)).toEqual({ t: "stop" });
    expect(screen.getByLabelText(/what do you want to talk about/i)).toBeInTheDocument();
    expect(status()).toHaveTextContent("Ready when you are");
  });
});

describe("talking", () => {
  it("sends a message, shows it as mine, clears the box, and ignores blanks", async () => {
    const server = await startAndMatch();
    const box = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(box, "   {Enter}");
    expect(server.of("msg")).toHaveLength(0);
    await userEvent.type(box, "hello there{Enter}");
    expect(server.of("msg")).toEqual([{ t: "msg", text: "hello there" }]);
    expect(within(log()).getByText("hello there")).toHaveClass("me");
    expect(box).toHaveValue("");
  });

  it("shows what the stranger says, as plain text (never as markup)", async () => {
    const server = await startAndMatch();
    server.receive({ t: "msg", text: "<b>hi</b> <img src=x onerror=alert(1)>" });
    const line = await within(log()).findByText("<b>hi</b> <img src=x onerror=alert(1)>");
    expect(line).toHaveClass("them");
    expect(log().querySelector("b, img")).toBeNull();
  });

  it("tells the stranger when I am typing, but not on every key", async () => {
    const server = await startAndMatch();
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "hello");
    expect(server.of("typing")).toHaveLength(1);
  });

  it("shows when the stranger is typing, and stops when their message arrives", async () => {
    const server = await startAndMatch();
    server.receive({ t: "typing" });
    expect(await screen.findByText("Stranger is typing…")).toBeInTheDocument();
    server.receive({ t: "msg", text: "hi" });
    await waitFor(() => expect(status()).toHaveTextContent("You're talking to a stranger"));
  });

  it("says so when the stranger leaves, and Next finds someone else", async () => {
    const server = await startAndMatch();
    server.receive({ t: "ended" });
    expect(await within(log()).findByText("The stranger left.")).toBeInTheDocument();
    expect(status()).toHaveTextContent("Chat ended. Press Next to meet someone else.");
    expect(screen.getByRole("textbox", { name: /message/i })).toBeDisabled();
    await userEvent.click(button(/^next$/i));
    expect(server.messages.at(-1)).toEqual({ t: "find" });
    expect(within(log()).queryByText("The stranger left.")).not.toBeInTheDocument();
  });

  it("shows the server's warning when I send too fast", async () => {
    const server = await startAndMatch();
    server.receive({
      t: "error",
      code: "too_fast",
      text: "That message wasn't sent. You're sending messages too fast.",
    });
    expect(await within(log()).findByText(/too fast/)).toBeInTheDocument();
  });

  it("Escape works as Next", async () => {
    const server = await startAndMatch();
    await userEvent.keyboard("{Escape}");
    expect(server.messages.at(-1)).toEqual({ t: "find" });
    expect(status()).toHaveTextContent("Looking for someone…");
  });

  it("Escape does nothing before the first Start", async () => {
    const server = await openChat();
    await userEvent.keyboard("{Escape}");
    expect(server.of("find")).toHaveLength(0);
  });

  it("ignores messages that don't match the protocol, and non-JSON", async () => {
    const server = await startAndMatch();
    server.receive({ t: "something-new", x: 1 });
    server.receiveRaw("not json");
    expect(status()).toHaveTextContent("You're talking to a stranger");
  });

  it("puts a count in the tab title for messages that arrive while the tab is hidden", async () => {
    const server = await startAndMatch();
    const original = "Text chat | Passerby"; // the page sets its own title
    expect(document.title).toBe(original);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    server.receive({ t: "msg", text: "are you there?" });
    await waitFor(() => expect(document.title).toBe(`(1) ${original}`));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.title).toBe(original);
  });
});

describe("being removed", () => {
  it("explains why, and offers no way to start again", async () => {
    const server = await startAndMatch();
    server.receive({ t: "banned", until: Date.now() + 3600e3, reason: "age" });
    expect(await within(log()).findByText(/Passerby is for adults only/)).toBeInTheDocument();
    expect(status()).toHaveTextContent("You can't chat right now");
    expect(button(/^start$/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^next$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /message/i })).toBeDisabled();
    expect(screen.getByPlaceholderText("You can't chat right now")).toBeInTheDocument();
  });
});

describe("losing the connection", () => {
  it("does not keep retrying once the server has removed the visitor", async () => {
    const server = await openChat();
    server.receive({ t: "banned", until: Date.now() + 3600e3, reason: "rules" });
    server.close(); // the server closes the connection after a ban
    await new Promise((r) => setTimeout(r, 1300));
    expect(FakeSocket.instances).toHaveLength(1);
    expect(status()).toHaveTextContent("You can't chat right now");
  });

  it("says so, reconnects by itself, says hello again, and lets the visitor start again", async () => {
    const first = await startAndMatch();
    first.close(); // the server went away
    expect(await within(log()).findByText(/connection dropped/i)).toBeInTheDocument();
    expect(status()).toHaveTextContent("Connecting…");
    expect(FakeSocket.instances).toHaveLength(1);

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 3000 }); // retry after 1 second
    await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
    FakeSocket.last.receive({ t: "ready", online: 4 });
    await waitFor(() => expect(status()).toHaveTextContent("Ready when you are"));
    expect(button(/^start$/i)).toBeEnabled();
  });

  it("stops retrying when the visitor leaves the page", async () => {
    localStorage.setItem("pb_adult", "true");
    const view = renderAt("/text");
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.last.close();
    view.unmount(); // leave before the one-second retry fires
    await new Promise((r) => setTimeout(r, 1300));
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
