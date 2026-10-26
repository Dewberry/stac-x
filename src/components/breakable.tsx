import { Fragment, type ReactNode } from "react";

/**
 * Text that may be a file path, with a break opportunity after each slash.
 * Item titles are sometimes paths ("BTR-Loveland/4_Mapping/.../FLOODPLAIN.shp"),
 * and a title's overflow-wrap would otherwise split them mid-word once
 * they're wider than the column. With the hints, they wrap at the slashes.
 */
export function breakable(text: string): ReactNode {
  const parts = text.split("/");
  if (parts.length === 1) return text;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && (
        <>
          /<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));
}
