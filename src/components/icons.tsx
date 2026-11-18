/** Line icons on a 16 grid, one stroke weight, used by the small buttons. */
export function Icon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * The one chevron that marks everything that folds: an asset group, an
 * asset row, a node of the JSON tree, a structure in a table cell. It
 * points right and turns down when its holder is open (.sx-chev in
 * styles/item-pages.css reads the open state off the parent).
 */
export function Chevron() {
  return (
    <span className="sx-chev" aria-hidden="true">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 2.5 8 6l-3.5 3.5" />
      </svg>
    </span>
  );
}

export const ICONS = {
  json: "M5 3H4a1 1 0 0 0-1 1v3l-1 1 1 1v3a1 1 0 0 0 1 1h1M11 3h1a1 1 0 0 1 1 1v3l1 1-1 1v3a1 1 0 0 1-1 1h-1",
  link: "M6.5 9.5l3-3M7 11l-1.5 1.5a2.1 2.1 0 0 1-3-3L4 8M9 5l1.5-1.5a2.1 2.1 0 0 1 3 3L12 8",
  download: "M8 2v8M5 7l3 3 3-3M3 12v2h10v-2",
  copy: "M6 6h7v7H6zM3 10V3h7",
  table: "M2 3h12v10H2zM2 7h12M6 3v10",
  external: "M7 3H3v10h10V9M9 3h4v4M13 3 7 9",
  chevron: "m4 6 4 4 4-4",
  chevronRight: "m6 4 4 4-4 4",
  fit: "M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3",
};

/**
 * The folder beside a catalog's name, wherever one is named: group
 * headings, breadcrumbs, catalog rows. Collections never carry it, so it's
 * how the two kinds tell apart at a glance.
 */
export function FolderGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="sx-folder"
      viewBox="0 0 14 14"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 4.5V3a1 1 0 0 1 1-1h3l1.5 1.5h5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

/**
 * What an item's geometry is, beside its name in a list: a dot for a
 * point, a stroke for a line, a filled shape for an area, a stroke with a
 * dot for a GeometryCollection whose parts differ, and an empty dashed
 * ring for an item with none. `step` is the blue the item's shape
 * is drawn in on the map, where the collection's few shapes each have one
 * (.sx-geom in styles/home.css). It's for the eye only; the row says the
 * same in words.
 */
export function GeomGlyph({ kind, step }: { kind: "point" | "line" | "area" | "mixed" | null; step?: 1 | 2 | 3 }) {
  return (
    <svg className="sx-geom" data-kind={kind ?? "none"} data-step={step} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      {kind === "point" ? (
        <circle cx="6" cy="6" r="3" fill="currentColor" />
      ) : kind === "line" ? (
        <path d="M1.5 9.5 4.5 4l3 4 3-5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : kind === "area" ? (
        <path d="M2 4.5 6.5 1.5l4 2.5-1 6-6.5.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      ) : kind === "mixed" ? (
        <>
          <path d="M1.5 10.5 4.5 6l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="3" r="2.25" fill="currentColor" />
        </>
      ) : (
        <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.7" />
      )}
    </svg>
  );
}
