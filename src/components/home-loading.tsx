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
              rows are. No search box: that only appears with enough
              collections, which isn't known yet. */}
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
