import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reduceMotion } from "../../test/fake-admin.js";
import { rubberband } from "../motion/spring.js";
import { Sheet } from "./Sheet.js";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "Date",
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const WIDTH = 480; // jsdom has no layout, so the sheet assumes this width

const run = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

const panel = () => screen.getByRole("dialog");
const scrim = () => document.querySelector<HTMLElement>(".adm-scrim")!;
const header = () => document.querySelector<HTMLElement>(".adm-sheet-head")!;
const edge = () => document.querySelector<HTMLElement>(".adm-edge")!;
/** Where the panel is, in pixels from fully open. */
const x = () => Number(/translate3d\((-?[\d.]+)px/.exec(panel().style.transform)?.[1] ?? NaN);

function open(over: { onDismiss?: () => void } = {}) {
  const onDismiss = over.onDismiss ?? vi.fn();
  render(
    <>
      <div className="adm-shell">
        <button>opener</button>
      </div>
      <Sheet title="A report" subtitle="just now" onDismiss={onDismiss}>
        <p>Body text</p>
        <button>Inside</button>
      </Sheet>
    </>,
  );
  return onDismiss;
}

const down = (el: HTMLElement, clientX: number) =>
  fireEvent.pointerDown(el, { pointerId: 1, clientX, button: 0, pointerType: "touch" });
const move = (el: HTMLElement, clientX: number) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX });
const up = (el: HTMLElement, clientX: number) => fireEvent.pointerUp(el, { pointerId: 1, clientX });

describe("opening", () => {
  it("is a labelled, modal dialog with the title and its content", () => {
    open();
    expect(panel()).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog", { name: "A report" })).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
  });

  it("starts off to the right and slides in with its dimming, arriving exactly at rest", async () => {
    open();
    expect(x()).toBe(WIDTH);
    expect(scrim().style.opacity).toBe("0");
    await run(80);
    expect(x()).toBeGreaterThan(0);
    expect(x()).toBeLessThan(WIDTH);
    await run(1500);
    expect(x()).toBe(0);
    expect(scrim().style.opacity).toBe("1");
  });

  it("takes focus, and hides the page behind it from the keyboard and screen readers", () => {
    open();
    expect(panel()).toHaveFocus();
    expect(document.querySelector(".adm-shell")).toHaveAttribute("inert");
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("puts everything back when it closes, and returns focus to what opened it", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const view = render(
      <Sheet title="T" onDismiss={() => undefined}>
        x
      </Sheet>,
    );
    view.unmount();
    expect(opener).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.querySelector(".adm-shell")).toBeNull();
    opener.remove();
  });
});

