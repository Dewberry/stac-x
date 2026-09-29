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

export const ICONS = {
  json: "M5 3H4a1 1 0 0 0-1 1v3l-1 1 1 1v3a1 1 0 0 0 1 1h1M11 3h1a1 1 0 0 1 1 1v3l1 1-1 1v3a1 1 0 0 1-1 1h-1",
  link: "M6.5 9.5l3-3M7 11l-1.5 1.5a2.1 2.1 0 0 1-3-3L4 8M9 5l1.5-1.5a2.1 2.1 0 0 1 3 3L12 8",
  download: "M8 2v8M5 7l3 3 3-3M3 12v2h10v-2",
  copy: "M6 6h7v7H6zM3 10V3h7",
  table: "M2 3h12v10H2zM2 7h12M6 3v10",
  external: "M7 3H3v10h10V9M9 3h4v4M13 3 7 9",
  chevron: "m4 6 4 4 4-4",
  up: "M13 13H6V3M3 6l3-3 3 3",
  folder: "M2 4.5h4l1.5 1.5H14v6.5H2z",
};
