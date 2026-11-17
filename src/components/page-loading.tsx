import type { ReactNode } from "react";
import { Chevron, Icon, ICONS } from "./icons";
import { HOME_LABEL } from "./shell";
import { Skel } from "./spinner";

/**
 * A page while its data loads: what the loading.tsx files beside the
 * collection, item and Admin pages show.
 *
 * Those pages wait on the catalog. Most of the time that's memory, but the
 * first read after a QC save rebuilds it, and from S3 that can take
 * seconds. Without a loading state Next holds the old page on screen until
 * the new one is ready, so a click on a collection, or a save in Admin, looked
 * like nothing had happened.
 *
 * Each page gets its own outline here, built from the same panels, rows
 * and tables as the real page, so the real one lands on top of it without
 * anything moving: the trail and title, then the two columns in the order
 * the page has them. What's the same on every such page is real (panel
 * titles, the first crumb); what depends on the data is a gray bar.
 *
 * The outline is drawn for the eye only. It's hidden from screen readers,
 * which get one line saying what's loading, and nothing in it takes focus,
 * so focus has nowhere to fall from when the page replaces it. It fades in
 * after a moment (styles/loading.css), so a page that's ready at once
 * doesn't flash gray on the way.
 */

/** The frame every page outline sits in: the page's grid, the spoken line, and the outline hidden from screen readers. */
function LoadingPage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sx-page sx-loading-page" aria-busy="true">
      <p className="sr-only" role="status">
        {label}
      </p>
      <div className="sx-loading-outline" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/**
 * The top of the page: the trail from home, the title and its facts, and
 * the page's buttons at the right. A page whose name is known ahead of the
 * data (Admin) passes it; the rest get a bar.
 */
function HeadOutline({ name, facts, actions = 0 }: { name?: string; facts: string[]; actions?: number }) {
  return (
    <div className="sx-head">
      <div className="sx-crumbs">
        <ol>
          <li>
            <span>
              <span className="sx-crumb-label">{HOME_LABEL}</span>
            </span>
          </li>
          <li>
            <Icon d={ICONS.chevronRight} size={10} />
            <span>{name ? <span className="sx-crumb-label">{name}</span> : <Skel w="9rem" />}</span>
          </li>
        </ol>
      </div>
      <div className="sx-title-line">
        <div className="sx-title">{name ?? <Skel w="min(15rem, 60vw)" />}</div>
        <div className="sx-subtitle">
          {facts.map((w, i) => (
            <Skel key={i} w={w} />
          ))}
        </div>
      </div>
      {actions > 0 && (
        <div className="sx-actions">
          <div className="sx-action-group sx-actions-wide">
            {[4.4, 6, 5.75].slice(0, actions).map((w) => (
              <span key={w} className="sx-skel-btn" style={{ width: `${w}rem` }} />
            ))}
          </div>
          <span className="sx-skel-btn sx-skel-more" />
        </div>
      )}
    </div>
  );
}

