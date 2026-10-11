import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { AdminHour, Page } from "@passerby/shared";
import { hourLabel } from "../format.js";
import { prefersReducedMotion, SNAPPY, Spring } from "../motion/spring.js";
import { Icon, type IconName } from "./Icon.js";

// ---- a number that moves to its new value, and can be redirected while it moves ----

export function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const spring = useRef<Spring | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      spring.current?.stop();
      spring.current = null;
      setShown(value);
      return;
    }
    spring.current ??= new Spring(shown, setShown);
    // A new value mid-count simply changes where it is heading; it carries on from where it is.
    spring.current.to(value, { config: SNAPPY });
    // `shown` is only the starting point of a spring that doesn't exist yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => () => spring.current?.stop(), []);

  return (
    <span className="adm-num" data-value={value}>
      {Math.round(shown).toLocaleString()}
    </span>
  );
}

// ---- a segmented control, like the one in Apple's apps ----

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      className="adm-seg"
      role="group"
      aria-label={label}
      style={{ ["--n" as string]: options.length }}
    >
      <span
        className="adm-seg-thumb"
        aria-hidden="true"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- inset grouped lists: the shape of most screens ----

export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="adm-list" aria-label={label}>
      {children}
    </ul>
  );
}

export function Row({
  title,
  subtitle,
  leading,
  trailing,
  onClick,
  href,
  chevron,
  selected,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: (e: ReactMouseEvent) => void;
  href?: string;
  chevron?: boolean;
  selected?: boolean;
}) {
  const body = (
    <>
      {leading && <span className="adm-row-lead">{leading}</span>}
      <span className="adm-row-main">
        <span className="adm-row-title">{title}</span>
        {subtitle && <span className="adm-row-sub">{subtitle}</span>}
      </span>
      {trailing && <span className="adm-row-trail">{trailing}</span>}
      {chevron && (
        <span className="adm-row-chev">
          <Icon name="chevron" size={16} />
        </span>
      )}
    </>
  );
  return (
    <li className="adm-row" data-selected={selected || undefined}>
      {onClick ? (
        <button type="button" className="adm-row-hit" onClick={onClick}>
          {body}
        </button>
      ) : href ? (
        <a className="adm-row-hit" href={href}>
          {body}
        </a>
      ) : (
        <div className="adm-row-hit static">{body}</div>
      )}
    </li>
  );
}

export function Pill({
  tone = "gray",
  children,
}: {
  tone?: "gray" | "blue" | "green" | "red" | "orange";
  children: ReactNode;
}) {
  return <span className={`adm-pill ${tone}`}>{children}</span>;
}

