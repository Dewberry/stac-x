import type { Metadata } from "next";
import type { FeatureCollection } from "geojson";
import { assetNote, Assets } from "@/components/assets";
import { CatalogLayout, InsideRows, type Inside } from "@/components/catalog-page";
import { CopyButton } from "@/components/copy-button";
import { PreviewButton } from "@/components/data-modal";
import { DataPanel } from "@/components/data-panel";
import { ItemHoverProvider, LinkedMap } from "@/components/item-hover";
import { ItemsList } from "@/components/items-list";
import { MetaTable, type Entry } from "@/components/meta-table";
import { QcChip } from "@/components/qc-chip";
import { CollapsiblePanel, homeCrumb, Icon, ICONS, PageHead, Panel } from "@/components/shell";
import { NotInEnv } from "@/components/not-in-env";
import { VersionMenu } from "@/components/version-menu";
import { VersionNotice } from "@/components/version-notice";
import { childCollectionsOf, getCatalog, getCollection } from "@/lib/catalog";
import { collectionAncestors, hierarchyOf, treeNodesOf } from "@/lib/collection-hierarchy";
import { LOWER_48 } from "@/lib/map-area";
import { pageEnv } from "@/lib/page-env";
import { fmtNum, fmtRange } from "@/lib/format";
import { dataFileOf } from "@/lib/data-file";
import { formatTag } from "@/lib/data-preview";
import { itemRowsOf } from "@/lib/item-rows";
import { baseName } from "@/lib/storage";
import { assetHref, collectionHref, collectionJsonHref, itemHref, scopeHref } from "@/lib/utils";
import { versionName } from "@/lib/versions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ env: string; collection: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const env = await pageEnv(params);
  const { collection } = await params;
  const c = await getCollection(env, decodeURIComponent(collection));
  return { title: c ? c.title : "Collection" };
}

/**
 * A catalog (a folder, lib/collection-hierarchy.ts) gets its own page,
 * components/catalog-page.tsx. A dataset's page keeps the home console's
 * shape: the list on the left (its description, folded, then its items and
 * the rows they came from) and the map on the right, with its assets and
 * metadata under the map. The panels are STAC Browser's; the columns are
 * the home page's, so the map stays where it was when a dataset is opened
 * from there. QC is recorded for the
 * dataset as a whole and reviewed from Admin, so the page only shows its
 * state in the subtitle. Under the items, the catalogs it holds, if any,
 * and the first rows of the file the items came from, for a look at the
 * data itself.
 *
 * The trail above a dataset goes through its catalogs, each opening the
 * home page's rail on that catalog, where its other datasets are.
 */
