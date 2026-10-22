"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AdminActivity } from "./admin-activity";
import type { QueueRow } from "./admin-console";
import { PromotionPath } from "./promotion-path";
import { QcChip } from "./qc-chip";
import { QcMark } from "./qc-mark";
import { DecisionCards, HistoryRow, decisionCopy, type Decision } from "./review";
import { envMeta, nextEnv, type EnvKey } from "@/lib/env";
import { fmtAge, fmtAgo, fmtDate, fmtNum } from "@/lib/format";
import { qcMeta, type QcStatus } from "@/lib/stac";
import { collectionHref } from "@/lib/utils";

/**
 * The review sheet the Admin queue opens from the right: one collection
 * with Previous and Next, or one decision for a selection. Split out of
 * admin-console.tsx, which owns the queue and the rows this reads.
 */

export type Flash = { text: string; link?: { href: string; label: string }; tone?: "ok" | "bad" };
export type Outcome = { ok: true; promotedTo: EnvKey | null } | { ok: false; error: string };
export type Sheet = { mode: "one"; id: string; list: string[] } | { mode: "bulk"; ids: string[]; decision: Decision };

export const statusOf = (r: QueueRow): QcStatus => r.qc?.qc ?? "pending";

/**
 * The sheet from the right. For one collection it shows where it stands,
 * its last note and its history, then the decision; for a selection it lists
 * them and takes one decision and one note for all.
 */
export function ReviewSheet({
  env,
  now,
  sheet,
  rows,
  decide,
  onMove,
  onFlash,
  onBulkDone,
  onClose,
}: {
  env: EnvKey;
  now: number;
  sheet: Sheet;
  rows: QueueRow[];
  decide: (row: QueueRow, d: Decision, note: string) => Promise<Outcome>;
  onMove: (id: string) => void;
  onFlash: (f: Flash) => void;
  onBulkDone: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () => ref.current?.close();

  const one = sheet.mode === "one" ? rows.find((r) => r.id === sheet.id) ?? null : null;
  const at = sheet.mode === "one" ? sheet.list.indexOf(sheet.id) : -1;
  const prevId = sheet.mode === "one" && at > 0 ? sheet.list[at - 1] : null;
  const nextId = sheet.mode === "one" && at >= 0 && at < sheet.list.length - 1 ? sheet.list[at + 1] : null;

  // Stepping to another collection remounts the form, and the control that
  // had focus with it, so focus goes to the new collection's title.
  const oneId = sheet.mode === "one" ? sheet.id : null;
  useEffect(() => {
    const d = ref.current;
    const at = document.activeElement;
    if (!d?.open || (at && at !== d && d.contains(at))) return;
    d.querySelector<HTMLElement>("#sheet-h")?.focus();
  }, [oneId]);

  // The page's own status line is inert behind the modal sheet, so the sheet
  // says what was saved itself.
  const [said, setSaid] = useState("");
  const flash = (f: Flash) => {
    onFlash(f);
    setSaid(f.text);
  };

  // J and K step through the queue, as in Gmail and GitHub, unless you're
  // typing or have a decision focused (a stray key would drop it).
  function onKey(e: React.KeyboardEvent) {
    if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("textarea, input, select")) return;
    if (e.key === "j" && nextId) onMove(nextId);
    else if (e.key === "k" && prevId) onMove(prevId);
  }

  return (
    // The handlers are for J/K and a backdrop click; Escape and the Close
    // button close it from the keyboard.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className="sx-sheet"
      aria-labelledby="sheet-h"
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onKeyDown={onKey}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === ref.current && !busy) close();
      }}
    >
      {sheet.mode === "one" && one ? (
        <OneReview
          key={one.id}
          env={env}
          now={now}
          row={one}
          position={{ at: at + 1, of: sheet.list.length }}
          prevId={prevId}
          nextId={nextId}
          busy={busy}
          setBusy={setBusy}
          decide={decide}
          onMove={onMove}
          onFlash={flash}
          onClose={close}
        />
      ) : sheet.mode === "bulk" ? (
        <BulkReview
          env={env}
          rows={sheet.ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is QueueRow => !!r)}
          initial={sheet.decision}
          busy={busy}
          setBusy={setBusy}
          decide={decide}
          onFlash={flash}
          onDone={onBulkDone}
          onClose={close}
        />
      ) : null}
      <p className="sr-only" role="status">
        {said}
      </p>
    </dialog>
  );
}

