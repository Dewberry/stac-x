"use client";

import { useState, useTransition } from "react";
import { QcChip } from "./qc-chip";
import { fmtDate } from "@/lib/format";
import { QC_STATUSES, type QcEdit, type QcStatus } from "@/lib/stac";
import { saveQcAction, type SaveState } from "@/app/actions";

/**
 * The one thing on this app that writes: QC for a whole collection.
 *
 * Status, approval date, an optional note. Picking Approved fills the date
 * with today if it is empty, since that is nearly always what is meant, and
 * the date stays editable for a back-dated approval. Saving goes through a
 * server action that writes the sidecar beside the parquet file.
 *
 * The submit is wired by hand rather than through <form action>, because
 * React resets a form once its action resolves, which snapped the status
 * select back to its first option right after a save.
 */
export function QcForm({ collection, edit }: { collection: string; edit: QcEdit | null }) {
  const [state, setState] = useState<SaveState>({ ok: null });
  const [pending, start] = useTransition();
  const current = state.ok ? state.edit : edit;
  const [qc, setQc] = useState<QcStatus>(current?.qc ?? "pending");
  const [date, setDate] = useState(current?.date_approved ?? "");
  const [note, setNote] = useState(current?.note ?? "");

  function pick(next: QcStatus) {
    setQc(next);
    if (next === "approved" && !date) setDate(new Date().toISOString().slice(0, 10));
    if (next === "pending") setDate("");
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData();
    form.set("collection", collection);
    form.set("qc", qc);
    form.set("date_approved", date);
    form.set("note", note);
    start(async () => {
      setState(await saveQcAction({ ok: null }, form));
    });
  }

  return (
    <form onSubmit={submit} className="sx-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sx-label">
          QC status
          <span className="ffx-field ffx-field-select">
            <select name="qc" value={qc} onChange={(e) => pick(e.target.value as QcStatus)}>
              {QC_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="sx-label">
          Date approved
          <span className="ffx-field">
            <input type="date" name="date_approved" value={date} onChange={(e) => setDate(e.target.value)} />
          </span>
        </label>
      </div>
      <label className="sx-label">
        Note
        <textarea
          name="note"
          className="ffx-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was checked, or why it did not pass."
          maxLength={2000}
        />
      </label>
      <div className="sx-form-row">
        <button type="submit" className="ffx-btn ffx-btn-primary" disabled={pending}>
          {pending ? "Saving" : "Save QC"}
        </button>
        <QcChip status={current?.qc ?? "pending"} />
        {current?.updated_at && (
          <span className="sx-form-note ffx-num">last saved {fmtDate(current.updated_at)}</span>
        )}
      </div>
      {state.ok === false && <p className="sx-form-error">{state.error}</p>}
      {state.ok === true && <p className="sx-form-ok">Saved.</p>}
    </form>
  );
}
