import { useState } from "react";
import type { AdminUser } from "@passerby/shared";
import { usePageTitle } from "../../hooks/usePageTitle.js";
import { adminApi } from "../api.js";
import { ago, dateOnly, fullDate, initials } from "../format.js";
import {
  Empty,
  ErrorNote,
  List,
  Loading,
  PageHeader,
  Pill,
  Row,
  useDebounced,
  useNow,
  usePaged,
} from "../ui/bits.js";
import { Icon } from "../ui/Icon.js";
import { Sheet } from "../ui/Sheet.js";
import { useToast } from "../ui/Toast.js";

export function Users() {
  usePageTitle("Admin · Users");
  const now = useNow();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const list = usePaged<AdminUser>(`users:${q}`, (cursor) => adminApi.users(q, cursor));

  return (
    <>
      <PageHeader title="Users" subtitle="People who made an account. Chatting never needs one." />
      <div className="adm-toolbar">
        <label className="adm-search">
          <Icon name="search" size={18} />
          <span className="sr">Search by name or email</span>
          <input
            type="search"
            placeholder="Search by name or email"
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
            icon="users"
            title={q ? "No one matches" : "No accounts yet"}
            text={q ? "Try part of a name or an email address." : "People who sign up appear here."}
          />
        </div>
      ) : (
        <>
          <List label="Accounts">
            {list.items.map((u) => (
              <Row
                key={u.id}
                onClick={() => setSelected(u)}
                leading={<span className="adm-avatar blue">{initials(u.name)}</span>}
                title={u.name}
                subtitle={
                  <>
                    <span>{u.email}</span>
                    <span>
                      Joined {dateOnly(u.createdAt)}
                      {u.lastLoginAt
                        ? ` · last in ${ago(u.lastLoginAt, now)}`
                        : " · never signed in again"}
                    </span>
                  </>
                }
                trailing={
                  <>
                    {u.suspended && <Pill tone="red">Suspended</Pill>}
                    {u.google && <Pill tone="blue">Google</Pill>}
                  </>
                }
                chevron
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

      {selected && (
        <UserSheet
          key={selected.id}
          user={selected}
          onChanged={(u) => {
            setSelected(u);
            void list.reload();
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function UserSheet({
  user,
  onChanged,
  onClose,
}: {
  user: AdminUser;
  onChanged(u: AdminUser): void;
  onClose(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const suspend = () =>
    run(async () => {
      onChanged(await adminApi.suspend(user.id));
      toast({
        text: `${user.name} is suspended and has been signed out everywhere.`,
        undo: async () => onChanged(await adminApi.unsuspend(user.id)),
      });
    });
  const restore = () =>
    run(async () => {
      onChanged(await adminApi.unsuspend(user.id));
      toast({ text: `${user.name} can sign in again.` });
    });
  const reset = () =>
    run(async () => {
      const done = await adminApi.resetPassword(user.id);
      setFresh(done.password);
      setConfirming(false);
      onChanged(done.user);
    });

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ text: "Couldn't copy. Select the password and copy it by hand.", tone: "error" });
    }
  };

  return (
    <Sheet title={user.name} subtitle={user.email} onDismiss={onClose}>
      <div className="adm-profile">
        <span className="adm-avatar blue large">{initials(user.name)}</span>
        <div className="adm-chips">
          {user.suspended && <Pill tone="red">Suspended</Pill>}
          {user.google && <Pill tone="blue">Google</Pill>}
          <Pill tone={user.hasPassword ? "green" : "gray"}>
            {user.hasPassword ? "Has a password" : "No password"}
          </Pill>
        </div>
      </div>

      <div className="adm-sheet-section">
        <List label="Details">
          <Row
            title="Joined"
            trailing={<span className="adm-value">{fullDate(user.createdAt)}</span>}
          />
          <Row
            title="Last signed in"
            trailing={
              <span className="adm-value">
                {user.lastLoginAt ? fullDate(user.lastLoginAt) : "Never"}
              </span>
            }
          />
          <Row title="Sign-ins" trailing={<span className="adm-value">{user.loginCount}</span>} />
          <Row
            title="Premium"
            trailing={
              <span className="adm-value">
                {user.premiumUntil && Date.parse(user.premiumUntil) > Date.now()
                  ? `Until ${dateOnly(user.premiumUntil)}`
                  : "None"}
              </span>
            }
          />
        </List>
      </div>

      {fresh && (
        <div className="adm-callout" data-tone="blue">
          <strong>New password</strong>
          <span>
            Shown once. Give it to them privately; they can change it from their account page. They
            have been signed out everywhere.
          </span>
          <span className="adm-secret">
            <code aria-label="New password">{fresh}</code>
            <button type="button" className="adm-btn secondary small" onClick={() => void copy()}>
              <Icon name={copied ? "check" : "copy"} size={16} />
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        </div>
      )}

      <div className="adm-actions">
        {confirming ? (
          <div className="adm-confirm">
            <p>
              This signs {user.name} out everywhere and gives them a new random password, which you
              will see once.
            </p>
            <div className="adm-actions-row">
              <button
                type="button"
                className="adm-btn secondary"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="adm-btn"
                disabled={busy}
                onClick={() => void reset()}
              >
                Reset password
              </button>
            </div>
          </div>
        ) : (
          <div className="adm-actions-row">
            <button
              type="button"
              className="adm-btn secondary"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Reset password…
            </button>
            {user.suspended ? (
              <button
                type="button"
                className="adm-btn"
                disabled={busy}
                onClick={() => void restore()}
              >
                Restore account
              </button>
            ) : (
              <button
                type="button"
                className="adm-btn danger"
                disabled={busy}
                onClick={() => void suspend()}
              >
                Suspend account
              </button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
