import { envMeta } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { qcMeta, type QcEvent } from "@/lib/stac";

/** What happened to a collection in this environment, newest first. */
export function QcHistory({ events }: { events: QcEvent[] }) {
  return (
    <ol className="sx-history">
      {events.map((ev, i) => (
        <li key={`${ev.at}-${i}`}>
          <span className="sx-history-when ffx-num">{fmtDate(ev.at)}</span>
          <span className="sx-history-what">
            {ev.kind === "qc" && (
              <>
                QC set to <b>{qcMeta(ev.qc).label}</b>
                {ev.date_approved ? `, approved ${ev.date_approved}` : ""}
                {ev.note && <span className="sx-history-note">{ev.note}</span>}
              </>
            )}
            {ev.kind === "promoted" && (
              <>
                Sent to <b>{envMeta(ev.to).label}</b>
                <span className="sx-history-note ffx-id">{ev.files.join(", ")}</span>
              </>
            )}
            {ev.kind === "received" && (
              <>
                Arrived from <b>{envMeta(ev.from).label}</b>
                <span className="sx-history-note ffx-id">{ev.files.join(", ")}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
