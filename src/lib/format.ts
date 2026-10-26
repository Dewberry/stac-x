/**
 * Formatting shared by server and client components. No imports from the
 * server-only modules here.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v);
}

/** 2026-01-07T13:30:30.829Z to "2026-01-07 13:30 UTC"; a bare date stays a date. */
export function fmtDate(v: string | null | undefined, opts: { time?: boolean } = {}): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // A timestamp with no zone (site_retrieved comes this way) is shown as
  // written, with no UTC label, rather than guessed into a zone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !/(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    return opts.time === false ? v.slice(0, 10) : `${v.slice(0, 10)} ${v.slice(11, 16)}`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const date = d.toISOString().slice(0, 10);
  if (opts.time === false) return date;
  const hasTime = v.length > 10;
  return hasTime ? `${date} ${d.toISOString().slice(11, 16)} UTC` : date;
}

export function fmtRange(a: string | null | undefined, b: string | null | undefined): string {
  const x = fmtDate(a, { time: false });
  const y = fmtDate(b, { time: false });
  if (x && y) return x === y ? x : `${x} to ${y}`;
  if (x) return `from ${x}`;
  if (y) return `until ${y}`;
  return "";
}

export function fmtNum(v: number, digits = 2): string {
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} kB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Friendly field labels, preserving extension namespaces in capitals: ffrd:foobar to "FFRD: Foobar". */
export function humanize(key: string): string {
  const namespace = /^([a-z][a-z0-9_-]*):(.+)$/i.exec(key);
  if (namespace) return `${namespace[1].toUpperCase()}: ${humanize(namespace[2])}`;
  const known: Record<string, string> = {
    datetime: "Date and time",
    start_datetime: "Start",
    end_datetime: "End",
    station_nm: "Station name",
    site_no: "Site number",
    huc_cd: "HUC",
    drain_area_va: "Drainage area (mi²)",
    site_retrieved: "Site retrieved",
    daily_values: "Daily values",
    begin_date: "Begin",
    end_date: "End",
    date_approved: "Date approved",
    qc: "QC",
    stac_version: "STAC version",
    stac_extensions: "STAC extensions",
  };
  if (known[key]) return known[key];
  const words = key
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w);
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Words that come out of a key or an id and should keep their capitals. */
const ACRONYMS: Record<string, string> = {
  ams: "AMS",
  lpiii: "LP-III",
  lp3: "LP-III",
  swe: "SWE",
  huc: "HUC",
  usgs: "USGS",
  nwis: "NWIS",
  cfs: "cfs",
  id: "id",
  url: "URL",
  uri: "URI",
  crs: "CRS",
  epsg: "EPSG",
  dem: "DEM",
  hms: "HMS",
  ras: "RAS",
  stac: "STAC",
  "1d": "1D",
  "2d": "2D",
  aorc: "AORC",
  ffrd: "FFRD",
  fema: "FEMA",
  hec: "HEC",
  nid: "NID",
  nlcd: "NLCD",
  noaa: "NOAA",
  qc: "QC",
};

/** A short label for a media type: "PNG", "Parquet", "JSON", "GeoTIFF". */
export function mediaLabel(type: string | null | undefined): string {
  if (!type) return "";
  const t = type.toLowerCase();
  if (t.includes("parquet")) return "Parquet";
  if (t.includes("geotiff") || t.includes("tiff")) return t.includes("cloud-optimized") ? "COG" : "GeoTIFF";
  if (t.includes("png")) return "PNG";
  if (t.includes("jpeg") || t.includes("jpg")) return "JPEG";
  if (t.includes("geo+json")) return "GeoJSON";
  if (t.includes("json")) return "JSON";
  if (t.includes("csv")) return "CSV";
  if (t.includes("pdf")) return "PDF";
  if (t.includes("html")) return "HTML";
  if (t.includes("netcdf")) return "NetCDF";
  if (t.includes("zip")) return "ZIP";
  if (t.includes("pmtiles")) return "PMTiles";
  if (t.includes("mvt") || t.includes("vnd.mapbox-vector-tile")) return "MVT";
  return type.split("/").pop()?.split(";")[0].toUpperCase() ?? type;
}

export function isImageType(type: string | null | undefined, href?: string) {
  if (type) return /^image\/(png|jpe?g|gif|webp|svg)/i.test(type);
  // Plenty of STAC writers leave type off, so go by the file name.
  return Boolean(href && /\.(png|jpe?g|gif|webp|svg)$/i.test(href.split("?")[0]));
}

export function isParquetType(type: string | null | undefined, href?: string) {
  return Boolean((type && /parquet/i.test(type)) || (href && /\.(geo)?parquet$|\.pq$/i.test(href)));
}

export function isCsvType(type: string | null | undefined, href?: string) {
  return Boolean((type && /csv|tab-separated/i.test(type)) || (href && /\.(csv|tsv)$/i.test(href.split("?")[0])));
}

