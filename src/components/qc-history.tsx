import { envMeta } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { qcMeta, type QcEvent } from "@/lib/stac";

/** What happened to a collection in this environment, newest first, on a rail. */
export function QcHistory({ events }: { events: QcEvent[] }) {
  return (
    <ol className="sx-history">
      {events.map((ev, i) => (
        <li key={`${ev.at}-${i}`} data-tone={ev.kind === "qc" ? qcMeta(ev.qc).tone : undefined}>
          <span className="sx-history-head">
            <b className="sx-history-what">
              {ev.kind === "qc" && <>Set to {qcMeta(ev.qc).label}</>}
              {ev.kind === "promoted" && <>Sent to {envMeta(ev.to).label}</>}
              {ev.kind === "received" && <>Arrived from {envMeta(ev.from).label}</>}
            </b>
            <span className="sx-history-when ffx-num">{fmtDate(ev.at)}</span>
          </span>
          {ev.kind === "qc" && (ev.note || ev.date_approved) && (
            <span className="sx-history-note">
              {ev.date_approved && ev.qc === "approved" ? `Approval dated ${ev.date_approved}. ` : ""}
              {ev.note}
            </span>
          )}
          {ev.kind !== "qc" && <span className="sx-history-note ffx-id">{ev.files.join(", ")}</span>}
        </li>
      ))}
    </ol>
  );
}
