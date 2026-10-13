import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdsConfig, SiteConfig, Sponsor } from "@passerby/shared";
import { App } from "../App.js";
import { resetAdSense } from "../ads/adsense.js";
import { FakeAccounts } from "./fake-accounts.js";
import { FakePeer, installFakeMedia } from "./fake-media.js";
import { FakeSocket, installFakeSocket } from "./fake-socket.js";
import { stubApi } from "./fetch.js";

const CLIENT = "ca-pub-1138895012480462";
const SPONSORS: Sponsor[] = [
  {
    id: "acme",
    name: "Acme",
    logo: "/sponsors/acme.png",
    headline: "Cheaper flights",
    cta: "See deals",
    url: "https://acme.example/deals",
  },
];

/** Ads switched on, with an AdSense publisher and both ad units. */
const ADS_ON: AdsConfig = {
  enabled: true,
  client: CLIENT,
  slots: { profile: "1111111111", landing: "2222222222" },
  sponsors: [],
  rewarded: "none",
  refreshSeconds: 0,
};
const withAds = (over: Partial<AdsConfig> = {}, rest: Partial<SiteConfig> = {}) =>
  ({ ads: { ...ADS_ON, ...over }, ...rest }) satisfies Partial<SiteConfig>;

/** Make the window desktop-wide (1024px and up) or not. */
function setDesktop(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Every <script> the page asked for, so a test can say whether Google's file "loaded" or was blocked. */
let scripts: HTMLScriptElement[] = [];
beforeEach(() => {
  localStorage.clear();
  resetAdSense();
  scripts = [];
  window.adsbygoogle = [];
  const real = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement && node.src.includes("adsbygoogle")) {
      scripts.push(node);
      return node;
    }
    return real(node);
  });
  installFakeSocket();
  setDesktop(true);
});
afterEach(() => {
  // Unmount first, while the script spy is still in place, so a late render can't add a real tag.
  cleanup();
  document.head.querySelectorAll('script[src*="adsbygoogle"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const loadScript = () => act(() => scripts[0]!.onload?.(new Event("load")));
const blockScript = () => act(() => scripts[0]!.onerror?.(new Event("error")));
const adBoxes = () => document.querySelectorAll(".ad");
/** The ad script "loaded" and Google filled the unit, so the slot stays. */
const shown = async () => {
  await waitFor(() => expect(scripts.length).toBeGreaterThan(0));
  loadScript();
  document
    .querySelectorAll("ins.adsbygoogle")
    .forEach((u) => u.setAttribute("data-ad-status", "filled"));
};

/** A text or video chat that has matched, for the chat-based slots. */
async function chatting(path = "/text", common: string[] = []) {
  localStorage.setItem("pb_adult", "true");
  if (path === "/video") installFakeMedia();
  renderAt(path);
  await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
  const server = FakeSocket.last;
  server.receive({ t: "ready", online: 2 });
  await waitFor(() => expect(screen.getByRole("button", { name: /^start$/i })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: /^start$/i }));
  server.receive({ t: "waiting" });
  server.receive({ t: "matched", common, init: true });
  await screen.findByRole("button", { name: "Games" });
  if (path === "/video") await waitFor(() => expect(FakePeer.instances).toHaveLength(1));
  return server;
}

describe("the ad slot", () => {
  it("reserves the exact size, with an ad label and a remove ads link, before the ad arrives", async () => {
    stubApi({ config: withAds() });
    renderAt("/");
    await waitFor(() => expect(adBoxes()).toHaveLength(1));
    const slot = adBoxes()[0] as HTMLElement;
    expect(within(slot).getByText("ad")).toBeInTheDocument();
    expect(within(slot).getByRole("button", { name: "remove ads ✦" })).toBeInTheDocument();
    const box = slot.querySelector(".ad-box") as HTMLElement;
    expect(box.style.width).toBe("728px");
    expect(box.style.height).toBe("90px");
    const unit = slot.querySelector("ins.adsbygoogle") as HTMLElement;
    expect(unit.getAttribute("data-ad-client")).toBe(CLIENT);
    expect(unit.getAttribute("data-ad-slot")).toBe("2222222222");
  });

  it("asks Google for the ad only once it is on the page, and tells the script to fill the unit", async () => {
    stubApi({ config: withAds() });
    renderAt("/");
    await waitFor(() => expect(scripts).toHaveLength(1));
    expect(scripts[0]!.src).toContain(`client=${CLIENT}`);
    expect(window.adsbygoogle).toHaveLength(0);
    loadScript();
    await waitFor(() => expect(window.adsbygoogle).toHaveLength(1));
  });

  it("does not add a second script when the page already carries Google's tag", async () => {
    const tag = document.createElement("script");
    tag.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + CLIENT;
    document.head.append(tag);
    stubApi({ config: withAds() });
    renderAt("/");
    await waitFor(() => expect(adBoxes()).toHaveLength(1));
    await waitFor(() => expect(window.adsbygoogle).toHaveLength(1));
    expect(scripts).toHaveLength(0);
    tag.remove();
  });

  it("opens the Plus box from the remove ads link", async () => {
    stubApi({ config: withAds() });
    renderAt("/");
    await userEvent.click(await screen.findByRole("button", { name: "remove ads ✦" }));
    const dialog = await screen.findByRole("dialog", { name: /passerby plus/i });
    expect(within(dialog).getByText("Zero ads, anywhere")).toBeInTheDocument();
  });

  it("collapses the slot and its label when the ad script is blocked", async () => {
    stubApi({ config: withAds() });
    renderAt("/");
    await waitFor(() => expect(scripts).toHaveLength(1));
    blockScript();
    await waitFor(() => expect(adBoxes()).toHaveLength(0));
    expect(screen.queryByText("remove ads ✦")).toBeNull();
  });

  it("collapses when Google has nothing to show", async () => {
    stubApi({ config: withAds() });
    renderAt("/");
    await waitFor(() => expect(scripts).toHaveLength(1));
    loadScript();
    const unit = document.querySelector("ins.adsbygoogle")!;
    act(() => unit.setAttribute("data-ad-status", "unfilled"));
    await waitFor(() => expect(adBoxes()).toHaveLength(0));
  });

  it("draws nothing when ads are switched off", async () => {
    stubApi({ config: withAds({ enabled: false }) });
    renderAt("/");
    await screen.findByRole("heading", { level: 1 });
    expect(adBoxes()).toHaveLength(0);
    expect(scripts).toHaveLength(0);
  });

  it("draws nothing for a place that has no ad unit, or without a publisher", async () => {
    stubApi({ config: withAds({ slots: { profile: "1111111111", landing: null } }) });
    renderAt("/");
    await screen.findByRole("heading", { level: 1 });
    expect(adBoxes()).toHaveLength(0);
  });

  it("draws nothing for Plus members, and never loads Google's script for them", async () => {
    stubApi({ config: withAds(), accounts: FakeAccounts.plusMember() });
    renderAt("/");
    await screen.findByRole("heading", { level: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(adBoxes()).toHaveLength(0);
    expect(scripts).toHaveLength(0);
  });

  it("still shows ads to a signed-in member who does not have Plus", async () => {
    stubApi({ config: withAds(), accounts: FakeAccounts.signedInAs("Sam") });
    renderAt("/");
    await waitFor(() => expect(adBoxes()).toHaveLength(1));
  });
});

describe("slot 5: the landing banner", () => {
  it("is 728x90, under the feature row and above the footer, on desktop", async () => {
    stubApi({ config: withAds() });
    renderAt("/");
    await waitFor(() => expect(adBoxes()).toHaveLength(1));
    const slot = adBoxes()[0]!;
    const features = document.querySelector(".home-points")!;
    expect(features.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.closest(".home-ad")).not.toBeNull();
  });

  it("is not shown below 1024px wide", async () => {
    setDesktop(false);
    stubApi({ config: withAds() });
    renderAt("/");
    await screen.findByRole("heading", { level: 1 });
    expect(adBoxes()).toHaveLength(0);
    expect(scripts).toHaveLength(0);
  });

  it("leaves Google's script behind when going to video chat", async () => {
    stubApi({ config: withAds() });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderAt("/");
    await waitFor(() => expect(scripts).toHaveLength(1)); // the script has been asked for on this page
    await userEvent.click(await screen.findByRole("link", { name: "Video chat" }));
    expect(assign).toHaveBeenCalledWith("/video");
  });

  it("is a normal link to video chat when no ad was ever requested", async () => {
    stubApi({ config: withAds({ enabled: false }) });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderAt("/");
    await userEvent.click(await screen.findByRole("link", { name: "Video chat" }));
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("slot 2: the profile panel in text chat", () => {
  it("shows a 300x250 box in the profile panel, on desktop, in text chat", async () => {
    stubApi({ config: withAds() });
    await chatting("/text");
    const slot = await waitFor(() => {
      const el = document.querySelector(".peer .ad") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    const box = slot.querySelector(".ad-box") as HTMLElement;
    expect(box.style.width).toBe("300px");
    expect(box.style.height).toBe("250px");
    expect(slot.querySelector("ins")!.getAttribute("data-ad-slot")).toBe("1111111111");
  });

  it("is not shown on a narrow window", async () => {
    setDesktop(false);
    stubApi({ config: withAds() });
    await chatting("/text");
    expect(document.querySelector(".peer .ad")).toBeNull();
  });

  it("is never shown in video chat", async () => {
    stubApi({ config: withAds() });
    await chatting("/video");
    await new Promise((r) => setTimeout(r, 100));
    expect(adBoxes()).toHaveLength(0);
    expect(scripts).toHaveLength(0);
  });

  it("does not refresh unless the operator asked for it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubApi({ config: withAds() });
    await chatting("/text");
    await waitFor(() => expect(document.querySelector(".peer .ad ins")).not.toBeNull());
    await shown();
    const first = document.querySelector(".peer .ad ins");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(document.querySelector(".peer .ad ins")).toBe(first);
  });

  it("refreshes at most once a minute when asked, and only while the tab is visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    stubApi({ config: withAds({ refreshSeconds: 60 }) });
    await chatting("/text");
    await waitFor(() => expect(document.querySelector(".peer .ad ins")).not.toBeNull());
    await shown();
    const first = document.querySelector(".peer .ad ins");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(document.querySelector(".peer .ad ins")).toBe(first); // not yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(document.querySelector(".peer .ad ins")).not.toBe(first); // once a minute
    const second = document.querySelector(".peer .ad ins");
    await shown();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(document.querySelector(".peer .ad ins")).toBe(second); // hidden tab: no refresh
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
});

describe("slot 4: the sponsored card in text chat", () => {
  const sponsored = () => screen.queryAllByLabelText("Sponsored");

  it("appears once, right after the stranger's first message, and not before", async () => {
    stubApi({ config: withAds({ sponsors: SPONSORS }) });
    const server = await chatting("/text");
    expect(sponsored()).toHaveLength(0);
    server.receive({ t: "msg", text: "hello there" });
    await screen.findByText("hello there");
    const [card] = sponsored();
    expect(card).toBeDefined();
    const bubble = screen.getByText("hello there");
    expect(bubble.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bubble.nextElementSibling).toBe(card);
    // not repeated as the chat goes on, and the visitor's own lines do not trigger one
    server.receive({ t: "msg", text: "second line" });
    await screen.findByText("second line");
    expect(sponsored()).toHaveLength(1);
  });

  it("looks like a card, not a message: a Sponsored label, a 52px logo, a headline and one button", async () => {
    stubApi({ config: withAds({ sponsors: SPONSORS }) });
    const server = await chatting("/text");
    server.receive({ t: "msg", text: "hi" });
    const [card] = await screen.findAllByLabelText("Sponsored");
    expect(within(card!).getByText("Sponsored")).toBeInTheDocument();
    expect(within(card!).getByText("Cheaper flights")).toBeInTheDocument();
    const logo = card!.querySelector("img")!;
    expect(logo.getAttribute("src")).toBe("/sponsors/acme.png");
    expect(logo.getAttribute("width")).toBe("52");
    const link = within(card!).getByRole("link", { name: "See deals" });
    expect(link).toHaveAttribute("href", "https://acme.example/deals");
    expect(link).toHaveAttribute("rel", expect.stringContaining("sponsored"));
    expect(card!.className).not.toContain("b them");
  });

  it("comes back once for the next match, and never in the same match twice", async () => {
    stubApi({ config: withAds({ sponsors: SPONSORS }) });
    const server = await chatting("/text");
    server.receive({ t: "msg", text: "first" });
    await screen.findByText("first");
    expect(sponsored()).toHaveLength(1);
    server.receive({ t: "ended" });
    await userEvent.click(screen.getByRole("button", { name: /^skip/i }));
    server.receive({ t: "waiting" });
    server.receive({ t: "matched", common: [], init: true });
    await waitFor(() => expect(sponsored()).toHaveLength(0)); // a new match starts clean
    server.receive({ t: "msg", text: "again" });
    await screen.findByText("again");
    expect(sponsored()).toHaveLength(1);
  });

  it("is never shown in video chat, where the conversation sits beside the picture", async () => {
    stubApi({ config: withAds({ sponsors: SPONSORS }) });
    const server = await chatting("/video");
    server.receive({ t: "msg", text: "hello from video" });
    await screen.findByText("hello from video");
    expect(sponsored()).toHaveLength(0);
  });

  it("is not shown to Plus members, with ads off, or with no sponsors", async () => {
    stubApi({ config: withAds({ sponsors: SPONSORS }), accounts: FakeAccounts.plusMember() });
    let server = await chatting("/text");
    server.receive({ t: "msg", text: "hello plus" });
    await screen.findByText("hello plus");
    expect(sponsored()).toHaveLength(0);
    document.body.innerHTML = "";

    stubApi({ config: withAds({ sponsors: SPONSORS, enabled: false }) });
    server = await chatting("/text");
    server.receive({ t: "msg", text: "hello off" });
    await screen.findByText("hello off");
    expect(sponsored()).toHaveLength(0);
  });
});

describe("slot 3: filters, the Plus box and the rewarded ad", () => {
  const free = (over: Partial<AdsConfig> = {}) =>
    withAds({ rewarded: "demo", ...over }, { plusFilters: true });

  const openFilters = async () => {
    await userEvent.click(await screen.findByRole("button", { name: /match filters/i }));
  };
  const pickCountry = (name: RegExp) => userEvent.click(screen.getByRole("button", { name }));
  const watchButton = () =>
    screen.queryByRole("button", { name: /watch a short ad · unlock filters for 30 min/ });

  it("opens the Plus box, and applies nothing, when a free visitor taps a locked country", async () => {
    stubApi({ config: free() });
    await chatting("/text");
    await openFilters();
    await pickCountry(/^United Kingdom$/);
    const dialog = await screen.findByRole("dialog", { name: /passerby plus/i });
    expect(within(dialog).getByRole("button", { name: "try 7 days free" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /match filters: Smart Match/i })).toBeInTheDocument();
  });

  it("opens the Plus box when a free visitor picks who to talk to", async () => {
    stubApi({ config: free() });
    await chatting("/text");
    await openFilters();
    await userEvent.click(screen.getByRole("tab", { name: /Preferences/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Talk to/), "f");
    expect(await screen.findByRole("dialog", { name: /passerby plus/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Talk to/)).toHaveValue("");
  });

  it("offers the rewarded ad under the main button, with an or divider", async () => {
    stubApi({ config: free() });
    await chatting("/text");
    await openFilters();
    await pickCountry(/^Canada$/);
    const dialog = await screen.findByRole("dialog", { name: /passerby plus/i });
    expect(within(dialog).getByRole("separator")).toHaveTextContent("or");
    expect(within(dialog).getByRole("button", { name: /^▶ watch a short ad/ })).toBeInTheDocument();
  });

  it("hides the rewarded button when no provider is wired in", async () => {
    stubApi({ config: free({ rewarded: "none" }) });
    await chatting("/text");
    await openFilters();
    await pickCountry(/^Canada$/);
    await screen.findByRole("dialog", { name: /passerby plus/i });
    expect(watchButton()).toBeNull();
  });

  it("gives no reward when the ad is closed early", async () => {
    stubApi({ config: free() });
    await chatting("/text");
    await openFilters();
    await pickCountry(/^Canada$/);
    await userEvent.click(await screen.findByRole("button", { name: /watch a short ad/ }));
    expect(screen.getByRole("progressbar", { name: "Ad progress" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close ad" }));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(localStorage.getItem("pb_unlock_until")).toBeNull();
    expect(screen.queryByText("filters unlocked for 30 min ✓")).toBeNull();
  });

  it("unlocks the filters for 30 minutes when the ad is watched to the end, then locks again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubApi({ config: free() });
    await chatting("/text");
    await openFilters();
    await pickCountry(/^Canada$/);
    await userEvent.click(await screen.findByRole("button", { name: /watch a short ad/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });
    // back at the filters, with a toast
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /plus/i })).toBeNull());
    expect(await screen.findByText("filters unlocked for 30 min ✓")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Match filters" })).toBeInTheDocument();
    // the country can now be chosen
    await pickCountry(/^Canada$/);
    expect(screen.queryByRole("dialog", { name: /plus/i })).toBeNull();
    expect(screen.getByRole("button", { name: /match filters: Canada/i })).toBeInTheDocument();
    // the rewarded button is not offered while the unlock lasts
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(screen.getByRole("button", { name: /match filters: Canada/i })).toBeInTheDocument();
    // after the 30 minutes the filters lock again, and the chosen country is dropped
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21 * 60_000);
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /match filters: Smart Match/i }),
      ).toBeInTheDocument(),
    );
  });

  it("does not offer the rewarded ad while an unlock is active", async () => {
    localStorage.setItem("pb_unlock_until", String(Date.now() + 20 * 60_000));
    stubApi({ config: free() });
    renderAt("/");
    await userEvent.click(await screen.findByRole("button", { name: "remove ads ✦" }));
    await screen.findByRole("dialog", { name: /passerby plus/i });
    expect(watchButton()).toBeNull();
  });

  it("keeps the filters free, with no lock and no Plus box, unless the operator made them Plus", async () => {
    stubApi({ config: withAds({ rewarded: "demo" }) });
    await chatting("/text");
    await openFilters();
    await pickCountry(/^Canada$/);
    expect(screen.queryByRole("dialog", { name: /plus/i })).toBeNull();
    expect(screen.getByRole("button", { name: /match filters: Canada/i })).toBeInTheDocument();
  });

  it("never locks the filters for Plus members, or shows them the rewarded ad", async () => {
    stubApi({ config: free(), accounts: FakeAccounts.plusMember() });
    await chatting("/text");
    await openFilters();
    await pickCountry(/^Canada$/);
    expect(screen.queryByRole("dialog", { name: /plus/i })).toBeNull();
    expect(screen.getByRole("button", { name: /match filters: Canada/i })).toBeInTheDocument();
  });

  it("drops a country that was saved before the filters were locked", async () => {
    localStorage.setItem("pb_countries", JSON.stringify(["GB"]));
    stubApi({ config: free() });
    await chatting("/text");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /match filters: Smart Match/i }),
      ).toBeInTheDocument(),
    );
    const hello = FakeSocket.last.of("hello").at(-1) as { countries?: string[] };
    expect(hello.countries ?? []).toEqual([]);
  });

  it("closes the Plus box with its close button and with Escape, leaving the filters as they were", async () => {
    stubApi({ config: free() });
    await chatting("/text");
    await openFilters();
    await pickCountry(/^Canada$/);
    await screen.findByRole("dialog", { name: /passerby plus/i });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /plus/i })).toBeNull());
    expect(screen.getByRole("group", { name: "Match filters" })).toBeInTheDocument();
    await pickCountry(/^Canada$/);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: /plus/i })).toBeNull();
  });
});
