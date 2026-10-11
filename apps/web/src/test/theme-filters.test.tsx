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
  delete document.documentElement.dataset.theme;
  stubApi();
  installFakeSocket();
});
afterEach(() => vi.unstubAllGlobals());

const toggle = () => screen.getByRole("switch", { name: "Dark mode" });

describe("light and dark mode", () => {
  it("follows the system until the visitor chooses, and sets the page's theme", async () => {
    renderAt("/");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  it("switches to dark and back, and remembers the choice", async () => {
    const view = renderAt("/");
    await userEvent.click(toggle());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem("pb_theme")!)).toBe("dark");
    view.unmount();
    renderAt("/");
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(toggle());
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("is on every public page, such as the chat page", async () => {
    localStorage.setItem("pb_adult", "true");
    renderAt("/text");
    expect(toggle()).toBeInTheDocument();
  });

  it("ignores junk in storage", async () => {
    localStorage.setItem("pb_theme", JSON.stringify("purple"));
    renderAt("/");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  });
});

async function openChat(path = "/text") {
  localStorage.setItem("pb_adult", "true");
  renderAt(path);
  await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
  FakeSocket.last.receive({ t: "ready", online: 1 });
  await waitFor(() => expect(screen.getByRole("button", { name: /^start$/i })).toBeEnabled());
  return FakeSocket.last;
}
const pill = () => screen.getByRole("button", { name: /match filters/i });

describe("the welcome panel", () => {
  it("greets, states the age rule and the main rules", async () => {
    await openChat();
    expect(screen.getByRole("heading", { name: /welcome to passerby/i })).toBeInTheDocument();
    expect(screen.getByText("18+")).toBeInTheDocument();
    expect(screen.getByText(/you must be 18 or older/i)).toBeInTheDocument();
    expect(screen.getByText(/no nudity, hate speech or harassment/i)).toBeInTheDocument();
  });

  it("mentions the IP address on the video page only", async () => {
    await openChat("/video");
    expect(screen.getByText(/can reveal your IP address/i)).toBeInTheDocument();
  });

  it("goes away once a chat starts", async () => {
    const server = await openChat();
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    server.receive({ t: "waiting" });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /welcome/i })).not.toBeInTheDocument(),
    );
  });
});

