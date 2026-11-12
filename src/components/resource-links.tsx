import type { StacLink } from "@/lib/stac";
import { assetHref } from "@/lib/utils";

/**
 * The links of a collection or item that point at something to read (what
 * it was derived from, a report), as lib/stac.ts resourceLinks picks them:
 * a row each, with the link's rel as a tag. A web address opens as it is.
 * Anything else (an s3:// object, a file beside the catalog) goes through
 * the asset route, which signs it or serves it, since a browser can't open
 * those addresses itself.
 */
export function ResourceLinks({ links }: { links: StacLink[] }) {
  return (
    <ul className="divide-y divide-grid pb-1">
      {links.map((l, i) => (
        <li key={`${l.rel}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-[var(--ffx-panel-pad)] py-2">
          <a href={assetHref(l.href)} className="ffx-link" target="_blank" rel="noreferrer">
            {l.title || nameOf(l.href)}
          </a>
          <span className="sx-tag">{l.rel}</span>
        </li>
      ))}
    </ul>
  );
}

/** A web address is shown whole; a file is shown by its name, since the rest is a bucket path. */
function nameOf(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return href.split("/").filter(Boolean).pop() ?? href;
}
