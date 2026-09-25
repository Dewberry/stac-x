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

/** station_nm to "Station nm", drain_area_va to "Drain area va", file:values to "File values". */
export function humanize(key: string): string {
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
    .replace(/^[a-z]+:/, "")
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w);
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Words that come out of a snake_case key and should keep their capitals. */
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

export function isImageType(type: string | null | undefined) {
  return Boolean(type && /^image\/(png|jpe?g|gif|webp|svg)/i.test(type));
}

export function isParquetType(type: string | null | undefined, href?: string) {
  return Boolean((type && /parquet/i.test(type)) || (href && /\.(geo)?parquet$|\.pq$/i.test(href)));
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

/** Title case for gage names that arrive shouting: "MOSQUITO CREEK NEAR ALMA, CO". */
export function tidyCaps(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Co|Nr|Nw|Ne|Sw|Se|Usgs|Hwy|Mt|St|Ft)\b/g, (m) => m.toUpperCase())
    .replace(/\b(At|Near|Below|Above|Of|And|The|In|On|Nr)\b/g, (m) => m.toLowerCase())
    .replace(/^([a-z])/, (m) => m.toUpperCase());
}
