"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fmtDate, fmtNum, humanize, isIsoDate } from "@/lib/format";

/**
 * Any JSON, as key beside value. Strings, numbers and dates print; an object
 * becomes a nested table; a list of objects becomes a small grid with a column
 * per key; a list of scalars is a comma-separated line. STAC item properties
 * are mostly flat, but the gage rows carry a struct or two, and an asset can
 * carry a whole table under file:values.
 *
 * Long values are what make a metadata panel run to six screens, so they're
 * kept to one line: a path or URL is cut with an ellipsis and a Copy beside
 * it, a long string can be opened, a WKT projection can be shown as a tree,
 * a list of like objects shows its first three rows, and a small block of
 * counts reads inline. The label column is the same width at every depth.
 */

export type Entry = { key: string; value: unknown; label?: string };

/** What reads as n/a: nothing, an empty string, an empty list. */
export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

export function MetaTable({ entries, className = "" }: { entries: Entry[]; className?: string }) {
  if (!entries.length) return null;
  return (
    <table className={`sx-meta ${className}`}>
      <tbody>
        {entries.map(({ key, value, label }) => (
          <tr key={key}>
            <th scope="row">{label ?? humanize(key)}</th>
            <td>
              <Value value={value} keyName={key} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type MetaSection = {
  title: string;
  entries: Entry[];
  /** Folded behind a one-line summary until opened; the choice is remembered. */
  collapsible?: boolean;
  summary?: string;
};

/**
 * The Metadata panel: sections with their headers, empty fields hidden behind
 * one switch in the panel head, and the STAC bookkeeping folded away.
 */
export function MetadataPanel({ sections, title = "Metadata" }: { sections: MetaSection[]; title?: string }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const empty = sections.reduce((n, s) => n + s.entries.filter((e) => isEmpty(e.value)).length, 0);
  return (
    <section className="ffx-panel" aria-labelledby="meta-h" id="meta">
      <div className="ffx-panel-head">
        <h2 id="meta-h" className="ffx-panel-title">
          {title}
        </h2>
        {empty > 0 && (
          <button type="button" className="sx-linkbtn" aria-pressed={showEmpty} onClick={() => setShowEmpty(!showEmpty)}>
            {showEmpty ? "Hide" : "Show"} {empty} empty {empty === 1 ? "field" : "fields"}
          </button>
        )}
      </div>
      <div className="pb-2">
        {sections.map((s) => {
          const entries = showEmpty ? s.entries : s.entries.filter((e) => !isEmpty(e.value));
          if (!entries.length) return null;
          return s.collapsible ? (
            <Folded key={s.title} title={s.title} summary={s.summary}>
              <MetaTable entries={entries} />
            </Folded>
          ) : (
            <div key={s.title}>
              <div className="sx-meta-group">{s.title}</div>
              <MetaTable entries={entries} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Folded({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  const store = `sx-meta-open:${title}`;
  const [open, setOpen] = useState(false);
  // Read after mounting, so the server render and the first client render agree.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(store) === "1") setOpen(true);
    } catch {}
  }, [store]);
  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(store, next ? "1" : "0");
    } catch {}
  }
  return (
    <div className="sx-meta-fold">
      <button type="button" className="sx-meta-fold-head" aria-expanded={open} onClick={toggle}>
        <span className="sx-chev" aria-hidden="true" />
        <span className="sx-meta-fold-title">{title}</span>
        {summary && <span className="sx-meta-fold-sum">{summary}</span>}
      </button>
      {open && children}
    </div>
  );
}

const WKT = /^(COMPD_CS|COMPOUNDCRS|PROJCS|PROJCRS|GEOGCS|GEOGCRS|BOUNDCRS|VERT_CS|VERTCRS)\[/;
const LONG = 160;

export function Value({ value, keyName = "" }: { value: unknown; keyName?: string }): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-dim">n/a</span>;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return <span className="ffx-num">{fmtNum(value, 4)}</span>;
  }
  if (typeof value === "string") {
    // isIsoDate is a type guard, so past it TS would call the string never.
    const text: string = value;
    if (isIsoDate(text)) return <span className="ffx-num">{fmtDate(text)}</span>;
    if (/^https?:\/\//.test(value)) return <OneLine text={value} href={value} />;
    if (/^s3:\/\//.test(value)) return <OneLine text={value} mono />;
    if (WKT.test(value)) return <Wkt text={value} />;
    const parsed = looseJson(value);
    if (parsed !== undefined) return <Value value={parsed} keyName={keyName} />;
    if (value.length > LONG) return <LongText text={value} />;
    if (/^[0-9a-f]{8,}$/i.test(value) || /(_no|_cd|_id|id)$/i.test(keyName)) {
      return <span className="ffx-id">{value}</span>;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-dim">none</span>;
    if (value.every((v) => v === null || typeof v !== "object")) {
      return value.map((v, i) => (
        <span key={i}>
          {i > 0 && ", "}
          <Value value={v} keyName={keyName} />
        </span>
      ));
    }
    if (value.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
      return <MiniTable rows={value as Record<string, unknown>[]} />;
    }
    return (
      <ol className="list-decimal pl-4">
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} keyName={keyName} />
          </li>
        ))}
      </ol>
    );
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const vals = Object.values(obj);
    // A few counts ("Basins 1, Controls 2") read better inline than as a table.
    if (vals.length > 0 && vals.length <= 16 && vals.every((v) => Number.isInteger(v) && (v as number) >= 0)) {
      return (
        <span className="sx-counts">
          {Object.entries(obj).map(([k, v]) => (
            <span key={k}>
              {humanize(k)} <b className="ffx-num">{fmtNum(v as number)}</b>
            </span>
          ))}
        </span>
      );
    }
    // A lookup of names to codes is a two-column list, not a nested table.
    if (vals.length > 4 && vals.every((v) => typeof v === "string" || typeof v === "number")) {
      const head = singular(humanize(keyName.split(":").pop() ?? keyName)) || "Value";
      return <MiniTable cols={["Name", head]} rows={Object.entries(obj).map(([k, v]) => ({ Name: k, [head]: v }))} />;
    }
    const entries = Object.entries(obj).map(([key, v]) => ({ key, value: v }));
    return <MetaTable entries={entries} />;
  }
  return String(value);
}

/**
 * A string that holds JSON, or a Python dict printed into the catalog
 * (`{'b-thompson+buckhorn_j050': 'LOUDITCO', ...}`), as the object it is.
 * Anything else comes back undefined and prints as text.
 */
function looseJson(s: string): unknown {
  const t = s.trim();
  if (!/^[[{][\s\S]*[\]}]$/.test(t)) return undefined;
  for (const text of [t, t.replace(/'/g, '"').replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null")]) {
    try {
      const v = JSON.parse(text);
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return undefined;
}

function singular(s: string): string {
  return s.replace(/ies$/, "y").replace(/(?<!s)s$/, "");
}

/** A small Copy beside a value cut to one line. */
function MiniCopy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="sx-copy-mini"
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          window.prompt("Copy this", text);
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** One line, cut with an ellipsis, the whole value in its tooltip and a Copy beside it. */
function OneLine({ text, href, mono = false }: { text: string; href?: string; mono?: boolean }) {
  return (
    <span className="sx-val-line">
      {href ? (
        <a href={href} className="ffx-link sx-val-clip" title={text} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : (
        <span className={`sx-val-clip ${mono ? "ffx-id" : ""}`} title={text}>
          {text}
        </span>
      )}
      <MiniCopy text={text} />
    </span>
  );
}

function LongText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="block">
      {open ? <span className="block">{text}</span> : <OneLine text={text} />}
      <span className="sx-val-more">
        <button type="button" className="sx-linkbtn" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show all"}
        </button>
        <span>{fmtNum(text.length)} characters</span>
      </span>
    </span>
  );
}

function Wkt({ text }: { text: string }) {
  const [tree, setTree] = useState(false);
  return (
    <span className="block">
      <OneLine text={text} mono />
      {tree && <pre className="sx-wkt">{wktTree(text)}</pre>}
      <span className="sx-val-more">
        <button type="button" className="sx-linkbtn" onClick={() => setTree(!tree)}>
          {tree ? "Show as one line" : "Show as tree"}
        </button>
        <span>{wktSummary(text)}</span>
      </span>
    </span>
  );
}

/** The WKT indented by bracket depth, one keyword per line. */
function wktTree(s: string): string {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (quoted) {
      out += ch;
      continue;
    }
    if (ch === "[") {
      depth++;
      out += ch;
    } else if (ch === "]") {
      depth--;
      out += ch;
    } else if (ch === ",") {
      // A new keyword starts a line; a plain argument stays on this one.
      out += ",";
      out += "\n" + "  ".repeat(depth);
    } else out += ch;
  }
  // Fold runs of bare arguments back onto their keyword's line.
  return out.replace(/,\n\s+(?=[-\d."])/g, ", ");
}

/** "Albers equal area · NAD83 · NAVD88 ft · 2,194 characters", from whatever the WKT names. */
function wktSummary(s: string): string {
  const parts: string[] = [];
  const method = /(?:METHOD|PROJECTION)\["([^"]+)"/.exec(s)?.[1];
  if (method) {
    const m = method.replace(/_/g, " ").replace(/\bconic\b/i, "").replace(/\s+/g, " ").trim().toLowerCase();
    const named = /albers/.test(m) ? "Albers equal area" : m.charAt(0).toUpperCase() + m.slice(1);
    parts.push(named);
  }
  const datum = /DATUM\["([^"]+)"/.exec(s)?.[1];
  if (datum) {
    const d = datum.replace(/_/g, " ");
    parts.push(
      /north american/i.test(d) && /1983/.test(d) ? "NAD83" : /north american/i.test(d) && /1927/.test(d) ? "NAD27" : /wgs.?84|world geodetic.*1984/i.test(d) ? "WGS84" : d,
    );
  }
  if (/NAVD.?88/i.test(s)) parts.push(/foot|ftUS|\bft\b/i.test(s) ? "NAVD88 ft" : "NAVD88");
  parts.push(`${fmtNum(s.length)} characters`);
  return parts.join(" · ");
}

/** A list of like objects in a bordered table, its first three rows until asked for the rest. */
function MiniTable({ rows, cols, cap = 3 }: { rows: Record<string, unknown>[]; cols?: string[]; cap?: number }) {
  const [all, setAll] = useState(false);
  const columns = cols ?? columnsOf(rows);
  const shown = all ? rows : rows.slice(0, cap);
  return (
    <div className="sx-mini">
      <div className="ffx-table-wrap">
        <table className="sx-mini-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{humanize(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className={typeof r[c] === "number" ? "ffx-r ffx-num" : ""}>
                    {typeof r[c] === "string" && /^[A-Z0-9_-]{4,}$/.test(r[c] as string) ? (
                      <span className="ffx-id">{r[c] as string}</span>
                    ) : (
                      <Value value={r[c]} keyName={c} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > cap && (
        <button type="button" className="sx-mini-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${fmtNum(rows.length)}`}
        </button>
      )}
    </div>
  );
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  const all = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  // The column that names the row (a period, an id, a date) reads first.
  const leads = all.filter((c) => /period|date|time|^id$|_id$|name|key/i.test(c));
  return [...leads, ...all.filter((c) => !leads.includes(c))];
}

/** A list of like objects as a grid: one column per key seen in any row. */
export function Grid({ rows, max = 100 }: { rows: Record<string, unknown>[]; max?: number }) {
  const cols = columnsOf(rows);
  const shown = rows.slice(0, max);
  return (
    <div className="ffx-table-wrap">
      <table className="ffx-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{humanize(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className={typeof r[c] === "number" ? "ffx-r ffx-num" : ""}>
                  <Value value={r[c]} keyName={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && (
        <p className="px-2.5 py-1.5 text-micro text-ink-mut">
          First {max} of {rows.length} rows.
        </p>
      )}
    </div>
  );
}