function SheetHead({
  title,
  sub,
  nav,
  link,
  onClose,
  busy,
}: {
  title: string;
  sub?: React.ReactNode;
  nav?: React.ReactNode;
  /** Under the buttons at the right: the way to the collection page. */
  link?: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="sx-sheet-head">
      <div className="min-w-0">
        <h2 id="sheet-h" className="sx-sheet-title" tabIndex={-1}>
          {title}
        </h2>
        {sub}
      </div>
      <div className="sx-sheet-side">
        <div className="sx-sheet-nav">
          {nav}
          <button type="button" className="sx-sheet-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {link}
      </div>
    </div>
  );
}

/**
 * The decision and the note. Here a note is asked for on Needs revision and
 * Reject, so whoever fixes the collection knows where to look, and on an
 * approval that goes to Production.
 */
function DecisionFields({
  name,
  env,
  count,
  sendable,
  decision,
  setDecision,
  note,
  setNote,
  disabled,
}: {
  name: string;
  env: EnvKey;
  count: number;
  sendable: boolean;
  decision: Decision | null;
  setDecision: (d: Decision) => void;
  note: string;
  setNote: (n: string) => void;
  disabled: boolean;
}) {
  const copy = decisionCopy(env, decision, count, sendable);
  return (
    <>
      <DecisionCards name={name} choices={copy.choices} decision={decision} onPick={setDecision} disabled={disabled} />
      <label className="sx-label">
        {noteRequired(env, decision) ? "Note (required)" : "Note (optional)"}
        <textarea
          className="ffx-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={copy.placeholder}
          maxLength={2000}
          required={noteRequired(env, decision)}
          disabled={disabled}
        />
      </label>
    </>
  );
}

function noteRequired(env: EnvKey, decision: Decision | null) {
  return decision === "needs_revision" || decision === "rejected" || decisionCopy(env, decision).toProd;
}

