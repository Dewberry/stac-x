import { fmtDate, fmtNum, humanize, isIsoDate } from "@/lib/format";
import type { ReactNode } from "react";

/**
 * Any JSON, as key beside value. Strings, numbers and dates print; an object
 * becomes a nested table; a list of objects becomes a small grid with a column
 * per key; a list of scalars is a comma-separated line. STAC item properties
 * are mostly flat, but the gage rows carry a struct or two, and an asset can
 * carry a whole table under file:values.
 */

export type Entry = { key: string; value: unknown; label?: string };

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

export function Value({ value, keyName = "" }: { value: unknown; keyName?: string }): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-dim">n/a</span>;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return <span className="ffx-num">{fmtNum(value, 4)}</span>;
  }
  if (typeof value === "string") {
    if (isIsoDate(value)) return <span className="ffx-num">{fmtDate(value)}</span>;
    if (/^(https?:\/\/)/.test(value)) {
      return (
        <a href={value} className="ffx-link" target="_blank" rel="noreferrer">
          {value}
        </a>
      );
    }
    if (/^s3:\/\//.test(value) || /^[0-9a-f]{8,}$/i.test(value) || /(_no|_cd|_id|id)$/i.test(keyName)) {
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
      return <Grid rows={value as Record<string, unknown>[]} />;
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
    const entries = Object.entries(value as Record<string, unknown>).map(([key, v]) => ({ key, value: v }));
    return <MetaTable entries={entries} />;
  }
  return String(value);
}

/** A list of like objects as a grid: one column per key seen in any row. */
export function Grid({ rows, max = 100 }: { rows: Record<string, unknown>[]; max?: number }) {
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
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
