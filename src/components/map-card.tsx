import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, ICONS } from "./icons";

/**
 * The card a click on a map opens, on the landing map and the collection
 * page alike: each item under the click is one row, and the whole row opens
 * the item, so the card needs no buttons. A long stack scrolls. On the
 * landing map a tinted band on top names the collection the items are in,
 * with the way to it; the collection page is already that collection, so
 * it has no band.
 */

export type MapCardRow = {
  id: string;
  label?: string;
  /** "HEC-HMS" or "HEC-RAS" where a collection mixes kinds. */
  kind?: string | null;
  tint?: 1 | 2 | 3;
  /** The label already says the id ("Storm event 1"). */
  hideId?: boolean;
  href: string;
};

export function MapCard({
  head,
  action,
  note,
  rows,
}: {
  head?: ReactNode;
  action?: { href: string; label: string };
  /** What to say in place of the rows, when the map can't name the items. */
  note?: ReactNode;
  rows: MapCardRow[];
}) {
  return (
    <div className="sx-card">
      {head && (
        <div className="sx-card-head">
          <span className="sx-card-name">{head}</span>
          {action && (
            <Link href={action.href} className="ffx-link sx-card-open">
              {action.label}
            </Link>
          )}
        </div>
      )}
      {(note || rows.length > 0) && (
        <div className="sx-card-body">
          {note && !rows.length && <div className="sx-card-label">{note}</div>}
          {rows.length > 0 && (
            <ul className="sx-card-items">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={r.href} className="sx-card-item">
                    {r.tint && <i className="sx-swatch" data-step={r.tint} aria-hidden="true" />}
                    {r.kind && <span className="ffx-map-tip-kind">{r.kind}</span>}
                    {r.label && <span className="sx-card-item-name">{r.label}</span>}
                    {!(r.label && r.hideId) && <span className="ffx-id sx-card-item-id">{r.id}</span>}
                    <Icon d={ICONS.chevronRight} size={12} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