export function isJsonType(type: string | null | undefined, href?: string) {
  return Boolean((type && /json/i.test(type)) || (href && /\.(geo)?json$/i.test(href.split("?")[0])));
}

/**
 * A plain text file, by its name: .txt. Not by a text/plain media type
 * alone, since writers put that on .prj files, logs and binaries alike.
 */
export function isTextType(_type: string | null | undefined, href?: string) {
  return Boolean(href && /\.txt$/i.test(href.split("?")[0]));
}

/** Whether the app can show the first rows (or the document, or the text) of an asset. */
export function isPreviewable(type: string | null | undefined, href: string) {
  return isParquetType(type, href) || isCsvType(type, href) || isJsonType(type, href) || isTextType(type, href);
}

/**
 * What to call an item in a list. STAC has a title property; the gage rows
 * have a station name. Fall through the likely candidates and give up to the
 * id, which is always there.
 */
export function itemLabel(properties: Record<string, unknown>): string | null {
  const candidates = ["title", "name", "station_nm", "label"];
  for (const k of candidates) {
    const v = properties[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const [k, v] of Object.entries(properties)) {
    if (/(_nm|_name|name)$/i.test(k) && typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** US state and territory codes, which stay capitals at the end of a name. */
const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI".split(" "),
);

/**
 * Title case for gage names that arrive shouting: "MOSQUITO CREEK NEAR ALMA, CO".
 * A state code at the end after a comma ("…, CO" or "…, CO.") stays capitals.
 */
export function tidyCaps(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Nr|Nw|Ne|Sw|Se|Usgs|Hwy|Mt|St|Ft)\b/g, (m) => m.toUpperCase())
    .replace(/\b(At|Near|Below|Above|Of|And|The|In|On|Nr)\b/g, (m) => m.toLowerCase())
    .replace(/^([a-z])/, (m) => m.toUpperCase())
    .replace(/,\s*([a-z]{2})(\.?)$/i, (m, st: string, dot: string) => (STATES.has(st.toUpperCase()) ? `, ${st.toUpperCase()}${dot}` : m));
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "la", "of", "on", "or", "the", "to", "via", "vs"]);
const UNITS = new Set(["ft", "m", "km", "mi"]);

/**
 * What to call a collection on screen. Every name gets the same shape:
 * words split on spaces (an id's dashes become spaces), each word capitalized
 * except short joining words, and known acronyms spelled as ACRONYMS has them.
 * A word that already has a capital in it ("HEC-RAS", "2D") is left alone.
 * The STAC JSON keeps its own title; this only changes what's shown.
 */
export function collectionName(title: string | null | undefined, id: string): string {
  let s = title?.trim() || id;
  if (!/\s/.test(s)) s = s.replace(/[-_]+/g, " ");
  if (s === s.toUpperCase()) s = s.toLowerCase();
  const fix = (part: string, first: boolean): string => {
    const lower = part.toLowerCase();
    const hr = /^(\d+)hrs?$/.exec(lower);
    if (hr) return `${hr[1]}-Hour`;
    const unit = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(lower);
    if (unit && UNITS.has(unit[2])) return `${unit[1]} ${unit[2]}`;
    if (ACRONYMS[lower] && ACRONYMS[lower] !== lower) return ACRONYMS[lower];
    if (/[A-Z]/.test(part)) return part;
    if (!first && SMALL_WORDS.has(lower)) return lower;
    return part.charAt(0).toUpperCase() + part.slice(1);
  };
  return s
    .split(/\s+/)
    .map((word, i, words) => {
      const [, pre, core, post] = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(word)!;
      const first = i === 0 || /:$/.test(words[i - 1]);
      return pre + core.split("-").map((p, j) => fix(p, first && j === 0)).join("-") + post;
    })
    .join(" ");
}

/** How long ago, roughly, in one unit: "40 minutes", "5 hours", "3 days", "6 weeks". */
export function fmtAge(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"}`;
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return min < 1 ? "just now" : n(min, "minute");
  const h = Math.round(min / 60);
  if (h < 48) return n(h, "hour");
  const d = Math.round(h / 24);
  if (d < 21) return n(d, "day");
  return n(Math.round(d / 7), "week");
}

/** fmtAge as a phrase: "5 hours ago", or "just now". */
export function fmtAgo(iso: string | null | undefined, now: number): string {
  const age = fmtAge(iso, now);
  return !age || age === "just now" ? age : `${age} ago`;
}

/** "1979–2022" from a temporal extent; one year when both ends match, null when there's neither. */
export function fmtYears(t: [string | null, string | null] | null | undefined): string | null {
  const a = t?.[0]?.slice(0, 4);
  const b = t?.[1]?.slice(0, 4);
  if (a && b) return a === b ? a : `${a}–${b}`;
  return a ?? b ?? null;
}
