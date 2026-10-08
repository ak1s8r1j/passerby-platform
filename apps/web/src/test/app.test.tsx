import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { FakeSocket, installFakeSocket } from "./fake-socket.js";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ online: 3 }), { status: 200 })),
  );
  installFakeSocket();
});
afterEach(() => vi.unstubAllGlobals());

describe("home page", () => {
  it("shows the pitch, both chat buttons and the live count", async () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/say hi/i);
    expect(screen.getByRole("link", { name: /start text chat/i })).toHaveAttribute("href", "/text");
    expect(screen.getByRole("link", { name: /start video chat/i })).toHaveAttribute(
      "href",
      "/video",
    );
    expect(await screen.findByText(/3 people here now/)).toBeInTheDocument();
  });

  it("copes with the API being down: no count, no crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/here now/)).not.toBeInTheDocument();
  });

  it("opens no chat connection just for looking at the home page", async () => {
    renderAt("/");
    await screen.findByText(/3 people here now/);
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

describe("routing", () => {
  it("shows a not-found page for unknown addresses", () => {
    renderAt("/nope");
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
  });

  it("has a skip link for keyboard users", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main");
    expect(document.getElementById("main")).not.toBeNull();
  });

  it("keeps the live count out of the way until it is known", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    renderAt("/");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
    expect(screen.queryByText(/here now/)).not.toBeInTheDocument();
  });
});
