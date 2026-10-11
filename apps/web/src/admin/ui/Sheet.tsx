import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  FLICK,
  prefersReducedMotion,
  project,
  releaseVelocity,
  rubberband,
  SMOOTH,
  SNAPPY,
  Spring,
} from "../motion/spring.js";
import { Icon } from "./Icon.js";

/** Reduced motion: how long the plain fade takes. */
export const FADE_MS = 140;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A panel that slides in from the right, for looking at one thing without leaving the list behind it.
 *
 * It is made to be handled, not just watched:
 *  - it follows a drag 1:1 from wherever it was grabbed, and resists (rubber-bands) if pulled the wrong way;
 *  - letting go sends it where the flick was heading, not just where the finger stopped, and carries on at
 *    the speed of the finger, so there is no seam between dragging and moving by itself;
 *  - it can be caught again at any moment, even half way out, and follows the finger from where it is;
 *  - it leaves by the path it arrived on, and the dimming behind it follows it in both directions.
 * With "reduce motion" on, none of this moves: it simply fades.
 */
export function Sheet({
  title,
  subtitle,
  onDismiss,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  /** Called once the sheet has finished leaving. The owner of the sheet then stops rendering it. */
  onDismiss(): void;
  /** What to show. A function receives `close`, so an action inside the sheet can send it away when done. */
  children: ReactNode | ((api: { close(): void }) => ReactNode);
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const spring = useRef<Spring | null>(null);
  const width = useRef(480);
  const closing = useRef(false);
  const reduced = useRef(prefersReducedMotion());
  const opener = useRef<Element | null>(null);
  const [fade, setFade] = useState<"in" | "out" | null>(reduced.current ? "in" : null);
  const latest = useRef(onDismiss);
  useEffect(() => {
    latest.current = onDismiss;
  });

  const paint = useCallback((x: number) => {
    const w = width.current;
    if (panel.current) panel.current.style.transform = `translate3d(${x}px, 0, 0)`;
    // The dimming is tied to how far open the panel is, so it follows a drag instead of lagging behind.
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, Math.min(1, 1 - x / w)));
  }, []);

  // Slide in from the right.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    if (reduced.current) return;
    const w = panel.current?.offsetWidth || 480;
    width.current = w;
    const s = new Spring(w, paint);
    spring.current = s;
    paint(w);
    s.to(0, { config: SMOOTH });
    return () => s.stop();
  }, [paint]);

  // Keep the page behind from scrolling or being reached by keyboard while the sheet is open.
  useEffect(() => {
    const shell = document.querySelector(".adm-shell");
    shell?.setAttribute("inert", "");
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    html.setAttribute("data-adm-sheet", ""); // toasts move aside while a sheet is open
    panel.current?.focus({ preventScroll: true });
    const back = opener.current;
    return () => {
      shell?.removeAttribute("inert");
      html.style.overflow = before;
      html.removeAttribute("data-adm-sheet");
      if (back instanceof HTMLElement && document.contains(back))
        back.focus({ preventScroll: true });
    };
  }, []);

  /** Leave: on the way it came, carrying on at `velocity` (pixels per second) if it was flicked. */
  const dismiss = useCallback((velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    const s = spring.current;
    if (reduced.current || !s) {
      setFade("out");
      setTimeout(() => latest.current(), FADE_MS);
      return;
    }
    s.to(width.current, { config: SNAPPY, velocity, onDone: () => latest.current() });
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismiss]);

  // ---- dragging ----
  const drag = useRef<{ id: number; grab: number; samples: { x: number; t: number }[] } | null>(
    null,
  );

  const down = (e: PointerEvent<HTMLElement>) => {
    const s = spring.current;
    if (!s || reduced.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    s.stop(); // catch it wherever it is, even half way out
    closing.current = false;
    drag.current = {
      id: e.pointerId,
      grab: e.clientX - s.value, // remember where it was grabbed, so it doesn't jump to the finger
      samples: [{ x: e.clientX, t: performance.now() }],
    };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // the pointer is already gone; dragging still works while it stays over the sheet
    }
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const s = spring.current;
    if (!d || !s || d.id !== e.pointerId) return;
    const raw = e.clientX - d.grab;
    // Pulling it open further than open is stretched, not followed.
    s.set(raw >= 0 ? raw : -rubberband(-raw, width.current));
    d.samples.push({ x: e.clientX, t: performance.now() });
    if (d.samples.length > 8) d.samples.shift();
  };

  const up = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const s = spring.current;
    if (!d || !s || d.id !== e.pointerId) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // nothing was captured
    }
    const v = releaseVelocity(d.samples, performance.now());
    const here = s.value;
    // Choose where to go from where the flick was heading, not from where the finger stopped.
    const heading = here + project(v);
    if (heading > width.current * 0.5 || (v > 700 && here > 24)) {
      dismiss(v);
    } else {
      // Back open. A little bounce only if it was let go with some speed.
      s.to(0, { config: Math.abs(v) > 300 ? FLICK : SMOOTH, velocity: v });
    }
  };

  const handlers = {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: up,
  };

  // Keep Tab inside the sheet.
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="adm adm-layer" data-fade={fade ?? undefined}>
      <div ref={scrim} className="adm-scrim" aria-hidden="true" onClick={() => dismiss()} />
      <div
        ref={panel}
        className="adm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trap}
      >
        <div className="adm-edge" aria-hidden="true" {...handlers}>
          <span className="adm-grabber" />
        </div>
        <header className="adm-sheet-head" {...handlers}>
          <div className="adm-sheet-title">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="adm-icon-btn"
            aria-label="Close"
            onClick={() => dismiss()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="adm-sheet-body">
          {typeof children === "function" ? children({ close: () => dismiss() }) : children}
        </div>
        {footer && <footer className="adm-sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
