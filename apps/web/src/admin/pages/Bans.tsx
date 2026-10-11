import { useState } from "react";
import type { AdminBan } from "@passerby/shared";
import { usePageTitle } from "../../hooks/usePageTitle.js";
import { useOverview } from "../AdminContext.js";
import { adminApi } from "../api.js";
import { BAN_REASON_LABELS, clock, timeLeft } from "../format.js";
import {
  Empty,
  ErrorNote,
  List,
  Loading,
  PageHeader,
  Pill,
  Row,
  useNow,
  useResource,
} from "../ui/bits.js";
import { Icon } from "../ui/Icon.js";
import { useToast } from "../ui/Toast.js";

export function Bans() {
  usePageTitle("Admin · Bans");
  const toast = useToast();
  const overview = useOverview();
  const bans = useResource("bans", adminApi.bans, { pollMs: 15_000 });
  const now = useNow(15_000);
  const [busy, setBusy] = useState<string | null>(null);

  const lift = async (ban: AdminBan) => {
    setBusy(ban.id);
    try {
      const lifted = await adminApi.liftBan(ban.id);
      await bans.reload();
      void overview.reload();
      toast({
        text: `Ban on ${lifted.tag} lifted.`,
        undo: async () => {
          await adminApi.restoreBan(lifted);
          await bans.reload();
          void overview.reload();
        },
      });
    } catch (err) {
      toast({
        text: err instanceof Error ? err.message : "Couldn't lift that ban.",
        tone: "error",
      });
      await bans.reload(); // it may already be over
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Bans"
        subtitle="People who are blocked right now. A ban ends by itself; lift one early if it was a mistake."
      />
      {bans.loading && !bans.data ? (
        <Loading />
      ) : !bans.data ? (
        <ErrorNote
          text={bans.error ?? "Couldn't load the bans."}
          retry={() => void bans.reload()}
        />
      ) : bans.data.length === 0 ? (
        <div className="adm-card">
          <Empty
            icon="bans"
            title="No one is banned"
            text="Bans from reports and age checks appear here."
          />
        </div>
      ) : (
        <List label="Bans in force">
          {bans.data.map((b) => (
            <Row
              key={b.id}
              leading={
                <span className="adm-avatar red">
                  <Icon name="bans" size={18} />
                </span>
              }
              title={<code className="adm-tag">{b.tag}</code>}
              subtitle={
                <>
                  <span>{BAN_REASON_LABELS[b.reason]}</span>
                  <span>
                    Until {clock(b.until)} · {timeLeft(b.until, now)}
                  </span>
                </>
              }
              trailing={
                <>
                  <Pill tone="red">Banned</Pill>
                  <button
                    type="button"
                    className="adm-btn secondary small"
                    disabled={busy === b.id}
                    onClick={() => void lift(b)}
                    aria-label={`Lift ban on ${b.tag}`}
                  >
                    Lift
                  </button>
                </>
              }
            />
          ))}
        </List>
      )}
    </>
  );
}
