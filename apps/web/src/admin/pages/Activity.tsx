import { useState } from "react";
import type { AdminEvent } from "@passerby/shared";
import { usePageTitle } from "../../hooks/usePageTitle.js";
import { adminApi, type EventKind } from "../api.js";
import { ago, eventLabel, fullDate } from "../format.js";
import {
  Empty,
  ErrorNote,
  List,
  Loading,
  PageHeader,
  Row,
  Segmented,
  useDebounced,
  useNow,
  usePaged,
} from "../ui/bits.js";
import { Icon } from "../ui/Icon.js";

type Kind = EventKind | "all";
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "user", label: "Visitors" },
  { value: "admin", label: "Admin" },
  { value: "system", label: "System" },
];

const dot = (e: AdminEvent) =>
  e.kind === "system" && (e.type === "error" || e.type === "warning")
    ? "red"
    : e.type.endsWith("failed") || e.type === "login_blocked"
      ? "orange"
      : e.kind === "admin"
        ? "blue"
        : "gray";

export function Activity() {
  usePageTitle("Admin · Activity");
  const now = useNow();
  const [kind, setKind] = useState<Kind>("all");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const filter = { kind: kind === "all" ? undefined : kind, q: q || undefined };
  const list = usePaged<AdminEvent>(`events:${kind}:${q}`, (cursor) =>
    adminApi.events(filter, cursor),
  );

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Sign-ups, sign-ins, reports, bans and what the server did. It never holds emails, passwords or what people said."
        actions={
          <>
            <button
              type="button"
              className="adm-btn secondary small"
              onClick={() => void list.reload()}
            >
              <Icon name="refresh" size={16} />
              Refresh
            </button>
            <a className="adm-btn secondary small" href={adminApi.eventsCsvUrl(filter)} download>
              <Icon name="download" size={16} />
              Download CSV
            </a>
          </>
        }
      />
      <div className="adm-toolbar">
        <Segmented<Kind> label="Show" value={kind} options={KINDS} onChange={setKind} />
        <label className="adm-search">
          <Icon name="search" size={18} />
          <span className="sr">Search the activity log</span>
          <input
            type="search"
            placeholder="Search type, detail or visitor tag"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      {list.loading ? (
        <Loading />
      ) : list.error && list.items.length === 0 ? (
        <ErrorNote text={list.error} retry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <div className="adm-card">
          <Empty
            icon="activity"
            title="Nothing found"
            text={
              q || kind !== "all"
                ? "Try a different filter or search."
                : "Events appear here as they happen."
            }
          />
        </div>
      ) : (
        <>
          <List label="Activity">
            {list.items.map((e) => (
              <Row
                key={e.id}
                leading={<span className={`adm-dot ${dot(e)}`} aria-hidden="true" />}
                title={eventLabel(e.type)}
                subtitle={e.detail || undefined}
                trailing={
                  <>
                    {e.visitor && <code className="adm-tag">{e.visitor}</code>}
                    <time dateTime={e.at} title={fullDate(e.at)} className="adm-time">
                      {ago(e.at, now)}
                    </time>
                  </>
                }
              />
            ))}
          </List>
          {list.hasMore && (
            <div className="adm-more">
              <button
                type="button"
                className="adm-btn secondary"
                disabled={list.loadingMore}
                onClick={() => void list.more()}
              >
                {list.loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
