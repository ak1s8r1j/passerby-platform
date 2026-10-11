import { render, screen, waitFor, within } from "@testing-library/react";
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

const games = (server: FakeSocket) => server.of("game").map((m) => m.g);
const pickGame = async (name: RegExp) => {
  await userEvent.click(screen.getByRole("button", { name: "Games" }));
  await userEvent.click(screen.getByRole("button", { name: name }));
};

describe("games in a chat", () => {
  it("only offers games while chatting", async () => {
    localStorage.setItem("pb_adult", "true");
    render(
      <MemoryRouter initialEntries={["/text"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
    FakeSocket.last.receive({ t: "ready", online: 1 });
    expect(screen.queryByRole("button", { name: "Games" })).toBeNull();
  });

  it("lists the games, and sends an invitation when one is picked", async () => {
    const server = await chatting();
    await userEvent.click(screen.getByRole("button", { name: "Games" }));
    for (const name of [
      /would you rather/i,
      /rock paper scissors/i,
      /tic-tac-toe/i,
      /connect 4/i,
      /trivia/i,
      /two truths and a lie/i,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("button", { name: /rock paper scissors/i }));
    expect(games(server)).toEqual([{ k: "invite", game: "rps", seed: expect.any(Number) }]);
    expect(await screen.findByText(/waiting for the stranger to join/i)).toBeInTheDocument();
  });

  it("takes an invitation back with Cancel", async () => {
    const server = await chatting();
    await pickGame(/tic-tac-toe/i);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(games(server).at(-1)).toEqual({ k: "quit" });
    expect(screen.queryByText(/waiting for the stranger/i)).toBeNull();
  });

  it("says when the stranger says no", async () => {
    const server = await chatting();
    await pickGame(/tic-tac-toe/i);
    server.receive({ t: "game", g: { k: "decline" } });
    expect(await screen.findByText(/said no thanks/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText(/said no thanks/i)).toBeNull();
  });

  it("shows an invitation, and starts the game when it is accepted", async () => {
    const server = await chatting();
    server.receive({ t: "game", g: { k: "invite", game: "ttt", seed: 5 } });
    expect(await screen.findByText(/wants to play tic-tac-toe/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(games(server)).toEqual([{ k: "accept" }]);
    // seed 5 is odd: the person who accepted goes first
    expect(await screen.findByText(/your turn/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Square 5, empty" }));
    expect(games(server).at(-1)).toEqual({ k: "move", r: 0, v: 4 });
    expect(screen.getByRole("button", { name: "Square 5, O" })).toBeInTheDocument();
    expect(await screen.findByText(/stranger's turn/i)).toBeInTheDocument();
  });

  it("declines politely", async () => {
    const server = await chatting();
    server.receive({ t: "game", g: { k: "invite", game: "wyr", seed: 3 } });
    await userEvent.click(await screen.findByRole("button", { name: "No thanks" }));
    expect(games(server)).toEqual([{ k: "decline" }]);
    expect(screen.queryByText(/wants to play/i)).toBeNull();
  });

  it("plays rock paper scissors to the end and puts the result in the conversation", async () => {
    const server = await chatting();
    await pickGame(/rock paper scissors/i);
    server.receive({ t: "game", g: { k: "accept" } });
    const hand = (n: string) => screen.findByRole("button", { name: n });
    // two rounds: I play paper against rock both times
    for (let r = 0; r < 2; r++) {
      await userEvent.click(await hand("Paper"));
      expect(games(server).at(-1)).toEqual({ k: "move", r, v: 1 });
      server.receive({ t: "game", g: { k: "move", r, v: 0 } });
      expect(await screen.findByText(/you win this round/i)).toBeInTheDocument();
      if (r === 0) await screen.findByText("Choose your hand.", {}, { timeout: 5000 });
    }
    const log = screen.getByRole("log");
    expect(
      await within(log).findByText("Rock paper scissors: You won, 2 to 0.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  }, 20_000);

  it("shows the stranger's choices in would you rather, round by round", async () => {
    const server = await chatting();
    await pickGame(/would you rather/i);
    server.receive({ t: "game", g: { k: "accept" } });
    const invite = games(server)[0] as { seed: number };
    expect(invite.seed).toBeGreaterThanOrEqual(0);
    expect(await screen.findByText(/round 1 of 5/i)).toBeInTheDocument();
    const options = document.querySelectorAll<HTMLButtonElement>(".wyr-opt");
    expect(options).toHaveLength(2);
    await userEvent.click(options[0]!);
    expect(games(server).at(-1)).toEqual({ k: "move", r: 0, v: 0 });
    expect(await screen.findByText(/waiting for the stranger/i)).toBeInTheDocument();
    server.receive({ t: "game", g: { k: "move", r: 0, v: 0 } });
    expect(await screen.findByText(/you both picked/i)).toBeInTheDocument();
  });

  it("tells you when the stranger leaves a game", async () => {
    const server = await chatting();
    await pickGame(/tic-tac-toe/i);
    server.receive({ t: "game", g: { k: "accept" } });
    server.receive({ t: "game", g: { k: "quit" } });
    expect(await screen.findByText(/left the game/i)).toBeInTheDocument();
  });

  it("puts the game away when the chat ends", async () => {
    const server = await chatting();
    await pickGame(/tic-tac-toe/i);
    server.receive({ t: "game", g: { k: "accept" } });
    await screen.findByRole("group", { name: /tic-tac-toe board/i });
    server.receive({ t: "ended" });
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: /tic-tac-toe board/i })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Games" })).toBeNull();
  });

  it("shows a picture and a name on every game tile", async () => {
    await chatting();
    await userEvent.click(screen.getByRole("button", { name: "Games" }));
    const tiles = document.querySelectorAll(".game-pick");
    expect(tiles).toHaveLength(6);
    tiles.forEach((t) => {
      expect(t.querySelector(".game-art svg")).not.toBeNull();
      expect(t.querySelector("strong")?.textContent).toBeTruthy();
    });
  });

  it("plays Connect 4: your disc drops to the bottom and the move is sent", async () => {
    const server = await chatting();
    server.receive({ t: "game", g: { k: "invite", game: "c4", seed: 5 } });
    await userEvent.click(await screen.findByRole("button", { name: "Play" }));
    expect(await screen.findByText(/your turn\. you are yellow/i)).toBeInTheDocument(); // odd seed: you start
    await userEvent.click(screen.getByRole("button", { name: "Drop a disc in column 4" }));
    expect(games(server).at(-1)).toEqual({ k: "move", r: 0, v: 3 });
    expect(document.querySelectorAll(".c4-cell.d1")).toHaveLength(1);
    expect(await screen.findByText(/stranger's turn/i)).toBeInTheDocument();
    server.receive({ t: "game", g: { k: "move", r: 1, v: 3 } });
    await waitFor(() => expect(document.querySelectorAll(".c4-cell.d0")).toHaveLength(1));
  });

  it("plays trivia: shows a question, sends your answer, and shows the right one", async () => {
    const server = await chatting();
    server.receive({ t: "game", g: { k: "invite", game: "trivia", seed: 2 } });
    await userEvent.click(await screen.findByRole("button", { name: "Play" }));
    expect(await screen.findByText(/question 1 of 5/i)).toBeInTheDocument();
    const options = document.querySelectorAll<HTMLButtonElement>(".trivia-opt");
    expect(options).toHaveLength(4);
    await userEvent.click(options[0]!);
    expect(games(server).at(-1)).toEqual({ k: "move", r: 0, v: 0 });
    server.receive({ t: "game", g: { k: "move", r: 0, v: 1 } });
    await waitFor(() => expect(document.querySelectorAll(".trivia-opt.right")).toHaveLength(1));
  });

  it("plays two truths and a lie as the guesser", async () => {
    const server = await chatting();
    server.receive({ t: "game", g: { k: "invite", game: "ttl", seed: 8 } });
    await userEvent.click(await screen.findByRole("button", { name: "Play" }));
    expect(await screen.findByText(/stranger is writing/i)).toBeInTheDocument();
    ["I have a twin", "I have been to Japan", "I can juggle"].forEach((text, i) =>
      server.receive({ t: "game", g: { k: "say", i, text } }),
    );
    expect(await screen.findByText(/which one is the lie/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I have been to Japan" }));
    expect(games(server).at(-1)).toEqual({ k: "move", r: 0, v: 1 });
    server.receive({ t: "game", g: { k: "move", r: 0, v: 1 } });
    expect(await screen.findByText(/you spotted the lie/i)).toBeInTheDocument();
  });

  it("plays two truths and a lie as the writer: sends three statements and keeps the lie to itself", async () => {
    const server = await chatting();
    await pickGame(/two truths and a lie/i);
    server.receive({ t: "game", g: { k: "accept" } });
    const lines = ["I have a twin", "I have been to Japan", "I can juggle"];
    await screen.findByLabelText("Statement 1");
    for (let i = 0; i < 3; i++) {
      await userEvent.type(screen.getByLabelText(`Statement ${i + 1}`), lines[i]!);
    }
    const send = screen.getByRole("button", { name: /send to the stranger/i });
    expect(send).toBeDisabled(); // no lie chosen yet
    await userEvent.click(screen.getByLabelText("Statement 3 is the lie"));
    await userEvent.click(send);
    const sent = games(server).filter((g) => g.k === "say") as {
      k: "say";
      i: number;
      text: string;
    }[];
    expect(sent.map((m) => m.i)).toEqual([0, 1, 2]);
    expect(sent.map((m) => m.text).sort()).toEqual([...lines].sort());
    expect(games(server).some((g) => g.k === "move")).toBe(false);
    expect(await screen.findByText(/waiting for the stranger to guess/i)).toBeInTheDocument();
    // their guess is answered with the lie, in whatever place it was mixed to
    const lieAt = sent.findIndex((m) => m.text === "I can juggle");
    server.receive({ t: "game", g: { k: "move", r: 0, v: lieAt } });
    await waitFor(() => expect(games(server).at(-1)).toEqual({ k: "move", r: 0, v: lieAt }));
    expect(await screen.findByText(/they spotted your lie/i)).toBeInTheDocument();
  });
});
