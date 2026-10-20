"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { AdminActivity, type ActivityRow } from "./admin-activity";
import { PromotionPath, type PathStage } from "./promotion-path";
import { QcChip } from "./qc-chip";
import { QcMark } from "./qc-mark";
import { Caret, DecisionCards, HistoryRow, decisionCopy, type Decision } from "./review";
import { saveQcAction } from "@/app/actions";
import { envMeta, PATH, type EnvKey } from "@/lib/env";
import { fmtAge, fmtAgo, fmtDate, fmtNum } from "@/lib/format";
import { AREA_KIND_LABEL, type AreaKind } from "@/lib/kinds";
import { qcMeta, type QcEdit, type QcEvent, type QcStatus } from "@/lib/stac";
import { collectionHref } from "@/lib/utils";

/**
 * The Admin page's working parts: the counts, the review queue, the review
 * sheet and recent activity, all reading the same rows so a decision shows
 * up in each at once.
 *
 * The queue is laid out the way review queues in GitHub, Linear and Stripe
 * are: status tabs with counts, opening on the work (To review, oldest
 * first), a search, and the filter in the URL so a link to "everything that
 * needs revision" works. Selecting rows brings up a bar for deciding on
 * several at once, with a per-collection result afterwards so one failure
 * doesn't hide behind the rest.
 *
 * Review opens a sheet from the right rather than a dialog in the middle,
 * so the queue stays in view, and after a decision the sheet moves on to the
 * next collection. J and K step through the queue. There are deliberately no
 * one-key shortcuts for Approve or Reject: approving copies files to the
 * next environment, which shouldn't happen on a stray keypress.
 *
 * This is the only place a collection is reviewed or moved; the collection
 * page just shows its state.
 */

export type QueueRow = {
  id: string;
  title: string;
  /** The collection page. */
  href: string;
  kind: AreaKind;
  version: string | null;
  older: boolean;
  itemCount: number;
  files: string[];
  qc: QcEdit | null;
  /** When the collection last changed here: arrived, saved or sent on. */
  since: string | null;
  /** One per environment; qc is null where the collection isn't present. */
  stages: PathStage[];
  /** This environment's history, newest first. */
  history: QcEvent[];
};

type Filter = QcStatus | "all";
type Sort = "oldest" | "newest" | "title";
type Flash = { text: string; link?: { href: string; label: string }; tone?: "ok" | "bad" };
type Outcome = { ok: true; promotedTo: EnvKey | null } | { ok: false; error: string };
type Sheet = { mode: "one"; id: string; list: string[] } | { mode: "bulk"; ids: string[]; decision: Decision };

