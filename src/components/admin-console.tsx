"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AdminActivity, type ActivityRow } from "./admin-activity";
import type { PathStage } from "./promotion-path";
import { FolderGlyph } from "./icons";
import { Caret, type Decision } from "./review";
import { ReviewSheet, statusOf, type Flash, type Outcome, type Sheet } from "./admin-review-sheet";
import { saveQcAction } from "@/app/actions";
import { envMeta, nextEnv, PATH, type EnvKey } from "@/lib/env";
import { fmtAge, fmtDate, fmtNum } from "@/lib/format";
import { qcMeta, type QcEdit, type QcEvent, type QcStatus } from "@/lib/stac";
import { withBase } from "@/lib/utils";

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
 * This is the only place a dataset is reviewed or moved; its page just
 * shows its state. The sheet itself is in admin-review-sheet.tsx.
 *
 * The queue is datasets only. Catalogs are folders with nothing to review
 * (lib/collection-hierarchy.ts); they appear as the headings the rows are
 * grouped under, by top-level catalog, which can be turned off.
 */

export type QueueRow = {
  id: string;
  title: string;
  /** The top-level catalog it sits in; null for a dataset at the top. */
  group: { slug: string; name: string } | null;
  /** Empty catalogs directly inside it (Project Scoping's ten). */
  emptyInside: number;
  /** The collection page. */
  href: string;
  version: string | null;
  older: boolean;
  itemCount: number;
  files: string[];
  /** Whether approving copies it to the next environment yet (see lib/promote.ts). */
  sendable: boolean;
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
type Grouping = "catalog" | "none";

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

// The labels say what they do on their own, since a phone hides "Group by".
const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "catalog", label: "By catalog" },
  { value: "none", label: "Not grouped" },
];

const EMPTY: Record<Filter, string> = {
  pending: "Nothing is waiting for review.",
  needs_revision: "No datasets need revision.",
  rejected: "No datasets have been rejected.",
  approved: "No datasets have been approved yet.",
  all: "There are no datasets in this environment.",
};

const isFilter = (v: unknown): v is Filter => FILTERS.some((f) => f.value === v);
const isSort = (v: unknown): v is Sort => SORTS.some((s) => s.value === v);
const isGrouping = (v: unknown): v is Grouping => GROUPINGS.some((g) => g.value === v);

/** One group of the queue: the rows under a top-level catalog, or under no heading. */
type QueueGroup = { key: string; name: string | null; rows: QueueRow[] };

/** Rows under their top-level catalog, catalogs by name, the ones at the top first, each in the queue's order. */
function groupsOf(rows: QueueRow[], grouping: Grouping): QueueGroup[] {
  if (grouping === "none") return rows.length ? [{ key: "all", name: null, rows }] : [];
  const by = new Map<string, QueueGroup>();
  for (const r of rows) {
    const key = r.group?.slug ?? "";
    let g = by.get(key);
    if (!g) by.set(key, (g = { key: key || "top", name: r.group?.name ?? null, rows: [] }));
    g.rows.push(r);
  }
  return [...by.values()].sort((a, b) => (!a.name ? -1 : !b.name ? 1 : a.name.localeCompare(b.name)));
}

const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const DAY = 86_400_000;

