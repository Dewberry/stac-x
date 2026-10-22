"use client";

import { useState } from "react";
import { Chevron } from "./icons";
import { fmtDate, fmtNum, humanize, isIsoDate } from "@/lib/format";
import { orderColumns, type ColumnKind, type TablePreview } from "@/lib/data-preview";

/**
 * The rows of a parquet file as a table: the collection's Data panel shows
 * a few of them, and the preview dialog behind an asset row shows more.
 * Both scroll inside whatever holds them; the header row and the first
 * column (usually the id) stay put so a wide table can be read across.
 * Hovering a column's name says what it holds.
 *
 * Numbers sit right and are formatted, timestamps read as dates, an empty
 * cell is a dash, and a structure in a cell is folded into what it holds
 * ("4 fields", "Point"). One fold opens at a time, into a drawer row under
 * its own row with the JSON, so the table keeps its shape around it.
 */
export function DataTable({ data, limit }: { data: TablePreview; limit?: number }) {
  const rows = limit ? data.rows.slice(0, limit) : data.rows;
  const cols = orderColumns({ ...data, rows });
  const [open, setOpen] = useState<{ row: number; col: string } | null>(null);
  return (
    <table className="ffx-table sx-dt">
      <thead>
        <tr>
          <th className="sx-dt-n" aria-label="Row" />
          {cols.map((c) => (
            <th key={c} className={data.kinds[c] === "number" ? "ffx-r" : undefined} title={data.kinds[c]}>
              {humanize(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const drawer = open?.row === i ? open.col : null;
          return (
            <Row key={i} n={i} cols={cols} row={r} kinds={data.kinds} drawer={drawer} onFold={(col) => setOpen(drawer === col ? null : { row: i, col })} />
          );
        })}
      </tbody>
    </table>
  );
}

function Row({
  n,
  cols,
  row,
  kinds,
  drawer,
  onFold,
}: {
  n: number;
  cols: string[];
  row: Record<string, unknown>;
  kinds: Record<string, ColumnKind>;
  drawer: string | null;
  onFold: (col: string) => void;
}) {
  const value = drawer ? row[drawer] : null;
  const text = value && typeof value === "object" ? JSON.stringify(value, null, 1) : "";
  return (
    <>
      <tr>
        <td className="sx-dt-n ffx-num">{n + 1}</td>
        {cols.map((c) => (
          <Cell key={c} name={c} kind={kinds[c]} value={row[c]} open={drawer === c} onFold={() => onFold(c)} />
        ))}
      </tr>
      {drawer && (
        <tr className="sx-dt-drawer">
          <td colSpan={cols.length + 1}>
            <div className="sx-dt-drawer-label">
              {humanize(drawer)} · row {fmtNum(n + 1)}
            </div>
            <pre>{text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function Cell({ name, kind, value, open, onFold }: { name: string; kind?: ColumnKind; value: unknown; open: boolean; onFold: () => void }) {
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
      <button type="button" className="sx-fold" aria-expanded={open} onClick={onFold}>
        <Chevron /> {whatsIn(name, value)}
      </button>
    </td>
  );
}

/** What a structure in a cell holds: "4 fields", "3 items", "Point", "binary, 1,024 bytes". */
function whatsIn(name: string, value: object): string {
  if (Array.isArray(value)) {
    const bytes = name === "geometry" && value.every((x) => typeof x === "number");
    return bytes ? `binary, ${fmtNum(value.length)} bytes` : `${fmtNum(value.length)} ${value.length === 1 ? "item" : "items"}`;
  }
  if ("type" in value && typeof value.type === "string" && "coordinates" in value) return value.type;
  const n = Object.keys(value).length;
  return `${fmtNum(n)} ${n === 1 ? "field" : "fields"}`;
}
