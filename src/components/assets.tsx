import { AssetPreview, Thumbnail } from "./asset-preview";
import { CopyButton } from "./copy-button";
import { MetaTable } from "./meta-table";
import { Icon, ICONS } from "./shell";
import { humanize, isImageType, isParquetType, mediaLabel } from "@/lib/format";
import type { StacAsset } from "@/lib/stac";
import { assetHref } from "@/lib/utils";

/**
 * The assets of an item, one closed card each. Thumbnails open by default
 * and show their image; everything else opens to its description, its
 * actions and whatever extra fields the asset carries. A parquet asset gets
 * a preview button that pulls its first rows through the server.
 */
const KNOWN = new Set(["href", "title", "description", "type", "roles"]);

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
        const s3 = a.href.startsWith("s3://");
        return (
          <details key={key} className="sx-asset" open={image}>
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
                {parquet && <AssetPreview href={a.href} />}
              </div>
              <div className="sx-asset-href">{a.href}</div>
              {extra.length > 0 && (
                <MetaTable className="-mx-3 w-auto" entries={extra.map(([k, v]) => ({ key: k, value: v }))} />
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
