import { usePageTitle } from "../../hooks/usePageTitle.js";
import { adminApi } from "../api.js";
import { ago, eventLabel, fullDate, uptime } from "../format.js";
import {
  Empty,
  ErrorNote,
  List,
  Loading,
  PageHeader,
  Pill,
  Row,
  Section,
  useNow,
  useResource,
} from "../ui/bits.js";

const value = (v: string | number) => <span className="adm-value">{v}</span>;
const onOff = (on: boolean) => <Pill tone={on ? "green" : "gray"}>{on ? "On" : "Off"}</Pill>;

export function System() {
  usePageTitle("Admin · System");
  const sys = useResource("system", adminApi.system, { pollMs: 15_000 });
  const now = useNow();

  if (sys.loading && !sys.data) {
    return (
      <>
        <PageHeader title="System" />
        <Loading />
      </>
    );
  }
  if (!sys.data) {
    return (
      <>
        <PageHeader title="System" />
        <ErrorNote
          text={sys.error ?? "Couldn't load the system page."}
          retry={() => void sys.reload()}
        />
      </>
    );
  }
  const s = sys.data;

  return (
    <>
      <PageHeader
        title="System"
        subtitle="Is the server healthy, how it is set up, and anything it has complained about."
      />

      <Section title="Health">
        <List label="Health">
          <Row
            title="Database"
            trailing={
              s.database.up ? (
                <>
                  <Pill tone="green">Connected</Pill>
                  {value(`${s.database.ms} ms`)}
                </>
              ) : (
                <Pill tone="red">Not responding</Pill>
              )
            }
          />
          <Row title="Running for" trailing={value(uptime(s.uptimeSeconds))} />
          <Row title="People online" trailing={value(s.online)} />
          <Row title="Memory in use" trailing={value(`${s.memoryMb} MB`)} />
          <Row
            title="Version"
            trailing={value(`${s.version} · Node ${s.node.replace(/^v/, "")}`)}
          />
        </List>
      </Section>

      <Section title="Settings">
        <List label="Settings">
          <Row title="Site name" trailing={value(s.settings.siteName)} />
          <Row title="Public address" trailing={value(s.settings.publicUrl)} />
          <Row title="Environment" trailing={value(s.settings.environment)} />
          <Row title="Video chat" trailing={onOff(s.settings.video)} />
          <Row title="Sign in with Google" trailing={onOff(s.settings.googleSignIn)} />
          <Row
            title="Relay server for video (TURN)"
            subtitle={
              s.settings.turn ? undefined : "Some strict networks can't connect video without one."
            }
            trailing={
              <Pill tone={s.settings.turn ? "green" : "gray"}>
                {s.settings.turn ? "Set" : "Not set"}
              </Pill>
            }
          />
          <Row
            title="Contact email shown to visitors"
            trailing={
              <Pill tone={s.settings.contact ? "green" : "orange"}>
                {s.settings.contact ? "Set" : "Not set"}
              </Pill>
            }
          />
        </List>
      </Section>

      <Section title="Data">
        <List label="Data">
          <Row title="Accounts" trailing={value(s.counts.users.toLocaleString())} />
          <Row
            title="Reports kept"
            subtitle={`Removed after ${s.retention.reportDays} days`}
            trailing={value(s.counts.reports.toLocaleString())}
          />
          <Row title="Bans in force" trailing={value(s.counts.bans.toLocaleString())} />
          <Row
            title="Activity lines kept"
            subtitle={`Removed after ${s.retention.eventDays} days`}
            trailing={value(s.counts.events.toLocaleString())}
          />
        </List>
      </Section>

      <Section title="Recent problems">
        {s.problems.length === 0 ? (
          <div className="adm-card">
            <Empty
              icon="check"
              title="No problems recorded"
              text="Errors and warnings from the server show up here."
            />
          </div>
        ) : (
          <List label="Recent problems">
            {s.problems.map((p) => (
              <Row
                key={p.id}
                leading={
                  <span
                    className={`adm-dot ${p.type === "error" ? "red" : "orange"}`}
                    aria-hidden="true"
                  />
                }
                title={eventLabel(p.type)}
                subtitle={p.detail}
                trailing={
                  <time dateTime={p.at} title={fullDate(p.at)} className="adm-time">
                    {ago(p.at, now)}
                  </time>
                }
              />
            ))}
          </List>
        )}
      </Section>
    </>
  );
}