describe("the Smart Match filter pill", () => {
  it("says Smart Match when nothing is filtered, and keeps the filters hidden until pressed", async () => {
    await openChat();
    expect(pill()).toHaveTextContent("Smart Match");
    expect(pill()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Talk to")).not.toBeInTheDocument();
  });

  it("opens a panel with every choice, and closes it again", async () => {
    await openChat();
    await userEvent.click(pill());
    const panel = screen.getByRole("group", { name: "Match filters" });
    // three tabs, opening on Country
    expect(
      within(panel)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Country", "Language", "Preferences"]);
    expect(within(panel).getByRole("tab", { name: "Country" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(within(panel).getByRole("tab", { name: "Preferences" }));
    expect(within(panel).getByLabelText("Talk to")).toBeInTheDocument();
    expect(within(panel).getByLabelText("I am")).toBeInTheDocument();
    expect(within(panel).getByLabelText(/what do you want to talk about/i)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("tab", { name: "Language" }));
    expect(within(panel).getByRole("button", { name: "Any language" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(pill()).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Close filters" }));
    expect(screen.queryByRole("group", { name: "Match filters" })).not.toBeInTheDocument();
  });

  it("closes on Escape without skipping or starting anything", async () => {
    const server = await openChat();
    await userEvent.click(pill());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Match filters" })).not.toBeInTheDocument();
    expect(server.of("find")).toHaveLength(0);
  });

  it("closes when you press somewhere else", async () => {
    await openChat();
    await userEvent.click(pill());
    await userEvent.click(screen.getByRole("heading", { name: /welcome/i }));
    expect(screen.queryByRole("group", { name: "Match filters" })).not.toBeInTheDocument();
  });

  it("sums up the filters on the pill", async () => {
    await openChat();
    await userEvent.click(pill());
    await userEvent.click(screen.getByRole("tab", { name: "Preferences" }));
    await userEvent.selectOptions(screen.getByLabelText("Talk to"), "f");
    await userEvent.click(screen.getByRole("tab", { name: "Language" }));
    await userEvent.click(screen.getByRole("button", { name: "French" }));
    expect(pill()).toHaveTextContent("Female · French");
    await userEvent.click(screen.getByRole("tab", { name: "Preferences" }));
    await userEvent.type(screen.getByLabelText(/what do you want to talk about/i), "jazz{Enter}");
    expect(pill()).toHaveTextContent("Female · French · jazz");
    await userEvent.type(screen.getByLabelText(/what do you want to talk about/i), "chess{Enter}");
    expect(pill()).toHaveTextContent("Female · French · 2 interests");
  });

  it("resets everything with Reset", { timeout: 20_000 }, async () => {
    const server = await openChat();
    await userEvent.click(pill());
    await userEvent.click(screen.getByRole("tab", { name: "Preferences" }));
    await userEvent.selectOptions(screen.getByLabelText("Talk to"), "m");
    await userEvent.selectOptions(screen.getByLabelText("I am"), "f");
    await userEvent.click(screen.getByRole("tab", { name: "Language" }));
    await userEvent.click(screen.getByRole("button", { name: "German" }));
    await userEvent.click(screen.getByRole("tab", { name: "Country" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "Match filters" })).getByRole("button", {
        name: /Canada/,
      }),
    );
    expect(pill()).toHaveTextContent("Canada");
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await userEvent.click(screen.getByRole("tab", { name: "Preferences" }));
    expect(screen.getByLabelText("Talk to")).toHaveValue("");
    expect(screen.getByLabelText("I am")).toHaveValue("");
    await userEvent.click(screen.getByRole("tab", { name: "Language" }));
    expect(screen.getByRole("button", { name: "Any language" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(pill()).toHaveTextContent("Smart Match");
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(server.of("hello").at(-1)).toEqual({ t: "hello", adult: true, mode: "text", tags: [] });
  });

  it("sends the chosen filters when Start is pressed", async () => {
    const server = await openChat();
    await userEvent.click(pill());
    await userEvent.click(screen.getByRole("tab", { name: "Preferences" }));
    await userEvent.selectOptions(screen.getByLabelText("Talk to"), "f");
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(server.of("hello").at(-1)).toMatchObject({ seek: "f" });
  });
});

describe("the country tab", { timeout: 20_000 }, () => {
  // inside the panel only: the pill outside it also names the chosen countries
  const panel = () => within(screen.getByRole("group", { name: "Match filters" }));
  const countryTile = (name: RegExp) => panel().getByRole("button", { name });

  async function openCountries() {
    const server = await openChat();
    await userEvent.click(pill());
    return server;
  }

  it("starts on Smart Match, with the popular countries first and then all the others A to Z", async () => {
    await openCountries();
    expect(countryTile(/Smart Match/)).toHaveAttribute("aria-pressed", "true");
    const names = panel()
      .getAllByRole("button", { pressed: false })
      .map((b) => b.textContent ?? "")
      .filter((t) => t.length > 2 && !/^(Smart Match|Reset|Close|Select)/.test(t));
    expect(names[0]).toContain("United States");
    expect(names[1]).toContain("United Kingdom");
    expect(names[2]).toContain("Canada");
    expect(names[3]).toContain("Australia");
    expect(screen.getByText(/all countries/i)).toBeInTheDocument();
    const rest = names.slice(4);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(names.length).toBeGreaterThan(200);
  });

  it("picks one country at a time by default, and sends it", async () => {
    const server = await openCountries();
    await userEvent.click(countryTile(/Canada/));
    await userEvent.click(countryTile(/Brazil/));
    expect(countryTile(/Brazil/)).toHaveAttribute("aria-pressed", "true");
    expect(countryTile(/Canada/)).toHaveAttribute("aria-pressed", "false");
    expect(countryTile(/Smart Match/)).toHaveAttribute("aria-pressed", "false");
    expect(pill()).toHaveTextContent("Brazil");
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(server.of("hello").at(-1)).toMatchObject({ countries: ["BR"] });
  });

  it("chooses several when 'Select multiple' is on", async () => {
    const server = await openCountries();
    await userEvent.click(panel().getByRole("switch", { name: "Select multiple" }));
    await userEvent.click(countryTile(/United States/));
    await userEvent.click(countryTile(/Canada/));
    await userEvent.click(countryTile(/Australia/));
    expect(pill()).toHaveTextContent("3 countries");
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(server.of("hello").at(-1)).toMatchObject({ countries: ["US", "CA", "AU"] });
  });

  it("stops at ten", async () => {
    await openCountries();
    await userEvent.click(panel().getByRole("switch", { name: "Select multiple" }));
    for (const n of [
      "Brazil",
      "Canada",
      "France",
      "Germany",
      "India",
      "Italy",
      "Japan",
      "Mexico",
      "Spain",
      "Sweden",
      "Norway",
    ]) {
      await userEvent.click(panel().getByText(n));
    }
    expect(pill()).toHaveTextContent("10 countries");
    expect(panel().getByText("Norway").closest("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("deselects a chosen country by pressing it again, and Smart Match clears them all", async () => {
    await openCountries();
    await userEvent.click(countryTile(/France/));
    await userEvent.click(countryTile(/France/));
    expect(pill()).toHaveTextContent("Smart Match");
    await userEvent.click(countryTile(/Spain/));
    await userEvent.click(countryTile(/Smart Match/));
    expect(pill()).toHaveTextContent("Smart Match");
  });

  it("searches by name", async () => {
    await openCountries();
    await userEvent.type(panel().getByRole("searchbox", { name: "Search countries" }), "ger");
    expect(countryTile(/Germany/)).toBeInTheDocument();
    expect(countryTile(/Nigeria/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /France/ })).not.toBeInTheDocument();
    await userEvent.clear(panel().getByRole("searchbox", { name: "Search countries" }));
    await userEvent.type(panel().getByRole("searchbox", { name: "Search countries" }), "zzzz");
    expect(screen.getByText("No country matches.")).toBeInTheDocument();
  });

  it("explains that a person whose country can't be told is not matched", async () => {
    await openCountries();
    expect(screen.getByText(/can.t be worked out/i)).toBeInTheDocument();
  });

  it("remembers the choice for next time, and ignores junk in storage", async () => {
    await openCountries();
    await userEvent.click(countryTile(/Japan/));
    expect(JSON.parse(localStorage.getItem("pb_countries")!)).toEqual(["JP"]);
  });

  it("names the other person's country in the chat when the server says", async () => {
    const server = await openChat();
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    server.receive({ t: "waiting" });
    server.receive({ t: "matched", common: [], init: true, country: "FR" });
    expect(await screen.findAllByText("France")).toHaveLength(2); // in the chat, and in the box at the top right
  });

  it("says nothing about a country when the server doesn't", async () => {
    const server = await openChat();
    await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
    server.receive({ t: "waiting" });
    server.receive({ t: "matched", common: [], init: true });
    await screen.findByText("✨ You're now chatting with someone new");
    expect(screen.queryByText("France")).not.toBeInTheDocument();
    expect(document.querySelector("[role=log] .fi")).toBeNull();
  });
});
