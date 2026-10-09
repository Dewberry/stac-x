"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { PromotionPath, fmtDay, type PathStage } from "./promotion-path";
import { QcHistory } from "./qc-history";
import { QcMark } from "./qc-mark";
import { DecisionCards, HistoryRow, decisionCopy } from "./review";
import { fmtNum } from "@/lib/format";
import { qcMeta, type QcEdit, type QcEvent, type QcStatus } from "@/lib/stac";
import { saveQcAction, type SaveState } from "@/app/actions";
import { envMeta, type EnvKey } from "@/lib/env";
import { collectionHref } from "@/lib/utils";

/**
 * The one thing on this app that writes: QC for a whole collection, as a
 * panel on the collection page laid out like the Admin review sheet. Where
 * it stands across environments, three decision cards that say what each
 * will do, a note, and one button whose words are the decision. The line
 * beside the button says what saving writes and whether anything moves.
 *
 * Approve stamps today as the approval date; "Change date" beside it opens
 * the date for a back-dated approval. A collection that has been decided can
 * be reset to Not reviewed from the link beside the Decision label.
 *
 * Approving also moves the collection forward: Development to Testing,
 * Testing to Production. Going to Production takes a second step and a note,
 * the way critical environments work in LaunchDarkly: a confirmation that
 * names the target, and a comment that becomes the record of why it went
 * live.
 *
 * The submit is wired by hand rather than through <form action>, because
 * React resets a form once its action resolves.
 */
export function QcPanel({
  env,
  collection,
  edit,
  stages,
  history,
}: {
  env: EnvKey;
  collection: string;
  edit: QcEdit | null;
  stages: PathStage[];
  history: QcEvent[];
}) {
  const [state, setState] = useState<SaveState>({ ok: null });
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const current = state.ok ? state.edit : edit;
  const status: QcStatus = current?.qc ?? "pending";
  const [decision, setDecision] = useState<QcStatus | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [dating, setDating] = useState(false);
  const [note, setNote] = useState("");
  const radios = useId();

  const copy = decisionCopy(env, decision);
  const target = decision === "approved" ? copy.next : null;
  const promoted = state.ok ? state.promotedTo : null;
  const here = envMeta(env).label;

  function pick(next: QcStatus) {
    setDecision(next);
    setConfirming(false);
    setState({ ok: null });
  }

  function send() {
    if (!decision) return;
    const form = new FormData();
    form.set("env", env);
    form.set("collection", collection);
    form.set("qc", decision);
    form.set("date_approved", decision === "approved" ? date : "");
    form.set("note", note);
    start(async () => {
      const res = await saveQcAction({ ok: null }, form);
      setState(res);
      setConfirming(false);
      if (res.ok) {
        setDecision(null);
        setNote("");
        setDating(false);
        setDate(today);
      }
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (copy.toProd && !confirming) {
      setConfirming(true);
      return;
    }
    send();
  }

  const label = pending ? (target ? `Sending to ${target.label}` : "Saving") : decision ? copy.submit : "Save QC";

  // The stepper shows what was just saved, before the page comes back.
  const shown = stages.map((s) =>
    s.env === env ? { ...s, qc: status, at: current?.date_approved ?? current?.updated_at ?? s.at } : s,
  );
  const last = history[0];

  return (
    <section className="ffx-panel sx-qc" aria-labelledby="qc-h" id="qc">
      <div className="ffx-panel-head">
        <h2 id="qc-h" className="ffx-panel-title">
          Quality control
        </h2>
        <p className="sx-qc-state">
          <QcMark state={status} />
          {qcMeta(status).label} in {here}
        </p>
      </div>
      <div className="sx-qc-body">
        <PromotionPath current={env} stages={shown} here="You're reviewing here" />

        <form onSubmit={submit} className="sx-form">
          <DecisionCards
            name={radios}
            choices={copy.choices}
            decision={decision}
            onPick={pick}
            disabled={pending}
            legendAside={
              status !== "pending" && (
                <button type="button" className="sx-textbtn" onClick={() => pick("pending")} aria-pressed={decision === "pending"}>
                  Reset to Not reviewed
                </button>
              )
            }
            extra={{
              approved:
                decision === "approved" &&
                (dating ? (
                  <label className="sx-label sx-choice-date">
                    Approval date
                    <span className="ffx-field">
                      <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
                    </span>
                  </label>
                ) : (
                  <button type="button" className="sx-textbtn" onClick={() => setDating(true)}>
                    Change date
                  </button>
                )),
            }}
          />
          <label className="sx-label">
            {copy.toProd ? "Note (required for Production)" : "Note"}
            <textarea
              name="note"
              className="ffx-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={copy.toProd ? copy.placeholder : "What was checked, or why it did not pass."}
              maxLength={2000}
              required={copy.toProd}
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
            <div className="sx-form-row sx-qc-submit">
              <button
                type="submit"
                className="ffx-btn ffx-btn-primary"
                disabled={pending || !decision || (copy.toProd && !note.trim())}
              >
                {label}
              </button>
              <span className="sx-qc-consequence">{copy.consequence}</span>
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

        {history.length > 0 && (
          <HistoryRow
            summary={`${fmtNum(history.length)} ${history.length === 1 ? "entry" : "entries"}${last ? ` · last ${fmtDay(last.at)}` : ""}`}
          >
            <QcHistory events={history} />
          </HistoryRow>
        )}
      </div>
    </section>
  );
}

