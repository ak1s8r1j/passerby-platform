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

async function openChat() {
  localStorage.setItem("pb_adult", "true");
  render(
    <MemoryRouter initialEntries={["/text"]}>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
  FakeSocket.last.receive({ t: "ready", online: 1 });
  await waitFor(() => expect(screen.getByRole("button", { name: /^start$/i })).toBeEnabled());
  // the filters live behind the "Smart Match" pill
  await userEvent.click(screen.getByRole("button", { name: /match filters/i }));
  await userEvent.click(screen.getByRole("tab", { name: "Preferences" }));
  return FakeSocket.last;
}

const talkTo = () => screen.getByLabelText("Talk to") as HTMLSelectElement;

describe("choosing who to talk to", () => {
  it("offers Both, Male and Female, with Both chosen at first", async () => {
    await openChat();
    expect([...talkTo().options].map((o) => o.textContent)).toEqual(["Both", "Male", "Female"]);
    expect(talkTo()).toHaveValue("");
  });

  it("is the first of the choices, ahead of 'I am'", async () => {
    await openChat();
    const labels = [...document.querySelectorAll(".three label")].map((l) => l.textContent);
    expect(labels).toEqual(["Talk to", "I am"]);
  });

  it("sends nothing extra when it is Both, so existing behaviour is unchanged", async () => {
    const server = await openChat();
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(server.of("hello").at(-1)).toEqual({ t: "hello", adult: true, mode: "text", tags: [] });
  });

  it("sends who you want to talk to, and what you are, in the next hello", async () => {
    const server = await openChat();
    await userEvent.selectOptions(talkTo(), "f");
    await userEvent.selectOptions(screen.getByLabelText("I am"), "m");
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(server.of("hello").at(-1)).toEqual({
      t: "hello",
      adult: true,
      mode: "text",
      tags: [],
      gender: "m",
      seek: "f",
    });
  });

  it("remembers the choice for next time", async () => {
    await openChat();
    await userEvent.selectOptions(talkTo(), "m");
    expect(JSON.parse(localStorage.getItem("pb_seek")!)).toBe("m");
  });

  it("starts from a remembered choice", async () => {
    localStorage.setItem("pb_seek", JSON.stringify("f"));
    await openChat();
    expect(talkTo()).toHaveValue("f");
  });

  it("falls back to Both when what was stored is not a valid choice", async () => {
    localStorage.setItem("pb_seek", JSON.stringify("robot"));
    await openChat();
    expect(talkTo()).toHaveValue("");
  });

  it("explains what a filter means, and nudges you to say what you are too", async () => {
    await openChat();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await userEvent.selectOptions(talkTo(), "f");
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Only people who say they are female will be matched with you");
    expect(note).toHaveTextContent("Choose what you are too");
    await userEvent.selectOptions(screen.getByLabelText("I am"), "m");
    expect(screen.getByRole("note")).not.toHaveTextContent("Choose what you are too");
    await userEvent.selectOptions(talkTo(), "m");
    expect(screen.getByRole("note")).toHaveTextContent("say they are male");
    await userEvent.selectOptions(talkTo(), "");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