function OneReview({
  env,
  now,
  row,
  position,
  prevId,
  nextId,
  busy,
  setBusy,
  decide,
  onMove,
  onFlash,
  onClose,
}: {
  env: EnvKey;
  now: number;
  row: QueueRow;
  position: { at: number; of: number };
  prevId: string | null;
  nextId: string | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  decide: (row: QueueRow, d: Decision, note: string) => Promise<Outcome>;
  onMove: (id: string) => void;
  onFlash: (f: Flash) => void;
  onClose: () => void;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const copy = decisionCopy(env, decision, 1, row.sendable);
  const ready = decision !== null && (!noteRequired(env, decision) || note.trim().length > 0);
  const radios = useId();
  const status = statusOf(row);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision || !ready || busy) return;
    setError(null);
    setBusy(true);
    start(async () => {
      const res = await decide(row, decision, note.trim());
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const to = res.promotedTo ? envMeta(res.promotedTo) : null;
      onFlash(
        to
          ? {
              text: `${row.title} was approved and sent to ${to.label}.`,
              link: { href: collectionHref(to.key, row.id), label: `Open it in ${to.label}` },
            }
          : decision === "approved" && !row.sendable && nextEnv(env)
            ? { text: `${row.title} is approved. Sending it to ${nextEnv(env)!.label} is coming soon.` }
            : { text: `${row.title} is now ${qcMeta(decision).label.toLowerCase()}.` },
      );
      // On to the next one, as a review queue does; close at the end.
      if (nextId) onMove(nextId);
      else onClose();
    });
  }

  const lastNote = row.history.find((ev) => ev.kind === "qc" && ev.note);

  return (
    <form onSubmit={submit} className="sx-sheet-body">
      <SheetHead
        title={row.title}
        busy={busy}
        onClose={onClose}
        sub={
          <p className="sx-sheet-sub">
            <span className="ffx-id">{row.id}</span>
            {row.version && <span className="sx-tag">{row.version}</span>}
            <span className="sx-sheet-state">
              <QcMark state={status} />
              {qcMeta(status).label}
            </span>
          </p>
        }
        link={
          <Link href={row.href} className="ffx-link sx-sheet-open">
            Open collection <span aria-hidden="true">↗</span>
          </Link>
        }
        nav={
          position.of > 1 && (
              <span className="sx-stepper">
                <span className="ffx-num">
                  {position.at} of {position.of}
                </span>
                <button type="button" className="sx-sheet-btn" onClick={() => prevId && onMove(prevId)} disabled={!prevId || busy} aria-label="Previous collection" title="Previous (K)">
                  <Chevron dir="up" />
                </button>
                <button type="button" className="sx-sheet-btn" onClick={() => nextId && onMove(nextId)} disabled={!nextId || busy} aria-label="Next collection" title="Next (J)">
                  <Chevron dir="down" />
                </button>
              </span>
          )
        }
      />

      <div className="sx-sheet-scroll">
        {envMeta(env).onPath && (
          <PromotionPath current={env} stages={row.stages} here={row.since ? `Waiting ${fmtAge(row.since, now)}` : "Waiting"} />
        )}

        <dl className="sx-sheet-facts">
          <div>
            <dt>Items</dt>
            <dd className="ffx-num">{fmtNum(row.itemCount)}</dd>
          </div>
          <div>
            <dt>Last change</dt>
            <dd className="ffx-num" title={row.since ? fmtDate(row.since) : undefined}>
              {row.since ? fmtAgo(row.since, now) : <span className="sx-unknown">Unknown</span>}
            </dd>
          </div>
          <div className="sx-sheet-facts-wide">
            <dt>{row.files.length > 1 ? "Source files" : "Source file"}</dt>
            <dd className="ffx-id" title={row.files.join(", ")}>
              {row.files.join(", ")}
            </dd>
          </div>
        </dl>

        {lastNote && lastNote.kind === "qc" && (
          <figure className="sx-lastnote">
            <figcaption>
              Last note, with <b>{qcMeta(lastNote.qc).label}</b>, {fmtAgo(lastNote.at, now)}
            </figcaption>
            <blockquote>{lastNote.note}</blockquote>
          </figure>
        )}

        <DecisionFields
          name={radios}
          env={env}
          count={1}
          sendable={row.sendable}
          decision={decision}
          setDecision={setDecision}
          note={note}
          setNote={setNote}
          disabled={busy}
        />

        {copy.toProd && (
          <p className="sx-confirm">
            <span>
              <b>This publishes {row.id} to Production.</b> Everyone who uses the catalog will see it. Its current copy in
              Test is what gets sent.
            </span>
          </p>
        )}

        {error && (
          <p className="sx-form-error" role="alert">
            {error}
          </p>
        )}

        {row.history.length > 0 && (
          <HistoryRow label="History here" summary={`${row.history.length} ${row.history.length === 1 ? "entry" : "entries"}`}>
            <AdminActivity rows={row.history.map((event) => ({ collection: row.id, title: row.title, href: null, event }))} now={now} bare />
          </HistoryRow>
        )}
      </div>

      <div className="sx-sheet-foot">
        <span className="sx-sheet-consequence">{copy.consequence}</span>
        <span className="flex flex-none gap-2">
          <button type="button" className="ffx-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {/* aria-disabled while saving rather than disabled, which would drop focus. */}
          <button type="submit" className="ffx-btn ffx-btn-primary" disabled={!ready} aria-disabled={busy || undefined}>
            {busy ? "Saving" : copy.submit}
          </button>
        </span>
      </div>
    </form>
  );
}

