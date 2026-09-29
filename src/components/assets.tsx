import { AssetPreview, Thumbnail } from "./asset-preview";
import { CopyButton } from "./copy-button";
import { Grid, MetaTable } from "./meta-table";
import { Icon, ICONS } from "./shell";
import { cloudViewHref } from "@/lib/config";
import { humanize, isImageType, isParquetType, mediaLabel } from "@/lib/format";
import type { StacAsset } from "@/lib/stac";
import { assetHref } from "@/lib/utils";

/**
 * The assets of an item, one card each, all closed to start since an item can
 * carry a lot of them. A card opens to its description, its image if it has
 * one, its actions and whatever extra fields the asset carries. An asset in S3 gets a Cloud View button, and a
 * parquet asset gets a preview button that pulls its first rows through the
 * server.
 */
const KNOWN = new Set(["href", "title", "description", "type", "roles"]);

function isRowList(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x));
}

export function Assets({ assets }: { assets: Record<string, StacAsset> }) {
  const entries = Object.entries(assets).sort(([a, x], [b, y]) => {
    const ta = x.roles?.includes("thumbnail") ? 0 : 1;
    const tb = y.roles?.includes("thumbnail") ? 0 : 1;
    return ta - tb || a.localeCompare(b);
  });
  if (!entries.length) return <p className="sx-empty">This item has no assets.</p>;
  return (
    <div className="sx-assets">
      {entries.map(([key, a]) => {
        const image = isImageType(a.type);
        const parquet = isParquetType(a.type, a.href);
        const extra = Object.entries(a).filter(([k]) => !KNOWN.has(k));
        // A list of like objects (file:values on the AMS asset) is a table in
        // its own right, not a value squeezed into a key/value row.
        const tables = extra.filter(([, v]) => isRowList(v)) as [string, Record<string, unknown>[]][];
        const fields = extra.filter(([, v]) => !isRowList(v));
        const s3 = a.href.startsWith("s3://");
        const cloudView = cloudViewHref(a.href);
        return (
          <details key={key} className="sx-asset">
            <summary>
              <span className="sx-asset-name">{a.title || humanize(key)}</span>
              {a.type && <span className="sx-tag">{mediaLabel(a.type)}</span>}
              {a.roles?.map((r) => (
                <span key={r} className="sx-tag">
                  {r}
                </span>
              ))}
            </summary>
            <div className="sx-asset-body">
              {a.title && a.title !== key && <div className="ffx-id text-micro text-ink-mut">{key}</div>}
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
              {fields.length > 0 && (
                <MetaTable className="-mx-3 w-auto" entries={fields.map(([k, v]) => ({ key: k, value: v }))} />
              )}
              {tables.map(([k, rows]) => (
                <div key={k} className="sx-asset-table">
                  <div className="sx-asset-table-label">
                    {humanize(k)} <span className="ffx-num text-ink-mut">({rows.length})</span>
                  </div>
                  <Grid rows={rows} />
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
