import { areaOutline, mapArea } from "@/lib/map-area";
import { QC_LABEL, QcMark, STATE_ORDER } from "./qc-mark";
import { Skel, Spinner } from "./spinner";

/** The width of each placeholder row's name and of the line under it. */
const ROWS = [
  ["34%", "48%"],
  ["26%", "30%"],
  ["44%", "42%"],
  ["62%", "36%"],
  ["52%", "24%"],
  ["38%", "40%"],
  ["30%", "36%"],
];

/**
 * The landing page while its catalog loads. The real page waits on every
 * collection in the environment, which from S3 can take seconds, and
 * without this that wait is a blank page. This stands in with the same
 * console: the deployment's area traced where the map goes (when one is
 * set), and the rail with what it always has (its title, the search box,
 * the review states) and bars for what it doesn't know yet (the counts and
 * the rows). The rows are the real rows' markup, so they're the same
 * height and nothing shifts when the real ones arrive. Next streams the
 * real page in over it.
 */
export function HomeLoading({ railShare }: { railShare: number }) {
  const area = mapArea();
  const outline = area && areaOutline(area);
  return (
    <div className="sx-home" aria-busy="true">
      <div className="sx-console" style={{ "--rail": `${railShare}%` } as React.CSSProperties}>
        <div className="sx-console-map sx-loading-map">
          {outline && (
            <svg className="sx-loading-area" viewBox={outline.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <path className="sx-loading-area-under" d={outline.d} />
              <path className="sx-loading-area-trace" d={outline.d} pathLength={1} />
            </svg>
          )}
          <p className="sx-loading-status" role="status">
            <Spinner />
            Loading the catalog…
          </p>
        </div>
        <aside className="sx-rail" aria-label="Datasets">
          {/* The same head as the console's, inert, so it's there before the
              rows are. */}
          <div className="sx-rail-head">
            <div className="sx-rail-title">
              <h2>Datasets</h2>
            </div>
            <label className="ffx-field">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Search datasets and folders</span>
              <input type="search" placeholder="Search datasets and folders" disabled />
            </label>
            {/* The states and their marks are always the same four; only the counts wait. */}
            <div className="sx-rail-states sx-loading-states" aria-hidden="true">
              {STATE_ORDER.map((st) => (
                <span key={st} className="sx-state-btn">
                  <QcMark state={st} />
                  <Skel w="0.75rem" />
                  <span>{QC_LABEL[st]}</span>
                </span>
              ))}
            </div>
          </div>
          <ul className="sx-rail-list sx-loading-rows" aria-hidden="true">
            {ROWS.map(([name, sub], i) => (
              <li key={i} className="sx-rail-item">
                <div className="sx-row">
                  <span className="sx-row-main">
                    <span className="sx-row-title">
                      <Skel w={name} />
                    </span>
                    <span className="sx-row-sub">
                      <Skel w={sub} />
                    </span>
                  </span>
                  <span className="sx-row-aside">
                    <span className="sx-row-count">
                      <b className="sx-row-fig">
                        <Skel w="1.75rem" />
                      </b>
                      <span className="sx-row-unit">
                        <Skel w="2.75rem" />
                      </span>
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
