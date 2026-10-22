"use client";

import { useState } from "react";
import { Chevron } from "./icons";
import { fmtNum } from "@/lib/format";

/**
 * A JSON document as a tree you can read: one line per field, the nested
 * ones folding with a count of what's inside ("12 fields", "3 items") so a
 * collection's links and assets don't bury its title. The top levels start
 * open; a short array of plain values sits on one line, since a bbox or a
 * pair of coordinates reads better that way than as four rows. A long
 * array shows its first hundred and offers the rest.
 */
const OPEN_DEPTH = 1;
const SHOW = 100;

export function JsonTree({ value }: { value: unknown }) {
  return <div className="sx-json">{isComposite(value) ? <Kids value={value} depth={0} /> : <Leaf value={value} />}</div>;
}

function isComposite(v: unknown): v is object {
  return v !== null && typeof v === "object";
}

/** A few plain values, short enough to read on one line. */
function isInline(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length <= 8 && v.every((x) => !isComposite(x)) && JSON.stringify(v).length <= 120;
}

function whatsIn(v: object): string {
  if (Array.isArray(v)) return v.length ? `${fmtNum(v.length)} ${v.length === 1 ? "item" : "items"}` : "empty";
  if ("type" in v && typeof v.type === "string" && "coordinates" in v) return v.type;
  const n = Object.keys(v).length;
  return n ? `${fmtNum(n)} ${n === 1 ? "field" : "fields"}` : "empty";
}

/**
 * What to show beside a folded object so a list of them can be scanned: a
 * link's rel and title, an asset's title, a provider's name.
 */
const HINTS = ["rel", "title", "name", "id", "href"];
function hintOf(v: object): string | null {
  if (Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const parts = HINTS.filter((k) => typeof o[k] === "string" && o[k] !== "").map((k) => o[k] as string);
  if (!parts.length) return null;
  const hint = parts.slice(0, 2).join(" · ");
  return hint.length > 80 ? `${hint.slice(0, 79)}…` : hint;
}

function Kids({ value, depth }: { value: object; depth: number }) {
  const [all, setAll] = useState(false);
  const list = Array.isArray(value);
  const entries = list ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const shown = all ? entries : entries.slice(0, SHOW);
  return (
    <>
      {shown.map(([k, v]) => (
        <Entry key={k} k={k} value={v} depth={depth} index={list} />
      ))}
      {entries.length > shown.length && (
        <button type="button" className="sx-json-more" onClick={() => setAll(true)}>
          Show all {fmtNum(entries.length)} items
        </button>
      )}
    </>
  );
}

function Entry({ k, value, depth, index }: { k: string; value: unknown; depth: number; index: boolean }) {
  const key = <span className={index ? "sx-json-idx" : "sx-json-key"}>{k}</span>;
  if (isComposite(value) && !isInline(value)) {
    const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
    if (empty) {
      return (
        <div className="sx-json-row">
          {key} <span className="sx-json-lit">{Array.isArray(value) ? "[]" : "{}"}</span>
        </div>
      );
    }
    const hint = hintOf(value);
    return (
      <details className="sx-json-node" open={depth < OPEN_DEPTH}>
        <summary>
          <Chevron />
          {key} <span className="sx-json-badge">{whatsIn(value)}</span>
          {hint && <span className="sx-json-hint">{hint}</span>}
        </summary>
        <div className="sx-json-kids">
          <Kids value={value} depth={depth + 1} />
        </div>
      </details>
    );
  }
  return (
    <div className="sx-json-row">
      {key} <Leaf value={value} />
    </div>
  );
}

function Leaf({ value }: { value: unknown }) {
  if (isInline(value)) {
    return (
      <span className="sx-json-inline">
        [
        {value.map((v, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <Leaf value={v} />
          </span>
        ))}
        ]
      </span>
    );
  }
  if (typeof value === "string") {
    if (/^https?:\/\/\S+$/.test(value)) {
      return (
        <a className="sx-json-str" href={value} target="_blank" rel="noreferrer">
          {value}
        </a>
      );
    }
    return <span className="sx-json-str">&quot;{value}&quot;</span>;
  }
  if (typeof value === "number") return <span className="sx-json-num ffx-num">{String(value)}</span>;
  if (value === null || value === undefined) return <span className="sx-json-lit">null</span>;
  if (typeof value === "boolean") return <span className="sx-json-lit">{String(value)}</span>;
  return <span className="sx-json-str">{JSON.stringify(value)}</span>;
}
