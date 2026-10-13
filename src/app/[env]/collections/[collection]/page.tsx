import type { Metadata } from "next";
import type { FeatureCollection } from "geojson";
import { assetNote, Assets } from "@/components/assets";
import { CopyButton } from "@/components/copy-button";
import { ItemHoverProvider, LinkedMap } from "@/components/item-hover";
import { ItemsList, type ItemRow } from "@/components/items-list";
import { MetaTable, type Entry } from "@/components/meta-table";
import { QcChip } from "@/components/qc-chip";
import { homeCrumb, Icon, ICONS, PageHead, Panel } from "@/components/shell";
import { NotInEnv } from "@/components/not-in-env";
import { VersionMenu } from "@/components/version-menu";
import { VersionNotice } from "@/components/version-notice";
import { getCollection } from "@/lib/catalog";
import { pageEnv } from "@/lib/page-env";
import { fmtNum, fmtRange } from "@/lib/format";
import { collectionKindLabel, itemRowLabel } from "@/lib/item-kinds";
import { shapeGroups, tintOf } from "@/lib/overview";
import { baseName } from "@/lib/storage";
import { collectionJsonHref, itemHref } from "@/lib/utils";
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
 * A collection: the STAC Browser layout. The left column is what describes
 * the collection (description, license and temporal extent, the map, then
 * metadata) and the right column is its items. QC is recorded for the
 * collection as a whole and reviewed from Admin, so the page only shows its
 * state in the subtitle.
 */
export default async function CollectionPage({ params }: Props) {
  const env = await pageEnv(params);
  const { collection: raw } = await params;
  const id = decodeURIComponent(raw);
  const c = await getCollection(env, id);
  if (!c) return <NotInEnv env={env} collection={id} />;

  // An item without a title is named for what it is ("Storm event 1",
  // "Terrain tile"), the same as on its own page, never its bare id. In a
  // calibration collection the HMS and RAS models share the basin's name,
  // so each row also says which it is.
  // A few distinct shapes each get their own blue, the same as on the
  // landing page, and the row carries the swatch.
  const groups = shapeGroups(c.items);
  const tintOfItem = new Map(groups.flatMap((ids, i) => ids.map((id) => [id, tintOf(i, groups.length)] as const)));
  const rows: ItemRow[] = c.items.map((i) => ({
    id: i.id,
    ...itemRowLabel(c, i),
    tint: tintOfItem.get(i.id),
    start: str(i.properties.start_datetime) ?? str(i.properties.datetime),
    end: str(i.properties.end_datetime) ?? null,
  }));
  const rowOf = new Map(rows.map((r) => [r.id, r]));

  const geo: FeatureCollection = {
    type: "FeatureCollection",
    features: c.items
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
        crumbs={[homeCrumb(env), { label: c.title }]}
        kicker={collectionKindLabel(c) ?? undefined}
        title={c.title}
        subtitle={
          <>
            {c.title !== c.id && <span className="ffx-id">{c.id}</span>}
            {c.series.versions.length < 2 && c.version && <span>{versionName(c.version)}</span>}
            <span>
              <span className="ffx-num">{fmtNum(c.itemCount)}</span> items
            </span>
            {c.temporal[0] || c.temporal[1] ? (
              <span className="ffx-num">{fmtRange(c.temporal[0], c.temporal[1])}</span>
            ) : null}
            {!c.fromDocument && <span>metadata derived from the items</span>}
            <QcChip status={c.qc?.qc} />
          </>
        }
        nav={c.series.versions.length > 1 ? <VersionMenu env={env} current={c.id} series={c.series} /> : undefined}
        actions={
          <>
            <a href={collectionJsonHref(env, c.id)} className="ffx-btn ffx-btn-sm" target="_blank" rel="noreferrer">
              <Icon d={ICONS.json} size={12} /> JSON
            </a>
            <a href={`${collectionJsonHref(env, c.id)}?download=1`} className="ffx-btn ffx-btn-sm" download>
              <Icon d={ICONS.download} size={12} /> Download
            </a>
            <CopyButton currentUrl label="Copy link" icon={ICONS.link} />
          </>
        }
      />

      <VersionNotice env={env} c={c} />

      <ItemHoverProvider>
      <div className="sx-cols">
        <div className="sx-col">
          {(c.description || c.keywords.length > 0 || facts.length > 0) && (
            <Panel title="Description" id="about">
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
            </Panel>
          )}
          <div className="sx-mapcard">
            <LinkedMap
              data={geo}
              bbox={c.bbox}
              label={`Items of ${c.title}`}
              hint={`${fmtNum(geo.features.length)} ${geo.features.length === 1 ? "item" : "items"}`}
              tip="Click one for a link to its page."
            />
          </div>
          {/* The collection's own files sit in the slot STAC Browser gives them
              after the map. Overview plots show inline like an item's. */}
          {Object.keys(c.assets).length > 0 && (
            <Panel title="Assets" note={assetNote(c.assets)} id="assets">
              <Assets assets={c.assets} plotsFirst />
            </Panel>
          )}
          <Panel title="Metadata" id="meta">
            <div className="pb-2">
              <MetaTable entries={meta} />
            </div>
          </Panel>
        </div>
        <div className="sx-col">
          <Panel title="Items" note={`${fmtNum(c.itemCount)}`} id="items">
            <ItemsList env={env} collection={c.id} rows={rows} />
          </Panel>
        </div>
      </div>
      </ItemHoverProvider>
    </div>
  );
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
