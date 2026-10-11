import { useState } from "react";
import { Link } from "react-router-dom";
import { useOverview } from "../AdminContext.js";
import { ago, reasonTitle } from "../format.js";
import { usePageTitle } from "../../hooks/usePageTitle.js";
import {
  AnimatedNumber,
  BarChart,
  Empty,
  ErrorNote,
  List,
  Loading,
  PageHeader,
  Pill,
  Row,
  Section,
  Segmented,
  useNow,
} from "../ui/bits.js";
import { Icon } from "../ui/Icon.js";

type Metric = "chats" | "visitors" | "messages";
const METRICS: { value: Metric; label: string; noun: string }[] = [
  { value: "chats", label: "Chats", noun: "chats" },
  { value: "visitors", label: "Visitors", noun: "visitors" },
  { value: "messages", label: "Messages", noun: "messages" },
];

function Tile({
  label,
  value,
  hint,
  to,
  tone,
  big,
}: {
  label: string;
  value: number;
  hint?: string;
  to?: string;
  tone?: "orange" | "green";
  big?: boolean;
}) {
  const body = (
    <>
      <span className="adm-tile-label">{label}</span>
      <AnimatedNumber value={value} />
      {hint && <span className="adm-tile-hint">{hint}</span>}
    </>
  );
  const cls = `adm-tile${big ? " big" : ""}${tone ? ` ${tone}` : ""}`;
  return to ? (
    <Link to={to} className={`${cls} link`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Overview() {
  usePageTitle("Admin · Overview");
  const { data, error, loading, reload } = useOverview();
  const [metric, setMetric] = useState<Metric>("chats");
  const now = useNow();

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Overview" />
        <Loading />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Overview" />
        <ErrorNote text={error ?? "Couldn't load the overview."} retry={() => void reload()} />
      </>
    );
  }

  const { live, day, totals, hours, recentReports } = data;
  const noun = METRICS.find((m) => m.value === metric)!.noun;

  return (
    <>
      <PageHeader title="Overview" subtitle="What's happening on the site right now." />
      {error && (
        <ErrorNote text="Updates paused: can't reach the server." retry={() => void reload()} />
      )}

      <div className="adm-tiles" aria-label="Right now">
        <Tile
          big
          label="Online now"
          value={live.online}
          hint={`${live.text} text · ${live.video} video`}
        />
        <Tile
          label="In conversation"
          value={Math.floor(live.chatting / 2)}
          hint="chats under way"
        />
        <Tile label="Searching" value={live.searching} hint="waiting for a match" />
        <Tile
          label="Open reports"
          value={totals.openReports}
          hint={totals.openReports ? "need a look" : "all clear"}
          tone={totals.openReports ? "orange" : "green"}
          to="/admin/reports"
        />
      </div>

      <Section title="Last 24 hours">
        <div className="adm-tiles small" aria-label="Last 24 hours">
          <Tile label="Visitors" value={day.visitors} />
          <Tile label="Chats" value={day.chats} />
          <Tile label="Messages" value={day.messages} />
          <Tile label="New accounts" value={day.newUsers} />
          <Tile label="Reports" value={day.reports} />
          <Tile label="Bans" value={day.bans} />
        </div>
      </Section>

      <Section
        title="Hour by hour"
        action={
          <Segmented<Metric>
            label="Chart shows"
            value={metric}
            options={METRICS.map(({ value, label }) => ({ value, label }))}
            onChange={setMetric}
          />
        }
      >
        <div className="adm-card">
          <BarChart hours={hours} metric={metric} noun={noun} />
        </div>
      </Section>

      <Section
        title="Needs attention"
        action={
          totals.openReports > 0 ? (
            <Link className="adm-link" to="/admin/reports">
              See all {totals.openReports}
            </Link>
          ) : undefined
        }
      >
        {recentReports.length === 0 ? (
          <div className="adm-card">
            <Empty icon="check" title="All clear" text="No reports are waiting for you." />
          </div>
        ) : (
          <List label="Newest open reports">
            {recentReports.map((r) => (
              <Row
                key={r.id}
                href="/admin/reports"
                leading={
                  <span className="adm-avatar orange">
                    <Icon name="reports" size={18} />
                  </span>
                }
                title={reasonTitle(r.reason)}
                subtitle={`${r.mode === "video" ? "Video" : "Text"} · ${ago(r.createdAt, now)}`}
                trailing={<Pill tone="orange">Open</Pill>}
                chevron
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="On the site">
        <List>
          <Row
            title="Accounts"
            trailing={<span className="adm-value">{totals.users.toLocaleString()}</span>}
          />
          <Row
            title="Bans in force"
            href="/admin/bans"
            trailing={<span className="adm-value">{totals.activeBans.toLocaleString()}</span>}
            chevron
          />
        </List>
      </Section>
    </>
  );
}
