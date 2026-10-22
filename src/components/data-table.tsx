"use client";

import { useState, type ReactNode } from "react";
import { fmtDate, fmtNum, humanize, isIsoDate } from "@/lib/format";
import { orderColumns, type ColumnKind, type TablePreview } from "@/lib/data-preview";

/**
 * The rows of a parquet file as a table: the collection's Data panel shows
 * a few of them, and the preview dialog behind an asset row shows more.
 * Both scroll inside whatever holds them; the header row and the first
 * column (usually the id) stay put so a wide table can be read across.
 *
 * Each column says what it holds under its name. Numbers sit right and are
 * formatted, timestamps read as dates, an empty cell is a dash, and a
 * structure in a cell is folded into what it holds, opening to its JSON on
 * request, since a page of nested JSON says nothing at a glance.
 */
export function DataTable({ data, limit }: { data: TablePreview; limit?: number }) {
  const cols = orderColumns(data);
  const rows = limit ? data.rows.slice(0, limit) : data.rows;
  return (
    <table className="ffx-table sx-dt">
      <thead>
        <tr>
          <th className="sx-dt-n" aria-label="Row" />
          {cols.map((c) => (
            <th key={c} className={data.kinds[c] === "number" ? "ffx-r" : undefined}>
              <span className="sx-dt-name">{humanize(c)}</span>
              {data.kinds[c] && <span className="sx-dt-kind">{data.kinds[c]}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="sx-dt-n ffx-num">{i + 1}</td>
            {cols.map((c) => (
              <Cell key={c} name={c} kind={data.kinds[c]} value={r[c]} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cell({ name, kind, value }: { name: string; kind?: ColumnKind; value: unknown }) {
  if (value === null || value === undefined || value === "") return <td className="sx-dt-empty">–</td>;
  if (typeof value === "number") return <td className="ffx-r ffx-num">{fmtNum(value, 4)}</td>;
  if (typeof value === "boolean") return <td className="ffx-num">{value ? "true" : "false"}</td>;
  if (typeof value !== "object") {
    const s = String(value);
    if ((kind === "timestamp" || kind === "date") && isIsoDate(s)) return <td className="ffx-num">{fmtDate(s)}</td>;
    return (
      <td className={name === "id" ? "ffx-id" : undefined} title={s.length > 40 ? s : undefined}>
        {s}
      </td>
    );
  }
  return (
    <td>
      <Fold name={name} value={value} />
    </td>
  );
}

/** A structure in a cell: what it holds, and its JSON on request. */
function Fold({ name, value }: { name: string; value: object }) {
  const [open, setOpen] = useState(false);
  let what: ReactNode;
  if (Array.isArray(value)) {
    const bytes = name === "geometry" && value.every((x) => typeof x === "number");
    what = bytes ? `binary, ${fmtNum(value.length)} bytes` : `${fmtNum(value.length)} ${value.length === 1 ? "item" : "items"}`;
  } else if ("type" in value && typeof value.type === "string" && "coordinates" in value) {
    what = value.type;
  } else {
    const n = Object.keys(value).length;
    what = `${fmtNum(n)} ${n === 1 ? "field" : "fields"}`;
  }
  const text = JSON.stringify(value, null, 1);
  return (
    <>
      <button type="button" className="sx-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {"{…}"} {what}
      </button>
      {open && <pre className="sx-fold-body">{text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text}</pre>}
    </>
  );
}
