"use client";

import { catchError, type ErrorInfo } from "next/error";

/**
 * What stands in for a map that couldn't be drawn, so the page around it
 * stays.
 *
 * A map can fail in ways nothing else on a page can: the browser has no
 * WebGL, the map library doesn't load, or a file's extent is somewhere a
 * map can't go. Left alone, the first two leave an empty frame with no word
 * why, and the third takes the whole page down with it. Wrapped in this,
 * the frame says the map couldn't be drawn and offers to try again, and
 * the list, the assets and the metadata beside it are untouched.
 */
function MapDown({ label, fill }: { label: string; fill?: boolean }, { retry }: ErrorInfo) {
  return (
    <div className="sx-map-down" data-fill={fill || undefined} role="group" aria-label={label}>
      <p role="status">The map couldn&apos;t be drawn. The rest of the page still works.</p>
      <button type="button" className="ffx-btn ffx-btn-sm" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}

export const MapBoundary = catchError(MapDown);
