import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import {
  canReport,
  chatReducer,
  initialChat,
  REPORT_THANKS_AFTER,
  REPORT_THANKS_LIVE,
  type ChatState,
} from "../chat/state.js";
import { FakeSocket, installFakeSocket } from "./fake-socket.js";
import { stubApi } from "./fetch.js";

const toServer = (s: ChatState, msg: object) =>
  chatReducer(s, { type: "server", msg: msg as never, now: 0, siteName: "Passerby" });

const chatting = () => {
  let s = chatReducer(initialChat, { type: "start" });
  s = toServer(s, { t: "waiting" });
  return toServer(s, { t: "matched", common: [], init: true });
};

describe("the chat screen's idea of reporting", () => {
  it("offers a report during a chat and after one ends, but not before or while searching", () => {
    expect(canReport(initialChat)).toBe(false);
    expect(canReport(chatReducer(initialChat, { type: "start" }))).toBe(false);
    expect(canReport(chatting())).toBe(true);
    expect(canReport(toServer(chatting(), { t: "ended" }))).toBe(true);
    expect(canReport(chatReducer(chatting(), { type: "stop" }))).toBe(false);
  });

  it("ends the chat and says thanks when a report is saved during it", () => {
    const s = toServer(chatting(), { t: "reported" });
    expect(s.phase).toBe("ended");
    expect(s.reported).toBe(true);
    expect(s.lines.at(-1)).toMatchObject({ kind: "sys", text: REPORT_THANKS_LIVE });
    expect(canReport(s)).toBe(false);
  });

  it("just says thanks when a report is saved after the stranger had already left", () => {
    const left = toServer(chatting(), { t: "ended" });
    const s = toServer(left, { t: "reported" });
    expect(s.phase).toBe("ended");
    expect(s.lines.at(-1)).toMatchObject({ text: REPORT_THANKS_AFTER });
    expect(canReport(s)).toBe(false);
  });

  it("ignores a stray 'reported' when there is no chat", () => {
    expect(toServer(initialChat, { t: "reported" })).toBe(initialChat);
  });

  it("offers a report again in the next chat", () => {
    let s = toServer(chatting(), { t: "reported" });
    s = chatReducer(s, { type: "start" });
    expect(s.reported).toBe(false);
    s = toServer(toServer(s, { t: "waiting" }), { t: "matched", common: [], init: false });
    expect(canReport(s)).toBe(true);
  });
});

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

const button = (name: RegExp) => screen.getByRole("button", { name });

async function matched() {
  localStorage.setItem("pb_adult", "true");
  renderAt("/text");
  await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
  const sock = FakeSocket.last;
  sock.receive({ t: "ready", online: 2 });
  await waitFor(() => expect(button(/^start$/i)).toBeEnabled());
  await userEvent.click(button(/^start$/i));
  sock.receive({ t: "waiting" });
  sock.receive({ t: "matched", common: [], init: true });
  await waitFor(() => expect(screen.getByRole("textbox", { name: /message/i })).toBeEnabled());
  return sock;
}

describe("reporting from the chat page", () => {
  it("has no Report button before anyone is matched", async () => {
    localStorage.setItem("pb_adult", "true");
    renderAt("/text");
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Report" })).not.toBeInTheDocument();
  });

  it("opens a form with the reasons, and Cancel sends nothing", async () => {
    const sock = await matched();
    await userEvent.click(button(/^report$/i));
    const form = await screen.findByRole("dialog", { name: /report this person/i });
    const reasons = within(form).getAllByRole("radio");
    expect(reasons.map((r) => (r as HTMLInputElement).value)).toEqual([
      "nudity",
      "underage",
      "harassment",
      "spam",
      "other",
    ]);
    await userEvent.click(within(form).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sock.of("report")).toHaveLength(0);
  });

  it("sends the chosen reason, ends the chat, says thanks, and stops offering the button", async () => {
    const sock = await matched();
    await userEvent.click(button(/^report$/i));
    const form = await screen.findByRole("dialog");
    await userEvent.click(within(form).getByRole("radio", { name: /nudity/i }));
    await userEvent.click(within(form).getByRole("button", { name: /send report/i }));
    expect(sock.of("report")).toEqual([{ t: "report", reason: "nudity" }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    sock.receive({ t: "reported" });
    expect(await screen.findByText(REPORT_THANKS_LIVE)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/chat ended/i);
    expect(screen.queryByRole("button", { name: "Report" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /message/i })).toBeDisabled();
  });

  it("defaults to 'Harassment or hate' if nothing else is picked", async () => {
    const sock = await matched();
    await userEvent.click(button(/^report$/i));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: /send report/i }),
    );
    expect(sock.of("report")).toEqual([{ t: "report", reason: "harassment" }]);
  });

  it("can still report after the stranger leaves", async () => {
    const sock = await matched();
    sock.receive({ t: "ended" });
    expect(await screen.findByText("The stranger left.")).toBeInTheDocument();
    await userEvent.click(button(/^report$/i));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: /send report/i }),
    );
    sock.receive({ t: "reported" });
    expect(await screen.findByText(REPORT_THANKS_AFTER)).toBeInTheDocument();
  });

  it("closes the form if the visitor moves on to the next chat while it is open", async () => {
    const sock = await matched();
    await userEvent.click(button(/^report$/i));
    await screen.findByRole("dialog");
    sock.receive({ t: "banned", until: Date.now() + 1000, reason: "rules" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the server's message when there is nothing to report", async () => {
    const sock = await matched();
    sock.receive({
      t: "error",
      code: "nothing_to_report",
      text: "There's no recent chat to report.",
    });
    expect(await screen.findByText("There's no recent chat to report.")).toBeInTheDocument();
  });
});
