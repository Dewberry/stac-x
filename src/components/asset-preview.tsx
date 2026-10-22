"use client";

import { useEffect, useRef, useState } from "react";

/**
 * An image asset inline, with an honest fallback: the assets live in a
 * private bucket, so the image fails when the server has no credentials or
 * when the catalog points at a file that was never uploaded. Either way it
 * reads as a missing preview, not as a broken page.
 */
export function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // The page is server rendered, so the image can fail before React attaches
  // onError. Check the element's own state once mounted.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) {
    return (
      <div className="sx-thumb-missing">
        {"Preview unavailable. The file isn't at this path in the bucket, or the server can't read it."}
      </div>
    );
  }
  // A plain img: the source is a redirect to a presigned URL of unknown size.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt={alt} className="sx-thumb" loading="lazy" onError={() => setFailed(true)} />;
}
