import { useEffect, useRef, useState } from "react";
import { REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from "@passerby/shared";

/**
 * "Report this person": pick a reason and send. A native dialog, so Esc closes it, focus stays inside it,
 * and the page behind it can't be used meanwhile.
 */
export function ReportDialog({
  open,
  onCancel,
  onSend,
}: {
  open: boolean;
  onCancel(): void;
  onSend(reason: ReportReason): void;
}) {
  const el = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason>("harassment");

  useEffect(() => {
    const dialog = el.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Older test environments have no showModal; the attribute alone is enough to show it there.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={el}
      className="rep"
      aria-labelledby="rep-title"
      onCancel={(e) => {
        e.preventDefault(); // we close it ourselves, so the page's idea of "open" stays right
        onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSend(reason);
        }}
      >
        <h2 id="rep-title">Report this person</h2>
        <p className="muted">
          The chat ends, you won&rsquo;t be matched with them again, and the last messages are saved
          for a moderator to review.
        </p>
        <fieldset>
          <legend className="sr">Why are you reporting them?</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className="chk">
              <input
                type="radio"
                name="reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
              />
              <span>{REPORT_REASON_LABELS[r]}</span>
            </label>
          ))}
        </fieldset>
        <div className="row">
          <button className="btn stop">Send report</button>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