const FILTERS: { value: Filter; label: string }[] = [
  { value: "pending", label: "To review" },
  { value: "needs_revision", label: "Needs revision" },
  { value: "rejected", label: "Rejected" },
  { value: "approved", label: "Approved" },
  { value: "all", label: "All" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
  { value: "title", label: "Title" },
];

const EMPTY: Record<Filter, string> = {
  pending: "Nothing is waiting for review.",
  needs_revision: "No collections need revision.",
  rejected: "No collections have been rejected.",
  approved: "No collections have been approved yet.",
  all: "There are no collections in this environment.",
};

const statusOf = (r: QueueRow): QcStatus => r.qc?.qc ?? "pending";
const isFilter = (v: unknown): v is Filter => FILTERS.some((f) => f.value === v);
const isSort = (v: unknown): v is Sort => SORTS.some((s) => s.value === v);
const DAY = 86_400_000;

export function AdminConsole({
  env,
  rows,
  now,
  initial,
}: {
  env: EnvKey;
  rows: QueueRow[];
  /** The server's clock, so ages render the same on both sides. */
  now: number;
  initial: { status?: string; q?: string; sort?: string };
}) {
  const pathname = usePathname();
  const [filter, setFilter] = useState<Filter>(isFilter(initial.status) ? initial.status : "pending");
  const [query, setQuery] = useState(initial.q ?? "");
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : "oldest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const q = useDeferredValue(query.trim().toLowerCase());

  // The filter lives in the URL, so a filtered queue can be shared.
  useEffect(() => {
    const p = new URLSearchParams();
    if (filter !== "pending") p.set("status", filter);
    if (q) p.set("q", q);
    if (sort !== "oldest") p.set("sort", sort);
    const s = p.toString();
    window.history.replaceState(null, "", s ? `${pathname}?${s}` : pathname);
  }, [filter, q, sort, pathname]);

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { pending: 0, approved: 0, needs_revision: 0, rejected: 0, all: rows.length };
    for (const r of rows) out[statusOf(r)]++;
    return out;
  }, [rows]);

  const shown = useMemo(() => {
    const out = rows.filter(
      (r) =>
        (filter === "all" || statusOf(r) === filter) &&
        (!q || r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)),
    );
    // A row with no date sorts after every dated one, whichever way the dates go.
    const t = (r: QueueRow) => (r.since ? Date.parse(r.since) : null);
    const byDate = (dir: 1 | -1) => (a: QueueRow, b: QueueRow) => {
      const x = t(a);
      const y = t(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return dir * (x - y);
    };
    if (sort === "title") out.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    else out.sort(byDate(sort === "oldest" ? 1 : -1));
    return out;
  }, [rows, filter, q, sort]);

  const stats = useMemo(() => {
    const waiting = rows.filter((r) => statusOf(r) === "pending");
    const oldest = waiting.map((r) => r.since).filter((s): s is string => !!s).sort()[0] ?? null;
    return {
      waiting: waiting.length,
      oldest,
      sentBack: counts.needs_revision + counts.rejected,
      approved: rows.filter((r) => statusOf(r) === "approved" && r.qc && Date.parse(r.qc.updated_at) >= now - 30 * DAY)
        .length,
    };
  }, [rows, counts, now]);

  const activity: ActivityRow[] = useMemo(
    () =>
      rows
        .flatMap((r) => r.history.map((event) => ({ collection: r.id, title: r.title, href: r.href, event })))
        .sort((a, b) => b.event.at.localeCompare(a.event.at))
        .slice(0, 12),
    [rows],
  );

  function changeFilter(f: Filter) {
    setFilter(f);
    setSelected(new Set());
  }

  async function decide(row: QueueRow, decision: Decision, note: string): Promise<Outcome> {
    const today = new Date().toISOString().slice(0, 10);
    const date = decision === "approved" ? today : null;
    const form = new FormData();
    form.set("env", env);
    form.set("collection", row.id);
    form.set("qc", decision);
    form.set("date_approved", date ?? "");
    form.set("note", note);
    const res = await saveQcAction({ ok: null }, form);
    if (res.ok === true) return { ok: true, promotedTo: res.promotedTo };
    return { ok: false, error: res.ok === false ? res.error : "Nothing was saved." };
  }

  const selectedShown = shown.filter((r) => selected.has(r.id));
  const openId = sheet?.mode === "one" ? sheet.id : null;
  const [activityOpen, setActivityOpen] = useState(false);

  function open(id: string) {
    setFlash(null);
    setSheet({ mode: "one", id, list: shown.map((r) => r.id) });
  }

  return (
    <div className="sx-admin-stack">
      <dl className="sx-stats sx-admin-stats">
        <div className="sx-stat">
          <dt>
            <Short long="Waiting for review" short="Waiting" />
          </dt>
          <dd>{fmtNum(stats.waiting)}</dd>
        </div>
        <div className="sx-stat">
          <dt>
            <Short long="Oldest waiting" short="Oldest" />
          </dt>
          <dd>{stats.oldest ? fmtAge(stats.oldest, now) : "None"}</dd>
        </div>
        <div className="sx-stat">
          <dt>Sent back</dt>
          <dd>{fmtNum(stats.sentBack)}</dd>
        </div>
        <div className="sx-stat" data-tone="verified">
          <dt>
            <Short long="Approved, last 30 days" short="Approved, 30 days" />
          </dt>
          <dd>{fmtNum(stats.approved)}</dd>
        </div>
      </dl>

      <div className="sx-admin">
        <section className="ffx-panel" aria-labelledby="queue-h">
          <div className="ffx-panel-head">
            <h2 id="queue-h" className="ffx-panel-title">
              Review queue
            </h2>
          </div>
          <Tabs filter={filter} counts={counts} onChange={changeFilter} />
          <div className="ffx-toolbar sx-queue-tools">
            <label className="ffx-field min-w-0 flex-1 sm:max-w-xs">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search collections</span>
              <input
                type="search"
                placeholder="Search title or id"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(new Set());
                }}
              />
            </label>
            <label className="ffx-field ffx-field-select">
              <span className="ffx-field-label">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedShown.length > 0 && (
            <div className="sx-bulk" role="region" aria-label="Selected collections">
              <span className="ffx-num">
                <b>{selectedShown.length}</b> selected
              </span>
              <span className="sx-bulk-actions">
                {(["approved", "needs_revision", "rejected"] as Decision[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="ffx-btn ffx-btn-sm"
                    onClick={() => {
                      setFlash(null);
                      setSheet({ mode: "bulk", ids: selectedShown.map((r) => r.id), decision: d });
                    }}
                  >
                    {d === "approved" ? "Approve" : d === "rejected" ? "Reject" : <Short long="Needs revision" short="Revise" />}
                  </button>
                ))}
                <button type="button" className="ffx-btn ffx-btn-sm sx-bulk-clear" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </span>
            </div>
          )}

          <p className={`sx-admin-flash`} data-tone={flash?.tone ?? "ok"} role="status" aria-live="polite">
            {flash && (
              <>
                {flash.text}
                {flash.link && (
                  <>
                    {" "}
                    <Link href={flash.link.href} className="ffx-link">
                      {flash.link.label}
                    </Link>
                  </>
                )}
              </>
            )}
          </p>

          <div id="queue-panel" role="tabpanel" aria-labelledby={`tab-${filter}`}>
            {shown.length === 0 ? (
              <p className="sx-empty">{q ? "No collections match that search." : EMPTY[filter]}</p>
            ) : (
              <>
                <QueueTable
                  rows={shown}
                  now={now}
                  selected={selected}
                  openId={openId}
                  sortLabel={sort === "title" ? null : sort === "oldest" ? "ascending" : "descending"}
                  onSelect={setSelected}
                  onOpen={open}
                />
                <QueueCards rows={shown} now={now} selected={selected} openId={openId} onSelect={setSelected} onOpen={open} />
              </>
            )}
          </div>
        </section>

        <section className="ffx-panel sx-activity-panel" aria-labelledby="activity-h" data-open={activityOpen || undefined}>
          <div className="ffx-panel-head">
            <h2 id="activity-h" className="ffx-panel-title">
              Recent activity
            </h2>
            {/* On a phone the list folds into this row, under the queue. */}
            <button
              type="button"
              className="sx-activity-toggle"
              aria-expanded={activityOpen}
              aria-controls="activity-list"
              onClick={() => setActivityOpen(!activityOpen)}
            >
              <span className="ffx-num">{activity.length}</span>
              <span className="sr-only">{activityOpen ? "Hide recent activity" : "Show recent activity"}</span>
              <Caret />
            </button>
          </div>
          <div id="activity-list" className="sx-activity-list">
            <AdminActivity rows={activity} now={now} />
          </div>
        </section>
      </div>

      {sheet && (
        <ReviewSheet
          env={env}
          now={now}
          sheet={sheet}
          rows={rows}
          decide={decide}
          onMove={(id) => sheet.mode === "one" && setSheet({ ...sheet, id })}
          onFlash={setFlash}
          onBulkDone={() => setSelected(new Set())}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function Tabs({ filter, counts, onChange }: { filter: Filter; counts: Record<Filter, number>; onChange: (f: Filter) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Arrow keys, Home and End move between tabs, as the ARIA tabs pattern has it.
  function onKey(e: React.KeyboardEvent, i: number) {
    const n = FILTERS.length;
    const to =
      e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(FILTERS[to].value);
    refs.current[to]?.focus();
  }
  return (
    <div className="ffx-tabs">
      <div className="ffx-tabs-list" role="tablist" aria-label="Filter by QC status">
        {FILTERS.map((f, i) => (
          <button
            key={f.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${f.value}`}
            aria-selected={filter === f.value}
            aria-controls="queue-panel"
            tabIndex={filter === f.value ? 0 : -1}
            className="ffx-tab"
            onClick={() => onChange(f.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {f.label}
            <span className="ffx-tab-count ffx-num">{counts[f.value]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function QueueTable({
  rows,
  now,
  selected,
  openId,
  sortLabel,
  onSelect,
  onOpen,
}: {
  rows: QueueRow[];
  now: number;
  selected: Set<string>;
  openId: string | null;
  sortLabel: "ascending" | "descending" | null;
  onSelect: (s: Set<string>) => void;
  onOpen: (id: string) => void;
}) {
  const all = rows.every((r) => selected.has(r.id));
  const some = !all && rows.some((r) => selected.has(r.id));
  const head = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (head.current) head.current.indeterminate = some;
  }, [some]);

  function toggle(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    onSelect(s);
  }

  return (
    <div className="ffx-table-wrap sx-queue-wrap">
      <table className="ffx-table sx-queue">
        <thead>
          <tr>
            <th scope="col" className="sx-queue-check">
              <input
                ref={head}
                type="checkbox"
                checked={all}
                onChange={() => onSelect(all ? new Set() : new Set(rows.map((r) => r.id)))}
                aria-label="Select all shown"
              />
            </th>
            <th scope="col">Collection</th>
            <th scope="col">Kind</th>
            <th scope="col" className="ffx-r">
              Items
            </th>
            <th scope="col" aria-sort={sortLabel ?? undefined}>
              Since
            </th>
            <th scope="col">Environments</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-selected={selected.has(r.id) || undefined}
              data-open={r.id === openId || undefined}
              onClick={(e) => {
                // A click anywhere on the row opens it, except on its own controls.
                if ((e.target as HTMLElement).closest("a, button, input, label")) return;
                onOpen(r.id);
              }}
            >
              <td className="sx-queue-check">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.title}`} />
              </td>
              <td className="sx-queue-name">
                <Link href={r.href} className="sx-queue-title">
                  {r.title}
                </Link>
                {r.id === openId && <span className="sx-open-tag">Open</span>}
                <span className="sx-queue-sub">
                  <span className="ffx-id">{r.id}</span>
                  {r.version && <span className="sx-tag">{r.version}</span>}
                  {r.older && (
                    <span className="sx-tag" data-tone="muted">
                      Older version
                    </span>
                  )}
                </span>
              </td>
              <td>{AREA_KIND_LABEL[r.kind]}</td>
              <td className="ffx-r ffx-num">{fmtNum(r.itemCount)}</td>
              <td className="ffx-num" title={r.since ? fmtDate(r.since) : undefined}>
                <Since row={r} now={now} />
              </td>
              <td>
                <MiniPath stages={r.stages} />
              </td>
              <td className="ffx-r">
                <button type="button" className="ffx-btn ffx-btn-sm" aria-label={`Review ${r.title}`} onClick={() => onOpen(r.id)}>
                  Review
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The queue on a phone, where the table won't fit: one card per collection
 * with the same facts, selection and Review. Above 64rem the table shows
 * instead; both are in the page and CSS picks one.
 */
function QueueCards({
  rows,
  now,
  selected,
  openId,
  onSelect,
  onOpen,
}: {
  rows: QueueRow[];
  now: number;
  selected: Set<string>;
  openId: string | null;
  onSelect: (s: Set<string>) => void;
  onOpen: (id: string) => void;
}) {
  function toggle(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    onSelect(s);
  }
  return (
    <ul className="sx-qcards">
      {rows.map((r) => (
        <li key={r.id} className="sx-qcard" data-selected={selected.has(r.id) || undefined} data-open={r.id === openId || undefined}>
          <input
            type="checkbox"
            className="sx-check"
            checked={selected.has(r.id)}
            onChange={() => toggle(r.id)}
            aria-label={`Select ${r.title}`}
          />
          <div className="sx-qcard-main">
            <Link href={r.href} className="sx-qcard-title">
              {r.title}
            </Link>
            <span className="ffx-id sx-qcard-id">{r.id}</span>
            <span className="sx-qcard-facts">
              <span>{AREA_KIND_LABEL[r.kind]}</span>
              <span className="ffx-num">{fmtNum(r.itemCount)} items</span>
              <Since row={r} now={now} />
            </span>
            <span className="sx-qcard-foot">
              <MiniPath stages={r.stages} />
              <button type="button" className="ffx-btn sx-qcard-review" aria-label={`Review ${r.title}`} onClick={() => onOpen(r.id)}>
                Review
              </button>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** How long a row has been in its state; "Unknown", dimmed, when nothing says. */
function Since({ row, now }: { row: QueueRow; now: number }) {
  return row.since ? <span className="ffx-num">{fmtAge(row.since, now)}</span> : <span className="sx-unknown">Unknown</span>;
}

/** A label with a shorter form for phones; CSS shows one. */
function Short({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className="sx-wide-only">{long}</span>
      <span className="sx-narrow-only">{short}</span>
    </>
  );
}

/** Three small marks, one per environment on the path, filled where the collection is. The words are for screen readers. */
function MiniPath({ stages }: { stages: QueueRow["stages"] }) {
  const word = (qc: string | null) => (qc ? qcMeta(qc).label : "not there yet");
  return (
    <span className="sx-minipath">
      <span className="sr-only">{stages.map((s) => `${envMeta(s.env).label}: ${word(s.qc)}`).join(", ")}</span>
      {PATH.map((e) => {
        const s = stages.find((x) => x.env === e.key);
        return (
          <span
            key={e.key}
            className="sx-minipath-step"
            data-env={e.key}
            data-here={s?.qc != null}
            aria-hidden="true"
            title={`${e.label}: ${word(s?.qc ?? null)}`}
          >
            {e.short}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The sheet from the right. For one collection it shows where it stands,
 * its last note and its history, then the decision; for a selection it lists
 * them and takes one decision and one note for all.
 */
function ReviewSheet({
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

  // J and K step through the queue, as in Gmail and GitHub, unless you're typing.
  function onKey(e: React.KeyboardEvent) {
    if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("textarea, input:not([type=radio]), select")) return;
    if (e.key === "j" && nextId) onMove(nextId);
    else if (e.key === "k" && prevId) onMove(prevId);
  }

  return (
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
          onFlash={onFlash}
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
          onFlash={onFlash}
          onDone={onBulkDone}
          onClose={close}
        />
      ) : null}
    </dialog>
  );
}

function SheetHead({
  kicker,
  title,
  sub,
  nav,
  link,
  onClose,
  busy,
}: {
  kicker?: string;
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
        {kicker && <p className="sx-sheet-kicker">{kicker}</p>}
        <h2 id="sheet-h" className="sx-sheet-title">
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
  decision,
  setDecision,
  note,
  setNote,
  disabled,
}: {
  name: string;
  env: EnvKey;
  count: number;
  decision: Decision | null;
  setDecision: (d: Decision) => void;
  note: string;
  setNote: (n: string) => void;
  disabled: boolean;
}) {
  const copy = decisionCopy(env, decision, count);
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
  const copy = decisionCopy(env, decision, 1);
  const ready = decision !== null && (!noteRequired(env, decision) || note.trim().length > 0);
  const radios = useId();
  const status = statusOf(row);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision || !ready) return;
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
        kicker={AREA_KIND_LABEL[row.kind]}
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
          <button type="submit" className="ffx-btn ffx-btn-primary" disabled={busy || !ready}>
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
  const copy = decisionCopy(env, decision, rows.length);
  const ready = decision !== null && (!noteRequired(env, decision) || note.trim().length > 0);
  const radios = useId();
  // The list is fixed when the sheet opens, so saved rows don't drop out of it.
  const [list] = useState(rows);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision || !ready) return;
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
            <button type="button" className="ffx-btn ffx-btn-primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="ffx-btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="ffx-btn ffx-btn-primary" disabled={busy || !ready}>
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