/** A panel with its real title and nothing in its note. */
function PanelOutline({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="ffx-panel">
      <div className="ffx-panel-head">
        <div className="ffx-panel-title">{title}</div>
        {note && (
          <div className="ffx-panel-note">
            <Skel w={note} />
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** The map's card: the frame at the map's height, the zoom buttons' place, and the line under it. */
function MapOutline() {
  return (
    <div className="sx-mapcard">
      <div className="ffx-map">
        <div className="ffx-map-canvas sx-skel-map" />
        <div className="ffx-map-readout">
          <Skel w="5rem" />
        </div>
      </div>
    </div>
  );
}

/** A search or sort field with nothing in it yet. */
function FieldOutline({ search, className = "", width }: { search?: boolean; className?: string; width?: string }) {
  return (
    <span className={`ffx-field sx-skel-field ${search ? "" : "ffx-field-select"} ${className}`} style={width ? { width } : undefined}>
      {search && (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

/** List rows: a name over a line of facts, as the items and the collections inside a catalog are listed. */
function RowsOutline({ names, desc }: { names: string[]; desc?: boolean }) {
  return (
    <div className="sx-rows">
      {names.map((w, i) => (
        <div key={i} className="sx-row">
          <div className="sx-row-main">
            <div className="sx-row-title">
              <Skel w={w} />
            </div>
            <div className="sx-row-sub">
              <Skel w="4.5rem" />
              <Skel w="9rem" />
            </div>
            {desc && (
              <div className="sx-row-desc">
                <Skel w="85%" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Metadata rows: a field's name and its value. */
function MetaOutline({ values }: { values: string[] }) {
  return (
    <table className="sx-meta">
      <tbody>
        {values.map((w, i) => (
          <tr key={i}>
            <th>
              <Skel w={`${[4, 6.5, 5, 7.5, 5.5, 6][i % 6]}rem`} />
            </th>
            <td>
              <Skel w={w} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ITEM_NAMES = ["46%", "34%", "52%", "30%", "42%", "38%"];

/**
 * A collection's page: the list on the left (the description, folded, then
 * the items) and the map on the right over the metadata. A catalog's page
 * shares the address, and there's no telling which it is until the catalog
 * is read; it gets this outline too, and its left column is close.
 */
export function CollectionLoading() {
  return (
    <LoadingPage label="Loading from the catalog…">
      <HeadOutline facts={["4.5rem", "10rem", "6rem"]} actions={3} />
      <div className="sx-cols sx-collection-cols">
        <div className="sx-col">
          <div className="ffx-panel sx-collapsible-panel">
            <div className="ffx-panel-head sx-skel-summary">
              <Chevron />
              <div className="ffx-panel-title">Description</div>
            </div>
          </div>
          <PanelOutline title="Items" note="1.5rem">
            <div className="ffx-toolbar">
              <FieldOutline search className="min-w-0 flex-[1_1_12rem] sm:max-w-xs" />
              <FieldOutline className="ml-auto" width="8.875rem" />
            </div>
            <RowsOutline names={ITEM_NAMES} />
          </PanelOutline>
        </div>
        <div className="sx-col">
          <MapOutline />
          <PanelOutline title="Metadata">
            <div className="pb-2">
              <MetaOutline values={["7rem", "3rem", "2.5rem", "62%", "45%"]} />
            </div>
          </PanelOutline>
        </div>
      </div>
    </LoadingPage>
  );
}

/** An item's page: the map over its assets on the left, its collection and metadata on the right. */
export function ItemLoading() {
  return (
    <LoadingPage label="Loading the item…">
      <HeadOutline facts={["9rem", "5.5rem", "4.5rem"]} actions={3} />
      <div className="sx-cols">
        <div className="sx-col">
          <MapOutline />
          <PanelOutline title="Assets" note="1.5rem">
            <div className="sx-alist">
              <div className="sx-alist-bar">
                <span className="sx-afilter sx-skel-field" />
              </div>
              <div className="sx-arows">
                {["9rem", "12rem", "7rem", "11rem", "8rem", "13rem", "10rem", "6rem"].map((w) => (
                  <div key={w} className="sx-arow-wrap">
                    <div className="sx-arow">
                      <div className="sx-arow-line">
                        <Chevron />
                        <span className="sx-arow-file">
                          <Skel w={w} />
                        </span>
                        <span className="sx-arow-roles">
                          <Skel w="3rem" />
                        </span>
                        <span className="sx-arow-size">
                          <Skel w="2.5rem" />
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PanelOutline>
        </div>
        <div className="sx-col">
          <PanelOutline title="Collection">
            <RowsOutline names={["11rem"]} desc />
          </PanelOutline>
          <PanelOutline title="Metadata">
            <div className="pb-2">
              <div className="sx-meta-group">
                <Skel w="4rem" />
              </div>
              <MetaOutline values={["11rem", "9rem"]} />
              <div className="sx-meta-group">
                <Skel w="5.5rem" />
              </div>
              <MetaOutline values={["70%", "8rem", "7rem", "3rem", "4.5rem", "55%"]} />
            </div>
          </PanelOutline>
        </div>
      </div>
    </LoadingPage>
  );
}

/**
 * Admin: the four counts, the queue with its tabs and tools, and recent
 * activity beside it. The queue is a table on a wide screen and cards on a
 * narrow one; these rows stand for either.
 */
export function AdminLoading() {
  return (
    <LoadingPage label="Loading Admin…">
      <HeadOutline name="Admin" facts={["12rem"]} />
      <div className="sx-admin-stack">
        <dl className="sx-stats sx-admin-stats">
          {["9rem", "7rem", "5rem", "10rem"].map((w, i) => (
            <div key={w} className="sx-stat">
              <dt>
                <Skel w={`min(${w}, 80%)`} />
              </dt>
              <dd>
                <Skel w="2rem" />
              </dd>
              {i === 0 && (
                <dd className="sx-stat-note">
                  <Skel w="3.5rem" />
                </dd>
              )}
            </div>
          ))}
        </dl>
        <div className="sx-admin">
          <PanelOutline title="Review queue">
            <div className="ffx-tabs">
              <div className="ffx-tabs-list">
                {["4.5rem", "6.5rem", "4.25rem", "4.75rem", "2rem"].map((w) => (
                  <span key={w} className="ffx-tab">
                    <Skel w={w} />
                  </span>
                ))}
              </div>
            </div>
            <div className="ffx-toolbar sx-queue-tools">
              <FieldOutline search className="min-w-0 flex-1 sm:max-w-xs" />
              <FieldOutline width="9.75rem" />
              <FieldOutline width="11.75rem" />
            </div>
            <div className="sx-skel-queue">
              <div className="sx-skel-qhead" />
              {["9rem", "7rem", "12rem", "11rem", "17rem", "14rem"].map((w) => (
                <div key={w} className="sx-skel-qrow">
                  <span className="sx-skel-check" />
                  <div className="sx-skel-qname">
                    <div className="sx-row-title">
                      <Skel w={`min(${w}, 90%)`} />
                    </div>
                    <div className="sx-row-sub">
                      <Skel w="6rem" />
                    </div>
                  </div>
                  <div className="sx-skel-qfacts">
                    <Skel w="2rem" />
                    <Skel w="4rem" />
                    <Skel w="7.5rem" />
                  </div>
                  <span className="sx-skel-btn" style={{ width: "3.9rem" }} />
                </div>
              ))}
            </div>
          </PanelOutline>
          <div className="ffx-panel sx-activity-panel">
            <div className="ffx-panel-head">
              <div className="ffx-panel-title">Recent activity</div>
            </div>
            <div className="sx-activity-list sx-skel-activity">
              {["80%", "65%", "72%"].map((w) => (
                <div key={w}>
                  <Skel w={w} />
                  <Skel w="5rem" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </LoadingPage>
  );
}
