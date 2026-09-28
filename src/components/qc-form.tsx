"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { QcChip } from "./qc-chip";
import { fmtDate } from "@/lib/format";
import { QC_STATUSES, type QcEdit, type QcStatus } from "@/lib/stac";
import { saveQcAction, type SaveState } from "@/app/actions";
import { envMeta, nextEnv, type EnvKey } from "@/lib/env";
import { collectionHref } from "@/lib/utils";

/**
 * The one thing on this app that writes: QC for a whole collection.
 *
 * Status, approval date, an optional note. Picking Approved fills the date
 * with today if it is empty, since that is nearly always what is meant, and
 * the date stays editable for a back-dated approval. Saving goes through a
 * server action that writes the sidecar beside the parquet file.
 *
 * Approving also moves the collection forward: Development to Testing,
 * Testing to Production. The button says so before you press it. Going to
 * Production takes a second step and a note, the way critical environments
 * work in LaunchDarkly: a confirmation that names the target, and a comment
 * that becomes the record of why it went live.
 *
 * The submit is wired by hand rather than through <form action>, because
 * React resets a form once its action resolves, which snapped the status
 * select back to its first option right after a save.
 */
export function QcForm({ env, collection, edit }: { env: EnvKey; collection: string; edit: QcEdit | null }) {
  const [state, setState] = useState<SaveState>({ ok: null });
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const current = state.ok ? state.edit : edit;
  const [qc, setQc] = useState<QcStatus>(current?.qc ?? "pending");
  const [date, setDate] = useState(current?.date_approved ?? "");
  const [note, setNote] = useState(current?.note ?? "");

  const target = qc === "approved" ? nextEnv(env) : null;
  const toProd = target?.key === "prod";
  const promoted = state.ok ? state.promotedTo : null;

  function pick(next: QcStatus) {
    setQc(next);
    setConfirming(false);
    if (next === "approved" && !date) setDate(new Date().toISOString().slice(0, 10));
    if (next === "pending") setDate("");
  }

  function send() {
    const form = new FormData();
    form.set("env", env);
    form.set("collection", collection);
    form.set("qc", qc);
    form.set("date_approved", date);
    form.set("note", note);
    start(async () => {
      setState(await saveQcAction({ ok: null }, form));
      setConfirming(false);
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (toProd && !confirming) {
      setConfirming(true);
      return;
    }
    send();
  }

  const label = pending
    ? target
      ? `Sending to ${target.label}`
      : "Saving"
    : target
      ? `Approve and send to ${target.label}`
      : "Save QC";

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
        {toProd ? "Note (required for Production)" : "Note"}
        <textarea
          name="note"
          className="ffx-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={toProd ? "What was checked, and why it's ready for Production." : "What was checked, or why it did not pass."}
          maxLength={2000}
          required={toProd}
        />
      </label>
      {confirming ? (
        <div className="sx-confirm" role="alert">
          <p>
            <b>Send {collection} to Production?</b> Everyone who uses the catalog will see it. Its current copy in
            Testing is what gets sent.
          </p>
          <div className="sx-form-row">
            <button type="submit" className="ffx-btn ffx-btn-primary" disabled={pending || !note.trim()}>
              {pending ? "Sending to Production" : "Send to Production"}
            </button>
            <button type="button" className="ffx-btn" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="sx-form-row">
          <button type="submit" className="ffx-btn ffx-btn-primary" disabled={pending || (toProd && !note.trim())}>
            {label}
          </button>
          <QcChip status={current?.qc ?? "pending"} />
          {current?.updated_at && (
            <span className="sx-form-note ffx-num">last saved {fmtDate(current.updated_at)}</span>
          )}
        </div>
      )}
      {state.ok === false && <p className="sx-form-error">{state.error}</p>}
      {state.ok === true &&
        (promoted ? (
          <p className="sx-form-ok">
            Approved and sent to {envMeta(promoted).label}.{" "}
            <Link href={collectionHref(promoted, collection)}>Open it in {envMeta(promoted).label}</Link>
          </p>
        ) : (
          <p className="sx-form-ok">Saved.</p>
        ))}
    </form>
  );
}