export default async function CollectionPage({ params }: Props) {
  const env = await pageEnv(params);
  const { collection: raw } = await params;
  const id = decodeURIComponent(raw);
  const catalog = await getCatalog(env);
  const c = catalog.collections.find((collection) => collection.id === id);
  if (!c) return <NotInEnv env={env} collection={id} />;

  const tree = hierarchyOf(treeNodesOf(catalog.collections));
  const ancestors = collectionAncestors(c, catalog.collections);
  // Directly inside this version, with how much each holds.
  const inside: Inside[] = childCollectionsOf(c, catalog.collections).map((child) => ({
    collection: child,
    datasetsBelow: tree.datasetsBelow(child.series.id),
  }));
  if (c.kind === "catalog") {
    return <CatalogLayout env={env} c={c} ancestors={ancestors} inside={inside} datasetsBelow={tree.datasetsBelow(c.series.id)} />;
  }

  const rows = itemRowsOf(c);
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  // The file the items live in, for the Data panel.
  const source = dataFileOf(c);

  // Geometry the reader couldn't make sense of means none of the file's
  // geometry can be trusted: the map shows the country, empty, and says why.
  const brokenGeometry = c.geometryErrors > 0;
  const geo: FeatureCollection = {
    type: "FeatureCollection",
    features: (brokenGeometry ? [] : c.items)
      .filter((i) => i.geometry)
      .map((i) => ({
        type: "Feature",
        id: i.id,
        properties: {
          id: i.id,
          href: itemHref(env, c.id, i.id),
          label: rowOf.get(i.id)?.label,
          tag: rowOf.get(i.id)?.kind ?? undefined,
          tint: rowOf.get(i.id)?.tint,
        },
        geometry: i.geometry!,
      })),
  };

  // License and temporal extent sit under the description, as in STAC Browser.
  const facts: Entry[] = [
    ...(c.license ? [{ key: "license", value: c.license, label: "License" }] : []),
    ...(c.temporal[0] || c.temporal[1]
      ? [{ key: "temporal", value: fmtRange(c.temporal[0], c.temporal[1]), label: "Temporal extent" }]
      : []),
  ];

  const version = c.series.versions.find((v) => v.id === c.id)?.label ?? c.version;
  const meta: Entry[] = [
    { key: "id", value: c.id, label: "Id" },
    ...(version ? [{ key: "version", value: version, label: "Version" }] : []),
    { key: "items", value: c.itemCount, label: "Items" },
    ...(inside.length > 0 ? [{ key: "inside", value: inside.length, label: insideTitle(inside) }] : []),
    {
      key: "bbox",
      value: c.bbox ? c.bbox.map((n) => n.toFixed(4)).join(", ") : null,
      label: "Spatial extent",
    },
    ...(c.providers.length
      ? [{ key: "providers", value: c.providers.map((p) => `${p.name}${p.roles?.length ? ` (${p.roles.join(", ")})` : ""}`), label: "Providers" }]
      : []),
    ...Object.entries(c.extra).map(([key, value]) => ({ key, value })),
    { key: "sources", value: c.sources.map(baseName), label: c.sources.length > 1 ? "Source files" : "Source file" },
  ];

  return (
    <div className="sx-page">
      <PageHead
        crumbs={[
          homeCrumb(env),
          ...ancestors.map((parent) => parent.kind === "catalog"
            ? { label: parent.title, href: scopeHref(env, parent.series.id), catalog: true }
            : { label: parent.title, href: collectionHref(env, parent.id) }),
          { label: c.title },
        ]}
        title={c.title}
        subtitle={
          <>
            {c.series.versions.length < 2 && c.version && <span>{versionName(c.version)}</span>}
            <span>
              <span className="ffx-num">{fmtNum(c.itemCount)}</span> {c.itemCount === 1 ? "item" : "items"}
            </span>
            {inside.length > 0 && (
              <span>
                <span className="ffx-num">{fmtNum(inside.length)}</span> {insideTitle(inside).toLowerCase()}
              </span>
            )}
            {c.temporal[0] || c.temporal[1] ? (
              <span className="ffx-num">{fmtRange(c.temporal[0], c.temporal[1])}</span>
            ) : null}
            {!c.fromDocument && <span>metadata derived from the items</span>}
            <QcChip status={c.qc?.qc} />
          </>
        }
        nav={
          c.series.versions.length > 1 ? (
            <VersionMenu
              current={c.id}
              versions={c.series.versions.map((v) => ({
                key: v.id,
                href: collectionHref(env, v.id),
                name: versionName(v.label),
                id: v.id,
                latest: v.id === c.series.latest,
                deprecated: v.deprecated,
                qc: v.qc,
              }))}
            />
          ) : undefined
        }
        actions={
          <>
            <PreviewButton
              mode="json"
              url={collectionJsonHref(env, c.id)}
              file={`${c.id}.collection.json`}
              title={c.title}
              format="collection"
              icon={ICONS.json}
              actions={
                <>
                  <a href={`${collectionJsonHref(env, c.id)}?download=1`} className="ffx-btn ffx-btn-sm" download>
                    <Icon d={ICONS.download} size={12} /> Download
                  </a>
                  <a
                    href={collectionJsonHref(env, c.id)}
                    className="ffx-btn ffx-btn-sm ffx-btn-icon"
                    aria-label="Open the raw JSON in a new tab"
                    title="Open the raw JSON in a new tab"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon d={ICONS.external} size={12} />
                  </a>
                </>
              }
            >
              JSON
            </PreviewButton>
            <a href={`${collectionJsonHref(env, c.id)}?download=1`} className="ffx-btn ffx-btn-sm" download>
              <Icon d={ICONS.download} size={12} /> Download
            </a>
            <CopyButton currentUrl label="Copy link" icon={ICONS.link} />
          </>
        }
      />

      <VersionNotice env={env} c={c} />

      <ItemHoverProvider>
      <div className="sx-cols sx-collection-cols">
        <div className="sx-col">
          {(c.description || c.keywords.length > 0 || facts.length > 0) && (
            <CollapsiblePanel title="Description" id="about" defaultOpen={false}>
              {c.description && <div className="sx-desc ffx-prose">{c.description}</div>}
              {c.keywords.length > 0 && (
                <ul className="sx-keywords" aria-label="Keywords">
                  {c.keywords.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              )}
              {facts.length > 0 && (
                <div className="pb-2">
                  <MetaTable entries={facts} />
                </div>
              )}
            </CollapsiblePanel>
          )}
          <Panel title="Items" note={`${fmtNum(c.itemCount)}`} id="items">
            <ItemsList env={env} collection={c.id} rows={rows} />
          </Panel>
          {/* A dataset that also holds catalogs (Project Scoping's ten): they go along with it. */}
          {inside.length > 0 && (
            <Panel title={insideTitle(inside)} note={fmtNum(inside.length)} id="inside">
              <InsideRows env={env} inside={inside} />
            </Panel>
          )}
          {/* The rows as the pipeline wrote them, under the items they are. */}
          {source && (
            <Panel
              title="Data"
              id="data"
              actions={
                <span className="sx-panel-acts">
                  <span className="ffx-panel-note">{baseName(source)}</span>
                  <PreviewButton
                    url={`${collectionJsonHref(env, c.id)}/data`}
                    file={baseName(source)}
                    format={formatTag(null, source)}
                    actions={
                      <>
                        <a href={assetHref(source)} className="ffx-btn ffx-btn-sm" target="_blank" rel="noreferrer">
                          <Icon d={ICONS.download} size={12} /> Download
                        </a>
                        <CopyButton text={source} label={source.startsWith("s3://") ? "Copy S3 URI" : "Copy URL"} />
                      </>
                    }
                  >
                    Open
                  </PreviewButton>
                </span>
              }
            >
              <DataPanel href={`${collectionJsonHref(env, c.id)}/data`} />
            </Panel>
          )}
        </div>
        <div className="sx-col">
          {brokenGeometry && (
            <p className="sx-callout" role="status">
              The geometry in this dataset&apos;s file couldn&apos;t be read, so its items aren&apos;t drawn on the map.
              The rest of the page shows what the file has.
            </p>
          )}
          <div className="sx-mapcard">
            <LinkedMap
              data={geo}
              bbox={brokenGeometry ? LOWER_48 : c.bbox}
              label={`Items of ${c.title}`}
              hint={brokenGeometry ? "Geometry couldn't be read." : `${fmtNum(geo.features.length)} ${geo.features.length === 1 ? "item" : "items"}`}
              tip={brokenGeometry ? undefined : "Click one for a link to its page."}
            />
          </div>
          {/* Collection assets stay below the map; overview plots show inline. */}
          {Object.keys(c.assets).length > 0 && (
            <CollapsiblePanel title="Assets" note={assetNote(c.assets)} id="assets">
              <Assets assets={c.assets} plotsFirst />
            </CollapsiblePanel>
          )}
          <Panel title="Metadata" id="meta">
            <div className="pb-2">
              <MetaTable entries={meta} />
            </div>
          </Panel>
        </div>
      </div>
      </ItemHoverProvider>
    </div>
  );
}

/** "Catalogs inside" when that's all a dataset holds, which is the usual case; "Inside" when a dataset is among them. */
function insideTitle(inside: Inside[]): string {
  return inside.every((i) => i.collection.kind === "catalog") ? "Catalogs inside" : "Inside";
}
