import type { ReactNode } from "react";
import { Loading } from "./spinner";

/**
 * A page while its data loads: what the loading.tsx files beside the
 * collection, item and Admin pages show.
 *
 * Those pages wait on the catalog. Most of the time that's memory, but the
 * first read after a QC save rebuilds it, and from S3 that can take
 * seconds. Without a loading state Next holds the old page on screen until
 * the new one is ready, so a click on a dataset, or a save in Admin, looked
 * like nothing had happened. This goes up at once instead, in the page's
 * own frame, and the real page streams in over it.
 */
export function PageLoading({ children }: { children: ReactNode }) {
  return (
    <div className="sx-page" aria-busy="true">
      <div className="ffx-panel sx-page-loading">
        <Loading>{children}</Loading>
      </div>
    </div>
  );
}
