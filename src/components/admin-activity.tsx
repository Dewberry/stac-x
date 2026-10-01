import Link from "next/link";
import { envMeta } from "@/lib/env";
import { fmtAgo, fmtDate } from "@/lib/format";
import { qcMeta, type QcEvent } from "@/lib/stac";

export type ActivityRow = { collection: string; title: string; href: string | null; event: QcEvent };

/**
 * What happened, newest first, each line marked like the QC chips. On the
 * Admin page it's every collection's history merged; `bare` is one
 * collection's, inside the review sheet, where its name would repeat.
 */
export function AdminActivity({ rows, now, bare = false }: { rows: ActivityRow[]; now: number; bare?: boolean }) {
  if (rows.length === 0) return <p className="sx-empty">Nothing has been reviewed or moved in this environment yet.</p>;
  return (
    <ol className="sx-activity" data-bare={bare || undefined}>
      {rows.map(({ collection, title, href, event: ev }, i) => (
        <li key={`${collection}-${ev.at}-${i}`} data-tone={ev.kind === "qc" ? qcMeta(ev.qc).tone : "move"}>
          {!bare &&
            (href ? (
              <Link href={href} className="sx-activity-title">
                {title}
              </Link>
            ) : (
              <span className="sx-activity-title">{title}</span>
            ))}
          <span className="sx-activity-what">
            {ev.kind === "qc" && (
              <span>
                Set to <b>{qcMeta(ev.qc).label}</b>
              </span>
            )}
            {ev.kind === "promoted" && (
              <span>
                Sent to <b>{envMeta(ev.to).label}</b>
              </span>
            )}
            {ev.kind === "received" && (
              <span>
                Arrived from <b>{envMeta(ev.from).label}</b>
              </span>
            )}
            <span className="sx-activity-when ffx-num" title={fmtDate(ev.at)}>
              {fmtAgo(ev.at, now)}
            </span>
          </span>
          {ev.kind === "qc" && ev.note && <span className="sx-history-note">{ev.note}</span>}
        </li>
      ))}
    </ol>
  );
}
