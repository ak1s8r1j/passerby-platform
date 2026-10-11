import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { FakeSocket, installFakeSocket } from "./fake-socket.js";
import { stubApi } from "./fetch.js";

beforeEach(() => {
  localStorage.clear();
  stubApi();
  installFakeSocket();
});
afterEach(() => vi.unstubAllGlobals());

/** A text chat that has just matched. */
async function chatting() {
  localStorage.setItem("pb_adult", "true");
  render(
    <MemoryRouter initialEntries={["/text"]}>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
  const server = FakeSocket.last;
  server.receive({ t: "ready", online: 2 });
  await waitFor(() => expect(screen.getByRole("button", { name: /^start$/i })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
  server.receive({ t: "waiting" });
  server.receive({ t: "matched", common: [], init: true });
  await screen.findByRole("button", { name: "Games" });
  return server;
}

describe("reactions in a chat", () => {
  it("only offers reactions while chatting", async () => {
    localStorage.setItem("pb_adult", "true");
    render(
      <MemoryRouter initialEntries={["/text"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
    FakeSocket.last.receive({ t: "ready", online: 1 });
    expect(screen.queryByRole("group", { name: /send a reaction/i })).toBeNull();
  });

  it("sends a reaction and shows it rising, and shows the stranger's too", async () => {
    const server = await chatting();
    await userEvent.click(screen.getByRole("button", { name: "Send fire" }));
    expect(server.of("react")).toEqual([{ t: "react", e: "🔥" }]);
    expect(document.querySelectorAll(".float.me")).toHaveLength(1);
    server.receive({ t: "react", e: "❤️" });
    await waitFor(() => expect(document.querySelectorAll(".float.them")).toHaveLength(1));
    expect(document.querySelector(".float.them")).toHaveTextContent("❤️");
  });

  it("ignores very quick repeat taps, and clears when the chat ends", async () => {
    const server = await chatting();
    const clap = screen.getByRole("button", { name: "Send clap" });
    await userEvent.click(clap);
    await userEvent.click(clap);
    expect(server.of("react")).toHaveLength(1);
    server.receive({ t: "ended" });
    await waitFor(() => expect(document.querySelectorAll(".float")).toHaveLength(0));
    expect(screen.queryByRole("group", { name: /send a reaction/i })).toBeNull();
  });
});
