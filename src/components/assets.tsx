import { AssetGroups, type AssetGroupData } from "./asset-groups";
import { AssetPreview, Thumbnail } from "./asset-preview";
import { CopyButton } from "./copy-button";
import { Grid, MetaTable } from "./meta-table";
import { Icon, ICONS } from "./shell";
import { cloudViewHref } from "@/lib/config";
import { fmtBytes, humanize, isImageType, isParquetType, mediaLabel } from "@/lib/format";
import type { StacAsset } from "@/lib/stac";
import { assetHref } from "@/lib/utils";

/**
 * The assets of an item, grouped by what they're for: model files, time
 * series, terrain, GIS layers and so on, worked out from each asset's roles
 * and media type. A model run can carry fifty files, and a flat list of them
 * can't be scanned. A small set opens in full; a large one opens its first
 * group. Each asset is a row (file name, what it is, size) that opens to its
 * description, its image if it has one, its actions and whatever extra fields
 * it carries. An asset in S3 gets a Cloud View button, and a parquet asset
 * gets a preview button that pulls its first rows through the server.
 */
const KNOWN = new Set(["href", "title", "description", "type", "roles"]);

function isRowList(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x));
}

type Bucket = { id: string; label: string; description: string };

// In the order they're shown. The first bucket an asset fits is its group.
const BUCKETS: (Bucket & { test: (roles: string[], type: string, file: string) => boolean })[] = [
  {
    id: "thumbs",
    label: "Thumbnails",
    description: "Plots and previews",
    test: (r, t, f) => r.includes("thumbnail") || r.includes("overview") || isImageType(t, f),
  },
  {
    id: "terrain",
    label: "Terrain",
    description: "GeoTIFF rasters and their sidecars",
    test: (_r, t, f) => /tiff/.test(t) || /\.tiff?(\.aux\.xml)?$/.test(f),
  },
  { id: "series", label: "Time series", description: "HEC-DSS", test: (r, _t, f) => r.includes("hec-dss") || /\.dss$/.test(f) },
  { id: "db", label: "Databases", description: "SQLite", test: (r, t) => /sqlite/.test(t) || r.some((x) => /sqlite/.test(x)) },
  {
    id: "gis",
    label: "GIS",
    description: "Shapefiles, projections and map layers",
    test: (r, t, f) =>
      r.some((x) => /-(gis|map)$|^projection$/.test(x)) || /vnd\.shp|x-dbf|geo\+json/.test(t) || /\.(shp|shx|dbf|prj|gdr)$/.test(f),
  },
  {
    id: "model",
    label: "Model data",
    description: "Project, basin, met, control and run files",
    test: (r) => r.some((x) => /^(hms|ras|ressim|hec-ras|hec-hms)-/.test(x)),
  },
  { id: "data", label: "Data", description: "Tables and data files", test: (r, t) => r.includes("data") || /parquet|csv|json/.test(t) },
];
const OTHER: Bucket = { id: "other", label: "Other", description: "Everything else" };
// Data first when there is some: it's usually what someone came to download.
const ORDER = ["model", "data", "series", "terrain", "gis", "db", "thumbs", "other"];

/** What a model file is, from its role, for the row beside its name. */
const ROLE_WHAT: Record<string, string> = {
  project: "Project",
  basin: "Basin model",
  met: "Meteorologic model",
  control: "Control spec",
  gage: "Gage file",
  grid: "Grid file",
  pdata: "Paired data",
  run: "Run spec",
  access: "Access file",
  terrain: "Terrain spec",
  geometry: "Geometry",
  plan: "Plan",
  flow: "Flow file",
};

function bucketOf(a: StacAsset, key: string): Bucket {
  const roles = (a.roles ?? []).map((r) => r.toLowerCase());
  const type = (a.type ?? "").toLowerCase();
  const file = (a.href.split("/").pop() ?? key).toLowerCase();
  return BUCKETS.find((b) => b.test(roles, type, file)) ?? OTHER;
}