export function AdminConsole({
  env,
  rows,
  catalogCount,
  now,
  initial,
}: {
  env: EnvKey;
  /** The environment's datasets. */
  rows: QueueRow[];
  /** The catalogs around them, which aren't reviewed. */
  catalogCount: number;
  /** The server's clock, so ages render the same on both sides. */
  now: number;
  initial: { status?: string; q?: string; sort?: string; group?: string };
}) {
  const pathname = usePathname();
  const [filter, setFilter] = useState<Filter>(isFilter(initial.status) ? initial.status : "pending");
  const [query, setQuery] = useState(initial.q ?? "");
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : "oldest");
  const [grouping, setGrouping] = useState<Grouping>(isGrouping(initial.group) ? initial.group : "catalog");
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
    if (grouping !== "catalog") p.set("group", grouping);
    const s = p.toString();
    // usePathname leaves out the base path; without it a reload or a copied
    // link lands outside the app.
    const path = withBase(pathname);
    window.history.replaceState(null, "", s ? `${path}?${s}` : path);
  }, [filter, q, sort, grouping, pathname]);

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
  // The rows as the page shows them, in groups; J and K step in this order.
  const groups = useMemo(() => groupsOf(shown, grouping), [shown, grouping]);
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const next = nextEnv(env);
  // What approving does here, said plainly: only some datasets can be sent
  // on yet (lib/promote.ts), and catalogs never are.
  const sendable = shown.filter((r) => r.sendable).length;
  const approveNote = !next
    ? "Catalogs are never approved on their own."
    : sendable === shown.length
      ? `Approving a dataset sends it to ${next.label}. Catalogs are never approved on their own.`
      : sendable === 0
        ? `Approving a dataset records the decision here; sending it to ${next.label} along with the catalog path it sits in is coming soon. Catalogs are never approved on their own.`
        : `Approving a dataset sends it to ${next.label}, except one read from a STAC catalog, which keeps its approval here until sending those is built. Catalogs are never approved on their own.`;

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
    setSheet({ mode: "one", id, list: ordered.map((r) => r.id) });
  }

  return (
    <div className="sx-admin-stack">
      <dl className="sx-stats sx-admin-stats">
        <div className="sx-stat">
          <dt>
            <Short long="Waiting for review" short="Waiting" />
          </dt>
          <dd>{fmtNum(stats.waiting)}</dd>
          <dd className="sx-stat-note">
            Datasets.
            {catalogCount > 0 && <> The {plural(catalogCount, "catalog", "catalogs")} around them {catalogCount === 1 ? "isn't" : "aren't"} reviewed.</>}
          </dd>
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
              <span className="sr-only">Search datasets</span>
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
            <label className="ffx-field ffx-field-select">
              <span className="ffx-field-label">Group by</span>
              <select value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)}>
                {GROUPINGS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedShown.length > 0 && (
            <div className="sx-bulk" role="region" aria-label="Selected datasets">
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
                <button
                  type="button"
                  className="ffx-btn ffx-btn-sm sx-bulk-clear"
                  onClick={() => {
                    setSelected(new Set());
                    // This bar goes away with the selection, and focus with it.
                    focusQueue();
                  }}
                >
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

          <div id="queue-panel" role="tabpanel" aria-labelledby={`tab-${filter}`} tabIndex={-1}>
            {shown.length === 0 ? (
              <p className="sx-empty">{q ? "No datasets match that search." : EMPTY[filter]}</p>
            ) : (
              <>
                <QueueTable
                  rows={ordered}
                  groups={groups}
                  now={now}
                  selected={selected}
                  openId={openId}
                  sort={sort}
                  onSelect={setSelected}
                  onOpen={open}
                />
                <QueueCards groups={groups} now={now} selected={selected} openId={openId} onSelect={setSelected} onOpen={open} />
              </>
            )}
            {rows.length > 0 && <p className="sx-queue-note">{approveNote}</p>}
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
          onClose={() => {
            setSheet(null);
            // The dialog hands focus back to the button that opened it, but
            // that row may have left the queue with the decision.
            requestAnimationFrame(() => {
              if (!document.activeElement || document.activeElement === document.body) focusQueue();
            });
          }}
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
  groups,
  now,
  selected,
  openId,
  sort,
  onSelect,
  onOpen,
}: {
  rows: QueueRow[];
  groups: QueueGroup[];
  now: number;
  selected: Set<string>;
  openId: string | null;
  sort: Sort;
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
            <th scope="col" aria-sort={sort === "title" ? "ascending" : undefined}>
              Dataset
            </th>
            <th scope="col" className="ffx-r">
              Items
            </th>
            <th scope="col" aria-sort={sort === "oldest" ? "ascending" : sort === "newest" ? "descending" : undefined}>
              Since
            </th>
            <th scope="col">Environments</th>
            <th scope="col">
              <span className="sr-only">Review</span>
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            {g.name && (
              <tr className="sx-qgroup">
                <th scope="colgroup" colSpan={6}>
                  <span className="sx-qgroup-in">
                    <FolderGlyph />
                    <span className="sx-qgroup-name">{g.name}</span>
                    <span className="sx-qgroup-count">{plural(g.rows.length, "dataset", "datasets")}</span>
                  </span>
                </th>
              </tr>
            )}
            {g.rows.map((r) => (
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
                    {r.emptyInside > 0 && <span>Also holds {plural(r.emptyInside, "empty catalog", "empty catalogs")}</span>}
                  </span>
                </td>
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
        ))}
      </table>
    </div>
  );
}

/**
 * The queue on a phone, where the table won't fit: one card per dataset
 * with the same facts, selection and Review, under the same catalog headings. Above 64rem the table shows
 * instead; both are in the page and CSS picks one.
 */
function QueueCards({
  groups,
  now,
  selected,
  openId,
  onSelect,
  onOpen,
}: {
  groups: QueueGroup[];
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
    <div className="sx-qcards">
      {groups.map((g) => (
        <div key={g.key}>
          {g.name && (
            <h3 className="sx-qgroup-card">
              <FolderGlyph />
              <span className="sx-qgroup-name">{g.name}</span>
              <span className="sx-qgroup-count">{plural(g.rows.length, "dataset", "datasets")}</span>
            </h3>
          )}
          <ul>
            {g.rows.map((r) => (
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
                  {r.emptyInside > 0 && (
                    <span className="sx-qcard-holds">Also holds {plural(r.emptyInside, "empty catalog", "empty catalogs")}</span>
                  )}
                  <span className="sx-qcard-facts">
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
        </div>
      ))}
    </div>
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

/** Somewhere steady for focus in the queue: the select-all box, or the panel on a phone, where there's none. */
function focusQueue() {
  const all = document.querySelector<HTMLElement>('#queue-panel input[aria-label="Select all shown"]');
  if (all?.checkVisibility()) all.focus();
  else document.getElementById("queue-panel")?.focus();
}
