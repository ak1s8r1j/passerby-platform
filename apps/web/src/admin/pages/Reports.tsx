import { useState } from "react";
import type { AdminReport, AdminReportDetail, AdminReportStatus } from "@passerby/shared";
import { usePageTitle } from "../../hooks/usePageTitle.js";
import { useOverview } from "../AdminContext.js";
import { adminApi } from "../api.js";
import { ago, clock, fullDate, reasonTitle, timeLeft } from "../format.js";
import {
  Empty,
  ErrorNote,
  List,
  Loading,
  PageHeader,
  Pill,
  Row,
  Segmented,
  useNow,
  usePaged,
  useResource,
} from "../ui/bits.js";
import { Icon } from "../ui/Icon.js";
import { Sheet } from "../ui/Sheet.js";
import { useToast } from "../ui/Toast.js";

type Filter = AdminReportStatus | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "banned", label: "Banned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

const BAN_LENGTHS = [
  { value: "24", label: "24 hours" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
  { value: "8760", label: "1 year" },
] as const;
const lengthLabel = (hours: number) =>
  BAN_LENGTHS.find((l) => Number(l.value) === hours)?.label ?? `${hours} hours`;

const STATUS_PILL = {
  open: { tone: "orange", text: "Open" },
  banned: { tone: "red", text: "Banned" },
  dismissed: { tone: "gray", text: "Dismissed" },
} as const;

const who = (tag: string) => (tag === "system" ? "the system" : tag);

export function Reports() {
  usePageTitle("Admin · Reports");
  const overview = useOverview();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = usePaged<AdminReport>(`reports:${filter}`, (cursor) =>
    adminApi.reports(filter, cursor),
  );

  const changed = () => {
    void list.reload();
    void overview.reload();
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Chats that people reported, and conversations saved when someone said they were under 18."
      />
      <div className="adm-toolbar">
        <Segmented<Filter> label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      </div>

      {list.loading ? (
        <Loading />
      ) : list.error && list.items.length === 0 ? (
        <ErrorNote text={list.error} retry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <div className="adm-card">
          <Empty
            icon="check"
            title={filter === "open" ? "All clear" : "Nothing here"}
            text={
              filter === "open" ? "No reports are waiting for you." : "No reports with this status."
            }
          />
        </div>
      ) : (
        <>
          <List label="Reports">
            {list.items.map((r) => {
              const pill = STATUS_PILL[r.status];
              return (
                <Row
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  leading={
                    <span className={`adm-avatar ${pill.tone}`}>
                      <Icon name="reports" size={18} />
                    </span>
                  }
                  title={reasonTitle(r.reason)}
                  subtitle={
                    <>
                      <span>
                        {r.mode === "video" ? "Video" : "Text"} ·{" "}
                        {r.messages === 1 ? "1 message" : `${r.messages} messages`} ·{" "}
                        {ago(r.createdAt, now)}
                      </span>
                      <span>
                        {who(r.reporter)} reported {r.reported}
                      </span>
                    </>
                  }
                  trailing={<Pill tone={pill.tone}>{pill.text}</Pill>}
                  chevron
                />
              );
            })}
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
          {list.error && <ErrorNote text={list.error} />}
        </>
      )}

      {openId && <ReportSheet id={openId} onChanged={changed} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ReportSheet({
  id,
  onChanged,
  onClose,
}: {
  id: string;
  onChanged(): void;
  onClose(): void;
}) {
  const toast = useToast();
  const detail = useResource(`report:${id}`, () => adminApi.report(id));
  const [updated, setUpdated] = useState<AdminReportDetail | null>(null);
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const r = updated ?? detail.data;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      toast({
        text: err instanceof Error ? err.message : "That didn't work. Try again.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={r ? reasonTitle(r.reason) : "Report"}
      subtitle={r ? `${clock(r.createdAt)} · ${ago(r.createdAt, now)}` : undefined}
      onDismiss={onClose}
    >
      {({ close }) => {
        if (detail.loading && !r) return <Loading />;
        if (!r)
          return (
            <ErrorNote
              text={detail.error ?? "Couldn't load this report."}
              retry={() => void detail.reload()}
            />
          );
        const pill = STATUS_PILL[r.status];

        const ban = () =>
          run(async () => {
            const before = r.ban; // a ban already in force, such as the automatic one
            const done = await adminApi.banFromReport(r.id, Number(hours));
            onChanged();
            toast({
              text: `Banned for ${lengthLabel(Number(hours))}.`,
              undo: async () => {
                // Put things back as they were: the earlier ban if there was one, otherwise none.
                if (before) await adminApi.restoreBan(before);
                else if (done.report.ban) await adminApi.liftBan(done.report.ban.id);
                // The ban also closed other open reports about the same person: bring every one back.
                for (const id of new Set([r.id, ...done.settled])) await adminApi.reopen(id);
                onChanged();
              },
            });
            close();
          });
        const dismiss = () =>
          run(async () => {
            await adminApi.dismiss(r.id);
            onChanged();
            toast({
              text: "Report dismissed.",
              undo: async () => {
                await adminApi.reopen(r.id);
                onChanged();
              },
            });
            close();
          });
        const reopen = () =>
          run(async () => {
            setUpdated(await adminApi.reopen(r.id));
            onChanged();
          });
        const lift = () =>
          run(async () => {
            if (!r.ban) return;
            const lifted = await adminApi.liftBan(r.ban.id);
            setUpdated(await adminApi.report(r.id));
            onChanged();
            toast({
              text: "Ban lifted.",
              undo: async () => {
                await adminApi.restoreBan(lifted);
                setUpdated(await adminApi.report(r.id));
                onChanged();
              },
            });
          });

        return (
          <>
            <div className="adm-sheet-section">
              <List>
                <Row title="Status" trailing={<Pill tone={pill.tone}>{pill.text}</Pill>} />
                <Row
                  title="Person reported"
                  trailing={<code className="adm-tag">{r.reported}</code>}
                />
                <Row
                  title="Reported by"
                  trailing={<code className="adm-tag">{who(r.reporter)}</code>}
                />
                <Row
                  title="Kind of chat"
                  trailing={
                    <span className="adm-value">{r.mode === "video" ? "Video" : "Text"}</span>
                  }
                />
                <Row
                  title="When"
                  trailing={<span className="adm-value">{fullDate(r.createdAt)}</span>}
                />
              </List>
            </div>

            <div className="adm-callout" data-tone={r.reportersToday >= 3 ? "red" : undefined}>
              <strong>
                {r.reportersToday === 1
                  ? "1 person has reported them today."
                  : `${r.reportersToday} different people have reported them today.`}
              </strong>
              <span>
                {r.reportsTotal === 1
                  ? "This is the only report about them."
                  : `${r.reportsTotal} reports about them in total.`}{" "}
                Three different people in a day pauses someone automatically.
              </span>
            </div>

            {r.ban && (
              <div className="adm-callout" data-tone="red">
                <strong>
                  Banned until {clock(r.ban.until)} ({timeLeft(r.ban.until, now)})
                </strong>
                <span>
                  <button
                    type="button"
                    className="adm-btn secondary small"
                    disabled={busy}
                    onClick={() => void lift()}
                  >
                    Lift ban
                  </button>
                </span>
              </div>
            )}

            <h3 className="adm-h3">Saved conversation</h3>
            {r.transcript.length === 0 ? (
              <p className="adm-muted">
                No messages were saved: the chat ended before anyone spoke.
              </p>
            ) : (
              <>
                <p className="adm-muted small">
                  Shown exactly as sent. It may be offensive. The right-hand side is the person who
                  reported.
                </p>
                <ol className="adm-chat" aria-label="Saved conversation">
                  {r.transcript.map((line, i) => (
                    <li key={i} className={line.who}>
                      <span className="adm-who-label">
                        {line.who === "reporter" ? "Reporter" : "Reported"}
                      </span>
                      <span className="adm-bubble">{line.x}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <div className="adm-actions">
              {r.status === "open" ? (
                <>
                  <Segmented
                    label="Ban for"
                    value={hours}
                    options={BAN_LENGTHS.map((l) => ({ value: l.value, label: l.label }))}
                    onChange={setHours}
                  />
                  <div className="adm-actions-row">
                    <button
                      type="button"
                      className="adm-btn secondary"
                      disabled={busy}
                      onClick={() => void dismiss()}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="adm-btn danger"
                      disabled={busy}
                      onClick={() => void ban()}
                    >
                      Ban for {lengthLabel(Number(hours))}
                    </button>
                  </div>
                </>
              ) : (
                <div className="adm-actions-row">
                  <button
                    type="button"
                    className="adm-btn secondary"
                    disabled={busy}
                    onClick={() => void reopen()}
                  >
                    Reopen report
                  </button>
                  {!r.ban && r.status === "dismissed" && (
                    <button
                      type="button"
                      className="adm-btn danger"
                      disabled={busy}
                      onClick={() => void ban()}
                    >
                      Ban for {lengthLabel(Number(hours))}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        );
      }}
    </Sheet>
  );
}
