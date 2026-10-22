import { areaOutline, mapArea } from "@/lib/map-area";

/**
 * The landing page while its catalog loads. The real page waits on every
 * collection in the environment, which from S3 can take seconds, and until
 * now that wait was a blank page. This stands in with the same console
 * shape: the deployment's area traced where the map goes (when one is set),
 * and placeholder rows in the rail. Next streams the real page in over it.
 */
export function HomeLoading() {
  const area = mapArea();
  const outline = area && areaOutline(area);
  return (
    <div className="sx-home" aria-busy="true">
      <div className="sx-console">
        <div className="sx-console-map sx-loading-map">
          {outline && (
            <svg className="sx-loading-area" viewBox={outline.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <path className="sx-loading-area-under" d={outline.d} />
              <path className="sx-loading-area-trace" d={outline.d} pathLength={1} />
            </svg>
          )}
          <p className="sx-loading-status" role="status">
            Loading the catalog…
          </p>
        </div>
        <aside className="sx-rail" aria-label="Collections">
          {/* The same head as the console's, inert, so it's there before the
              rows are. */}
          <div className="sx-rail-head">
            <div className="sx-rail-title">
              <h2>Collections</h2>
              <button type="button" className="sx-group-switch" aria-pressed="false" disabled>
                <span className="sx-switch" aria-hidden="true" />
                Group by review
              </button>
            </div>
            <label className="ffx-field">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search collections</span>
              <input type="search" placeholder="Search collections" disabled />
            </label>
            {/* Where the review states go, so the rows don't jump when they arrive. */}
            <div className="sx-loading-states" />
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
