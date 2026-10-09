import { QC_STATUSES, type QcStatus } from "@/lib/stac";
import type { HomeArea } from "./home";

/**
 * The review state as a mark on the landing page: filled in the state's
 * color, or a hollow ring for not reviewed, so "nobody has looked" reads
 * without color. The same mark is used on the pins, the rail rows, the
 * filter buttons and the map legend.
 */
export function QcMark({ state }: { state: QcStatus }) {
  return <span className="sx-qc-mark" data-qc={state} aria-hidden="true" />;
}

export const stateOf = (a: Pick<HomeArea, "qc">): QcStatus => a.qc?.qc ?? "pending";

/** The order of the review menu, its phone buttons and the review bar. */
export const STATE_ORDER: QcStatus[] = ["approved", "needs_revision", "rejected", "pending"];

export const QC_LABEL = Object.fromEntries(QC_STATUSES.map((s) => [s.value, s.label])) as Record<QcStatus, string>;
