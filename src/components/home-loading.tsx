import { basinOutline } from "@/lib/basin-outline";
import { ColHead } from "./col-head";
import { RailToggle } from "./home-rail";

/**
 * The landing page while its catalog loads. The real page waits on every
 * collection in the environment, which from S3 can take seconds, and until
 * now that wait was a blank page. This stands in with the same console
 * shape: the three headers, placeholder rows in the rail and the collection
 * card, and the basin traced where the map goes. Next streams the real page
 * in over it.
 */
export function HomeLoading() {
  const basin = basinOutline();
  const rows = (widths: number[]) => (
    <ul className="sx-loading-rows" aria-hidden="true">
      {widths.map((w, i) => (
        <li key={i} style={{ "--w": `${w}%` } as React.CSSProperties}>
          <i />
          <b />
          <s />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="sx-page sx-home" aria-busy="true">
      <div className="sx-console">
        {/* The same head as the console's, inert: these controls are
            always there, so they're here before the rows are. */}
        <ColHead
          id="col-rail-h"
          title="Collections"
          actions={
            <>
              <div className="sx-group-switch" role="group" aria-label="Group by">
                <span className="sx-group-switch-l" aria-hidden="true">Group by</span>
                <button type="button" aria-pressed="true" disabled>
                  Kind
                </button>
                <button type="button" aria-pressed="false" disabled>
                  Review
                </button>
              </div>
              <RailToggle open disabled />
            </>
          }
        />
        <section className="ffx-panel sx-rail" aria-labelledby="col-rail-h">
          <div className="sx-rail-head">
            <label className="ffx-field">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search collections</span>
              <input type="search" placeholder="Search collections" disabled />
            </label>
          </div>
          {rows([58, 44, 66, 38, 52, 46])}
        </section>
        <div className="sx-pane">
          <ColHead className="sx-pane-head" title={<span className="sx-loading-title" aria-hidden="true" />} label="Loading the catalog" />
          <ColHead className="sx-map-head" title="Map" />
          <div className="sx-pane-side">
            <section className="ffx-panel sx-console-map sx-loading-map" aria-label="Map">
              <svg className="sx-loading-basin" viewBox={basin.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <path className="sx-loading-basin-under" d={basin.d} />
                <path className="sx-loading-basin-trace" d={basin.d} pathLength={1} />
              </svg>
              <p className="sx-loading-status" role="status">
                Loading the catalog…
              </p>
            </section>
          </div>
          <section className="ffx-panel sx-items" aria-label="Collection">
            {rows([66, 48, 58, 40, 52])}
          </section>
        </div>
      </div>
    </div>
  );
}