function BulkReview({
  env,
  rows,
  initial,
  busy,
  setBusy,
  decide,
  onFlash,
  onDone,
  onClose,
}: {
  env: EnvKey;
  rows: QueueRow[];
  initial: Decision;
  busy: boolean;
  setBusy: (b: boolean) => void;
  decide: (row: QueueRow, d: Decision, note: string) => Promise<Outcome>;
  onFlash: (f: Flash) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const [decision, setDecision] = useState<Decision | null>(initial);
  const [note, setNote] = useState("");
  const [results, setResults] = useState<Record<string, Outcome> | null>(null);
  const [, start] = useTransition();
  const copy = decisionCopy(env, decision, rows.length, rows.every((r) => r.sendable));
  const ready = decision !== null && (!noteRequired(env, decision) || note.trim().length > 0);
  const radios = useId();
  // The list is fixed when the sheet opens, so saved rows don't drop out of it.
  const [list] = useState(rows);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision || !ready || busy) return;
    setBusy(true);
    start(async () => {
      // One at a time: each save is a conditional write to its own sidecar,
      // and an approval copies files.
      const out: Record<string, Outcome> = {};
      for (const r of list) {
        out[r.id] = await decide(r, decision, note.trim());
        setResults({ ...out });
      }
      setBusy(false);
      const failed = Object.values(out).filter((o) => !o.ok).length;
      const done = list.length - failed;
      onFlash({
        tone: failed ? "bad" : "ok",
        text: failed
          ? `${done} of ${list.length} saved. ${failed} couldn't be; the review sheet says why.`
          : decision === "approved" && !list.every((r) => r.sendable) && nextEnv(env)
            ? `${list.length} collections are approved. Sending them to ${nextEnv(env)!.label} is coming soon.`
            : `${list.length} collections are now ${qcMeta(decision).label.toLowerCase()}.`,
      });
      onDone();
      if (!failed) onClose();
    });
  }

  return (
    <form onSubmit={submit} className="sx-sheet-body">
      <SheetHead title={`Review ${list.length} collections`} busy={busy} onClose={onClose} />
      <div className="sx-sheet-scroll">
        <ul className="sx-bulk-list">
          {list.map((r) => {
            const res = results?.[r.id];
            return (
              <li key={r.id}>
                <span className="min-w-0">
                  <span className="sx-queue-title">{r.title}</span>
                  <span className="ffx-id sx-queue-sub">{r.id}</span>
                  {res && !res.ok && <span className="sx-form-error block">{res.error}</span>}
                </span>
                {res ? (
                  <span className="ffx-chip" data-tone={res.ok ? "verified" : "bad"} data-shape={res.ok ? undefined : "slash"}>
                    {res.ok ? "Saved" : "Not saved"}
                  </span>
                ) : (
                  <QcChip status={statusOf(r)} />
                )}
              </li>
            );
          })}
        </ul>
        {!results && (
          <DecisionFields
            name={radios}
            env={env}
            count={list.length}
            sendable={list.every((r) => r.sendable)}
            decision={decision}
            setDecision={setDecision}
            note={note}
            setNote={setNote}
            disabled={busy}
          />
        )}
        {!results && copy.toProd && (
          <p className="sx-confirm">
            <span>
              <b>This publishes {list.length} collections to Production.</b> Everyone who uses the catalog will see them.
            </span>
          </p>
        )}
      </div>
      <div className="sx-sheet-foot">
        <span className="sx-sheet-consequence">
          {results ? "Each collection's result is above." : `${copy.consequence} The same decision and note go on each.`}
        </span>
        <span className="flex flex-none gap-2">
          {results && !busy ? (
            // Takes focus from the Save button it replaces.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            <button type="button" className="ffx-btn ffx-btn-primary" onClick={onClose} autoFocus>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="ffx-btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="ffx-btn ffx-btn-primary" disabled={!ready} aria-disabled={busy || undefined}>
                {busy ? "Saving" : copy.submit}
              </button>
            </>
          )}
        </span>
      </div>
    </form>
  );
}

function Chevron({ dir }: { dir: "up" | "down" }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={dir === "up" ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