describe("closing", () => {
  it("slides out the way it came in, and only then says it is done", async () => {
    const done = open();
    await run(1500);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(done).not.toHaveBeenCalled();
    await run(60);
    expect(x()).toBeGreaterThan(0); // on its way, to the right
    expect(done).not.toHaveBeenCalled();
    await run(1500);
    expect(x()).toBe(WIDTH);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape, once, however many times it is pressed", async () => {
    const done = open();
    await run(1500);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    await run(1500);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("closes when the dimmed area is pressed", async () => {
    const done = open();
    await run(1500);
    fireEvent.click(scrim());
    await run(1500);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("dragging", () => {
  it("follows the finger exactly, from wherever it was grabbed, and the dimming follows the panel", async () => {
    open();
    await run(1500);
    down(header(), 300);
    move(header(), 300); // no movement yet: no jump
    expect(x()).toBe(0);
    move(header(), 360);
    expect(x()).toBe(60); // 60 px of finger, 60 px of panel
    expect(scrim().style.opacity).toBeCloseTo(1 - 60 / WIDTH, 5);
    move(header(), 450);
    expect(x()).toBe(150);
    move(header(), 330); // back again: it comes back too
    expect(x()).toBe(30);
  });

  it("can be dragged from the edge as well as the title bar", async () => {
    open();
    await run(1500);
    down(edge(), 10);
    move(edge(), 50);
    expect(x()).toBe(40);
  });

  it("stretches rather than follows when pulled the wrong way", async () => {
    open();
    await run(1500);
    down(header(), 300);
    move(header(), 200); // 100 px the wrong way
    const stretched = -x();
    expect(stretched).toBeGreaterThan(0);
    expect(stretched).toBeLessThan(100);
    expect(stretched).toBeCloseTo(rubberband(100, WIDTH), 5);
    move(header(), -300); // far past: still bounded
    expect(-x()).toBeLessThan(WIDTH);
    expect(-x()).toBeGreaterThan(stretched);
  });

  it("ignores presses on buttons in the title bar, so Close still works", async () => {
    const done = open();
    await run(1500);
    const close = screen.getByRole("button", { name: "Close" });
    down(close, 300);
    move(header(), 400);
    expect(x()).toBe(0);
    expect(done).not.toHaveBeenCalled();
  });

  it("ignores a second finger and unrelated pointer events", async () => {
    open();
    await run(1500);
    down(header(), 300);
    fireEvent.pointerMove(header(), { pointerId: 2, clientX: 500 });
    expect(x()).toBe(0);
    move(header(), 340);
    expect(x()).toBe(40);
  });
});

describe("when the browser refuses to capture the pointer", () => {
  it("still follows the finger and still lets go cleanly", async () => {
    const fail = () => {
      throw new Error("NotFoundError: no active pointer with that id");
    };
    HTMLElement.prototype.setPointerCapture = fail;
    HTMLElement.prototype.releasePointerCapture = fail;
    try {
      const done = open();
      await run(1500);
      down(header(), 300);
      move(header(), 340);
      expect(x()).toBe(40);
      await run(300);
      up(header(), 340);
      await run(2000);
      expect(x()).toBe(0);
      expect(done).not.toHaveBeenCalled();
    } finally {
      // @ts-expect-error put the test browser back as it was (it has neither method)
      delete HTMLElement.prototype.setPointerCapture;
      // @ts-expect-error see above
      delete HTMLElement.prototype.releasePointerCapture;
    }
  });
});

describe("letting go", () => {
  it("settles back open when released short of half way, without a flick", async () => {
    const done = open();
    await run(1500);
    down(header(), 300);
    move(header(), 380);
    await run(300); // finger rests: no speed when it lets go
    up(header(), 380);
    await run(2000);
    expect(x()).toBe(0);
    expect(done).not.toHaveBeenCalled();
  });

  it("goes the rest of the way when released past half way", async () => {
    const done = open();
    await run(1500);
    down(header(), 100);
    move(header(), 380);
    await run(300);
    up(header(), 380);
    await run(2000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("is thrown out by a fast flick even from a short distance: the choice follows where it was heading", async () => {
    const done = open();
    await run(1500);
    down(header(), 100);
    await run(16);
    move(header(), 140);
    await run(16);
    move(header(), 190);
    await run(16);
    move(header(), 250); // about 3000 px/s, and only 150 px from open
    up(header(), 250);
    await run(2000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("is brought back by a flick the other way, even from far out", async () => {
    const done = open();
    await run(1500);
    down(header(), 100);
    move(header(), 400);
    await run(300);
    move(header(), 380);
    await run(16);
    move(header(), 300);
    await run(16);
    move(header(), 200);
    await run(16);
    move(header(), 120); // quickly back towards open
    up(header(), 120);
    await run(2500);
    expect(done).not.toHaveBeenCalled();
    expect(x()).toBe(0);
  });
});

describe("being caught", () => {
  it("can be grabbed while it is leaving, and carries on from where it is, with no jump", async () => {
    const done = open();
    await run(1500);
    fireEvent.keyDown(document, { key: "Escape" });
    await run(100);
    const midway = x();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(WIDTH);

    down(header(), 200); // grab it in flight
    move(header(), 200);
    expect(x()).toBeCloseTo(midway, 0); // exactly where it was, not where it was heading
    move(header(), 150);
    expect(x()).toBeCloseTo(midway - 50, 0);
    move(header(), 20); // pulled well back towards open

    await run(300);
    up(header(), 20);
    await run(2500);
    expect(done).not.toHaveBeenCalled(); // changed its mind: it stays
    expect(x()).toBe(0);
  });

  it("can be dismissed again after being caught", async () => {
    const done = open();
    await run(1500);
    fireEvent.keyDown(document, { key: "Escape" });
    await run(100);
    down(header(), 200);
    move(header(), 150);
    await run(300);
    up(header(), 150);
    await run(2500);
    fireEvent.keyDown(document, { key: "Escape" });
    await run(2500);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("keeping focus inside", () => {
  it("cycles Tab from the last control back to the first, and Shift+Tab the other way", async () => {
    open();
    await run(1500);
    const close = screen.getByRole("button", { name: "Close" });
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();
    fireEvent.keyDown(panel(), { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(panel(), { key: "Tab", shiftKey: true });
    expect(inside).toHaveFocus();
  });
});

describe("with reduced motion", () => {
  it("fades instead of sliding, and cannot be dragged", async () => {
    reduceMotion();
    const done = open();
    expect(document.querySelector(".adm-layer")).toHaveAttribute("data-fade", "in");
    expect(panel().style.transform).toBe("");
    down(header(), 300);
    move(header(), 400);
    expect(panel().style.transform).toBe("");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".adm-layer")).toHaveAttribute("data-fade", "out");
    await run(300);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("content that can close the sheet", () => {
  it("hands a close function to content written as a function", async () => {
    const done = vi.fn();
    render(
      <Sheet title="T" onDismiss={done}>
        {({ close }) => <button onClick={close}>Finish</button>}
      </Sheet>,
    );
    await run(1500);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await run(1500);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
