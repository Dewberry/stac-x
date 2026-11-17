import { QC_LABEL, QcMark, STATE_ORDER } from "./qc-mark";
import { Skel } from "./spinner";

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
 * The home page's rail while its collections load (components/home.tsx).
 * The console and its map are already up by then; this stands in for the
 * rail alone, with what it always has (its title, the search box, the
 * review states) and bars for what it doesn't know yet (the counts and the
 * rows). The rows are the real rows' markup, so they're the same height
 * and nothing shifts when the real ones arrive.
 *
 * Nothing in it takes focus, so focus has nowhere to fall from when the
 * real rail replaces it, and the console's status line is what says
 * "loading" to a screen reader.
 */
export function HomeRailLoading() {
  return (
    <aside id="collection-list" className="sx-rail" aria-label="Collections" aria-busy="true">
      <div className="sx-rail-head">
        <div className="sx-rail-title">
          <h2>Collections</h2>
        </div>
        <label className="ffx-field">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Search collections and catalogs</span>
          <input type="search" placeholder="Search collections and catalogs" disabled />
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
  );
}