export function Empty({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  return (
    <div className="adm-empty">
      <span className="adm-empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <p className="adm-loading" role="status">
      <span className="adm-spinner" aria-hidden="true" />
      {text}
    </p>
  );
}

export function ErrorNote({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="adm-error" role="alert">
      <span>{text}</span>
      {retry && (
        <button type="button" className="adm-btn small" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="adm-section">
      {(title || action) && (
        <div className="adm-section-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ---- a chart of the last 24 hours ----

export function BarChart({
  hours,
  metric,
  noun,
}: {
  hours: AdminHour[];
  metric: "chats" | "visitors" | "messages" | "peakOnline";
  /** What one unit is called, for the caption: "chats", "visitors". */
  noun: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...hours.map((h) => h[metric]));
  const total = hours.reduce((n, h) => n + h[metric], 0);
  const show = active ?? hours.length - 1;
  const h = hours[show];
  const caption = h
    ? `${hourLabel(h.hour)} · ${h[metric].toLocaleString()} ${noun}${active === null ? " this hour" : ""}`
    : "";
  return (
    <figure className="adm-chart">
      <div
        className="adm-bars"
        aria-hidden="true"
        onPointerLeave={() => setActive(null)}
        style={{ ["--cols" as string]: hours.length }}
      >
        {hours.map((x, i) => (
          <span
            key={x.hour}
            className="adm-bar-slot"
            data-now={i === hours.length - 1 || undefined}
            data-active={i === show || undefined}
            onPointerEnter={() => setActive(i)}
            onPointerDown={() => setActive(i)}
          >
            <span
              className="adm-bar"
              style={{ height: `${x[metric] === 0 ? 2 : Math.max(4, (x[metric] / max) * 100)}%` }}
            />
          </span>
        ))}
      </div>
      <figcaption>
        <strong>{caption}</strong>
        <span>{total.toLocaleString()} in the last 24 hours</span>
      </figcaption>
      {/* The same numbers as a table, for anyone who can't see the bars. */}
      <table className="sr">
        <caption>{noun} per hour, last 24 hours</caption>
        <tbody>
          {hours.map((x) => (
            <tr key={x.hour}>
              <th scope="row">{hourLabel(x.hour)}</th>
              <td>{x[metric]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ---- loading data that may be reloaded or polled ----

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload(): Promise<void>;
}

/**
 * Loads something when `key` changes, optionally keeps it fresh, and keeps the last good answer on screen
 * while reloading, so lists don't flash empty. Only the newest request counts.
 */
export function useResource<T>(
  key: string,
  load: () => Promise<T>,
  options: { pollMs?: number } = {},
): Resource<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  const seq = useRef(0);

  /** Anything still on its way no longer matters. */
  const discard = useCallback(() => {
    seq.current++;
  }, []);

  const run = useCallback(async (quiet: boolean) => {
    const mine = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader.current();
      if (mine === seq.current) setState({ data, error: null, loading: false });
    } catch (err) {
      if (mine === seq.current) {
        setState((s) => ({
          data: quiet ? s.data : null,
          error: err instanceof Error ? err.message : "Something went wrong.",
          loading: false,
        }));
      }
    }
  }, []);

  const { pollMs } = options;
  useEffect(() => {
    void run(false);
    if (!pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void run(true);
    }, pollMs);
    return () => {
      clearInterval(id);
      discard();
    };
  }, [key, pollMs, run, discard]);

  return { ...state, reload: () => run(true) };
}

export interface Paged<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  more(): Promise<void>;
  reload(): Promise<void>;
}

/** A list that loads page by page. Changing `key` starts again from the first page. */
export function usePaged<T>(
  key: string,
  fetchPage: (cursor?: string) => Promise<Page<T>>,
): Paged<T> {
  const [state, setState] = useState<{
    items: T[];
    next: string | null;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
  }>({ items: [], next: null, loading: true, loadingMore: false, error: null });
  const fetcher = useRef(fetchPage);
  useEffect(() => {
    fetcher.current = fetchPage;
  });
  const seq = useRef(0);
  const discard = useCallback(() => {
    seq.current++;
  }, []);

  const first = useCallback(async (quiet: boolean) => {
    const mine = ++seq.current;
    if (!quiet) setState({ items: [], next: null, loading: true, loadingMore: false, error: null });
    try {
      const page = await fetcher.current();
      if (mine === seq.current) {
        setState({
          items: page.items,
          next: page.next,
          loading: false,
          loadingMore: false,
          error: null,
        });
      }
    } catch (err) {
      if (mine === seq.current) {
        setState((s) => ({
          ...s,
          loading: false,
          items: quiet ? s.items : [],
          error: err instanceof Error ? err.message : "Something went wrong.",
        }));
      }
    }
  }, []);

  useEffect(() => {
    void first(false);
    return discard;
  }, [key, first, discard]);

  const more = useCallback(async () => {
    const cursor = state.next;
    if (!cursor || state.loadingMore) return;
    const mine = seq.current;
    setState((s) => ({ ...s, loadingMore: true, error: null }));
    try {
      const page = await fetcher.current(cursor);
      if (mine === seq.current) {
        setState((s) => ({
          ...s,
          items: [...s.items, ...page.items],
          next: page.next,
          loadingMore: false,
        }));
      }
    } catch (err) {
      if (mine === seq.current) {
        setState((s) => ({
          ...s,
          loadingMore: false,
          error: err instanceof Error ? err.message : "Something went wrong.",
        }));
      }
    }
  }, [state.next, state.loadingMore]);

  return {
    items: state.items,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    hasMore: state.next !== null,
    more,
    reload: () => first(true),
  };
}

/** The current time, refreshed now and then, so "4 min ago" stays true while a page stays open. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** A value that follows another, but only once it has stopped changing for a moment (search boxes). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}

/** The big title at the top of a page, the way Apple's apps do it, with an optional line under it. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="adm-head">
      <div>
        <h1 className="adm-title">{title}</h1>
        {subtitle && <p className="adm-sub">{subtitle}</p>}
      </div>
      {actions && <div className="adm-head-actions">{actions}</div>}
    </div>
  );
}
