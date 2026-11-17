import { AssetList } from "./asset-list";
import { Thumbnail } from "./asset-preview";
import { CopyButton } from "./copy-button";
import { PreviewButton } from "./data-modal";
import { Grid, MetaTable } from "./meta-table";
import { Icon, ICONS } from "./shell";
import { cloudViewHref } from "@/lib/config";
import { formatTag } from "@/lib/data-preview";
import { fmtBytes, humanize, isImageType, isPreviewable, mediaLabel } from "@/lib/format";
import type { StacAsset } from "@/lib/stac";
import { assetHref, withBase } from "@/lib/utils";

/**
 * The assets of an item or a collection, as one list in name order, a page
 * at a time, with a filter over all of it. They used to be sorted into
 * groups (model files, terrain, GIS and so on) worked out from roles and
 * media types, but the catalogs vary too much for any such rule to put
 * files where a person would look for them, so there are no groups.
 * Each asset is a row (file name, its roles, size) that opens to its title
 * and description, its image if it has one, its media type, its actions and
 * whatever extra fields it carries. The row shows roles and not the title because a title
 * is often the file name again, or one sentence shared by forty files. The
 * open row's header line holds its actions (Download, the S3 URI to copy,
 * Bucket View), and a parquet, CSV or JSON asset gets a Preview button on
 * its closed row that opens a look inside it in a dialog
 * (components/data-modal.tsx), read through the server.
 */
const KNOWN = new Set(["href", "title", "description", "type", "roles"]);

function isRowList(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x));
}

function isPlot(a: StacAsset): boolean {
  return Boolean(a.roles?.some((r) => r === "thumbnail" || r === "overview")) || isImageType(a.type, a.href);
}

/** The count beside the panel's title. */
export function assetNote(assets: Record<string, StacAsset>): string {
  return String(Object.keys(assets).length);
}

/**
 * plotsFirst leads with the plots, for a collection, where an overview plot
 * is the thing to see and the files behind it are secondary.
 */
export function Assets({ assets, plotsFirst = false }: { assets: Record<string, StacAsset>; plotsFirst?: boolean }) {
  const entries = Object.entries(assets).map(([key, a]) => ({ key, a, file: a.href.split("/").pop() || key }));
  if (!entries.length) return <p className="sx-empty">This item has no assets.</p>;
  entries.sort(
    (x, y) =>
      (plotsFirst ? Number(isPlot(y.a)) - Number(isPlot(x.a)) : 0) || x.file.localeCompare(y.file, undefined, { numeric: true }),
  );
  return (
    <AssetList
      rows={entries.map(({ key, a, file }) => ({
        key,
        file,
        roles: a.roles ?? [],
        size: typeof a["file:size"] === "number" ? fmtBytes(a["file:size"] as number) : null,
        search: `${key} ${file} ${a.title ?? ""} ${a.type ?? ""} ${mediaLabel(a.type)} ${(a.roles ?? []).join(" ")}`.toLowerCase(),
        action: isPreviewable(a.type, a.href) ? (
          <PreviewButton
            url={withBase(`/api/preview?href=${encodeURIComponent(a.href)}`)}
            file={file}
            ariaLabel={`Preview ${file}`}
            title={a.title && a.title !== file ? a.title : undefined}
            format={formatTag(a.type, a.href)}
            icon={null}
            actions={<AssetActions a={a} />}
          />
        ) : undefined,
        body: <AssetBody k={key} file={file} a={a} />,
      }))}
    />
  );
}

/** The same file actions in the expanded asset and its preview dialog. */
function AssetActions({ a }: { a: StacAsset }) {
  const s3 = a.href.startsWith("s3://");
  const cloudView = cloudViewHref(a.href);
  return (
    <>
      <a href={assetHref(a.href)} className="ffx-btn ffx-btn-sm" target="_blank" rel="noreferrer" download={s3 ? undefined : true}>
        <Icon d={ICONS.download} size={12} /> Download
      </a>
      <CopyButton text={a.href} label={s3 ? "Copy S3 URI" : "Copy URL"} />
      {cloudView && (
        <a href={cloudView} className="ffx-btn ffx-btn-sm" target="_blank" rel="noreferrer"
          aria-label={`Cloud View: open ${a.href.split("/").pop() || "asset"} folder`}>
          <Icon d={ICONS.external} size={12} /> Cloud View
        </a>
      )}
    </>
  );
}

/**
 * The open row's header line: the title (or, without one, the description)
 * on the left, where they say more than the file name does, and the
 * actions on the right: Download, the copy button that says what it copies,
 * and Bucket View, which opens the file's folder (only where CLOUD_VIEW_URL
 * is set).
 */
function AssetHead({ a, title, description }: { a: StacAsset; title?: string; description?: string }) {
  return (
    <div className="sx-asset-head">
      {title && <div className="sx-asset-title">{title}</div>}
      {!title && description && <p className="text-small text-ink-sec">{description}</p>}
      <div className="sx-asset-acts">
        <AssetActions a={a} />
      </div>
    </div>
  );
}

function AssetBody({ k: key, file, a }: { k: string; file: string; a: StacAsset }) {
  // A title or description that only says the file name again is left out:
  // the row above already has it.
  const title = a.title && a.title !== file ? a.title : undefined;
  const description = a.description && a.description !== file && a.description !== title ? a.description : undefined;
  const image = isImageType(a.type, a.href);
  const extra = Object.entries(a).filter(([k]) => !KNOWN.has(k));
  // A list of like objects (file:values on the AMS asset) is a table in
  // its own right, not a value squeezed into a key/value row.
  const tables = extra.filter(([, v]) => isRowList(v)) as [string, Record<string, unknown>[]][];
  const fields = extra.filter(([, v]) => !isRowList(v));
  return (
    <>
      <AssetHead a={a} title={title} description={description} />
      {title && description && <p className="text-small text-ink-sec">{description}</p>}
      {image && <Thumbnail src={assetHref(a.href)} alt={a.title || humanize(key)} />}
      {a.type && (
        <div className="flex flex-wrap gap-1">
          <span className="sx-tag">{mediaLabel(a.type)}</span>
        </div>
      )}
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