function grouped(assets: Record<string, StacAsset>, plotsFirst = false) {
  const by = new Map<string, { bucket: Bucket; entries: [string, StacAsset][] }>();
  for (const [key, a] of Object.entries(assets)) {
    const b = bucketOf(a, key);
    if (!by.has(b.id)) by.set(b.id, { bucket: b, entries: [] });
    by.get(b.id)!.entries.push([key, a]);
  }
  const order = plotsFirst ? ["thumbs", ...ORDER.filter((id) => id !== "thumbs")] : ORDER;
  return order.filter((id) => by.has(id)).map((id) => by.get(id)!);
}

/** "52 in 6 groups", or just the count when there's one group. */
export function assetNote(assets: Record<string, StacAsset>): string {
  const n = Object.keys(assets).length;
  const g = grouped(assets).length;
  return g > 1 ? `${n} in ${g} groups` : String(n);
}

/** What a file is from its extension, when its media type is too generic to say. */
const EXT_WHAT: [RegExp, string][] = [
  [/\.tiff?\.aux\.xml$/, "Raster sidecar"],
  [/\.tiff?$/, "GeoTIFF"],
  [/\.dss$/, "DSS file"],
  [/\.shp$/, "Shapefile"],
  [/\.shx$/, "Shapefile index"],
  [/\.dbf$/, "Shapefile attributes"],
  [/\.prj$/, "Projection"],
  [/\.gdr$/, "Map layer"],
  [/\.xml$/, "Map layer"],
  [/\.sqlite3?$/, "SQLite database"],
  [/\.txt$/, "Text"],
];
const GENERIC = /^(text\/plain|application\/octet-stream|application\/xml|text\/xml)?$/;

function whatOf(a: StacAsset, file: string): string {
  if (a.title && a.title !== file && !a.title.endsWith(file)) return a.title;
  // A model role names a project file; a raster that carries one is still a GeoTIFF.
  const generic = GENERIC.test((a.type ?? "").toLowerCase().split(";")[0].trim());
  const role = generic ? a.roles?.find((r) => /^(hms|ras|ressim|hec-ras|hec-hms)-/i.test(r)) : undefined;
  if (role) {
    const [tool, part] = role.toLowerCase().replace(/^hec-/, "").split("-");
    const what = ROLE_WHAT[part];
    if (what) return part === "project" ? `${tool.toUpperCase()} project` : what;
  }
  const ext = EXT_WHAT.find(([re]) => re.test(file.toLowerCase()))?.[1];
  return ext ?? (mediaLabel(a.type) || humanize(a.roles?.[0] ?? ""));
}

/**
 * The format chip for an asset: its media type, or where that only says
 * "text" or "bytes", its role ("HEC-DSS", "HMS-BASIN").
 */
function formatOf(a: StacAsset, key: string): string {
  const type = (a.type ?? "").toLowerCase().split(";")[0].trim();
  if (!GENERIC.test(type)) return mediaLabel(a.type);
  const role = a.roles?.find((r) => r !== "data" && r !== "metadata");
  if (role) return role.toUpperCase();
  const ext = /\.([a-z0-9]+)$/i.exec(a.href.split("/").pop() ?? key)?.[1];
  return ext ? ext.toUpperCase() : mediaLabel(a.type);
}

/** At most two chips for a group; a family of roles ("HMS-BASIN", "HMS-MET") reads as one ("HMS-*"). */
function chipsOf(formats: string[]): string[] {
  const out: string[] = [];
  for (const f of formats) {
    const family = /^([A-Z]+)-/.exec(f)?.[1];
    const shared = family && formats.filter((x) => x.startsWith(`${family}-`)).length > 1;
    const chip = shared ? `${family}-*` : f;
    if (!out.includes(chip)) out.push(chip);
  }
  return out.slice(0, 2);
}

/**
 * plotsFirst leads with the plots, for a collection, where an overview plot
 * is the thing to see and the files behind it are secondary.
 */
