import { basinOutline } from "@/lib/basin-outline";

/**
 * The landing page while its catalog loads. The real page waits on every
 * collection in the environment, which from S3 can take seconds, and until
 * now that wait was a blank page. This stands in with the same console
 * shape: the basin traced where the map goes, and placeholder rows in the
 * rail. Next streams the real page in over it.
 */
export function HomeLoading() {
  const basin = basinOutline();
  return (
    <div className="sx-home" aria-busy="true">
      <div className="sx-console">
        <div className="sx-console-map sx-loading-map">
          <svg className="sx-loading-basin" viewBox={basin.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <path className="sx-loading-basin-under" d={basin.d} />
            <path className="sx-loading-basin-trace" d={basin.d} pathLength={1} />
          </svg>
          <p className="sx-loading-status" role="status">
            Loading the catalog…
          </p>
        </div>
        <aside className="sx-rail" aria-label="Collections">
          {/* The same head as the console's, inert: these controls are
              always there, so they're here before the rows are. */}
          <div className="sx-rail-head">
            <div className="sx-rail-title">
              <h2>Collections</h2>
              <div className="sx-group-switch" role="group" aria-label="Group by">
                <span className="sx-group-switch-l" aria-hidden="true">Group by</span>
                <button type="button" aria-pressed="true" disabled>
                  Kind
                </button>
                <button type="button" aria-pressed="false" disabled>
                  Review
                </button>
              </div>
            </div>
            <label className="ffx-field">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search collections</span>
              <input type="search" placeholder="Search collections" disabled />
            </label>
          </div>
          <ul className="sx-rail-list sx-loading-rows" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} style={{ "--w": `${[58, 44, 66, 38, 52, 46][i]}%` } as React.CSSProperties}>
                <i />
                <b />
                <s />
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