export function Assets({ assets, plotsFirst = false }: { assets: Record<string, StacAsset>; plotsFirst?: boolean }) {
  const groups = grouped(assets, plotsFirst);
  if (!groups.length) return <p className="sx-empty">This item has no assets.</p>;
  const total = Object.keys(assets).length;
  const data: AssetGroupData[] = groups.map(({ bucket, entries }, i) => {
    entries.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    const formats = Array.from(new Set(entries.map(([key, a]) => formatOf(a, key)).filter(Boolean)));
    return {
      id: bucket.id,
      label: bucket.label,
      description: bucket.description,
      formats: chipsOf(formats),
      open: total <= 8 || i === 0,
      rows: entries.map(([key, a]) => {
        const file = a.href.split("/").pop() || key;
        const what = whatOf(a, file);
        const size = typeof a["file:size"] === "number" ? fmtBytes(a["file:size"] as number) : null;
        return {
          key,
          file,
          what,
          size,
          search: `${key} ${file} ${a.title ?? ""} ${what} ${a.type ?? ""} ${formatOf(a, key)} ${(a.roles ?? []).join(" ")}`.toLowerCase(),
          body: <AssetBody k={key} a={a} />,
        };
      }),
    };
  });
  return <AssetGroups groups={data} />;
}

function AssetBody({ k: key, a }: { k: string; a: StacAsset }) {
  const image = isImageType(a.type, a.href);
  const parquet = isParquetType(a.type, a.href);
  const extra = Object.entries(a).filter(([k]) => !KNOWN.has(k));
  // A list of like objects (file:values on the AMS asset) is a table in
  // its own right, not a value squeezed into a key/value row.
  const tables = extra.filter(([, v]) => isRowList(v)) as [string, Record<string, unknown>[]][];
  const fields = extra.filter(([, v]) => !isRowList(v));
  const s3 = a.href.startsWith("s3://");
  const cloudView = cloudViewHref(a.href);
  return (
    <>
      {a.title && <div className="text-small font-semibold text-ink">{a.title}</div>}
      {a.description && <p className="text-small text-ink-sec">{a.description}</p>}
      {image && <Thumbnail src={assetHref(a.href)} alt={a.title || humanize(key)} />}
      <div className="flex flex-wrap gap-1.5">
        <a href={assetHref(a.href)} className="ffx-btn ffx-btn-sm" target="_blank" rel="noreferrer" download={s3 ? undefined : true}>
          <Icon d={ICONS.download} size={12} /> Download
        </a>
        <CopyButton text={a.href} label={s3 ? "Copy S3 URI" : "Copy URL"} />
        {cloudView ? (
          <a href={cloudView} className="ffx-btn ffx-btn-sm" target="_blank" rel="noreferrer">
            <Icon d={ICONS.external} size={12} /> Cloud View
          </a>
        ) : (
          s3 && (
            <button type="button" className="ffx-btn ffx-btn-sm" disabled title="Cloud View link isn't set up yet">
              <Icon d={ICONS.external} size={12} /> Cloud View
            </button>
          )
        )}
        {parquet && <AssetPreview href={a.href} />}
      </div>
      <div className="sx-asset-href">{a.href}</div>
      <div className="flex flex-wrap gap-1">
        {a.type && <span className="sx-tag">{mediaLabel(a.type)}</span>}
        {a.roles?.map((r) => (
          <span key={r} className="sx-tag">
            {r}
          </span>
        ))}
      </div>
      {fields.length > 0 && <MetaTable className="-mx-3 w-auto" entries={fields.map(([k, v]) => ({ key: k, value: v }))} />}
      {tables.map(([k, rows]) => (
        <div key={k} className="sx-asset-table">
          <div className="sx-asset-table-label">
            {humanize(k)} <span className="ffx-num text-ink-mut">({rows.length})</span>
          </div>
          <Grid rows={rows} />
        </div>
      ))}
    </>
  );
}
