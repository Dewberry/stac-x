import type { Metadata } from "next";
import Link from "next/link";
import type { FeatureCollection } from "geojson";
import { CopyButton } from "@/components/copy-button";
import { ItemsList, type ItemRow } from "@/components/items-list";
import { DataMap } from "@/components/map";
import { MetaTable, type Entry } from "@/components/meta-table";
import { QcChip } from "@/components/qc-chip";
import { QcForm } from "@/components/qc-form";
import { Icon, ICONS, PageHead, Panel } from "@/components/shell";
import { NotInEnv } from "@/components/not-in-env";
import { PromotionPath } from "@/components/promotion-path";
import { QcHistory } from "@/components/qc-history";
import { VersionMenu } from "@/components/version-menu";
import { VersionNotice } from "@/components/version-notice";
import { getCollection } from "@/lib/catalog";
import { ENVS } from "@/lib/env";
import { pageEnv } from "@/lib/page-env";
import { fmtNum, fmtRange, itemLabel, tidyCaps } from "@/lib/format";
import { baseName } from "@/lib/storage";
import { collectionJsonHref, itemHref, withEnvHome } from "@/lib/utils";
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
 * collection as a whole, so its form sits in the left column under the map.
 */
export default async function CollectionPage({ params }: Props) {
  const env = await pageEnv(params);
  const { collection: raw } = await params;
  const id = decodeURIComponent(raw);
  const c = await getCollection(env, id);
  if (!c) return <NotInEnv env={env} collection={id} />;
  // Where else the collection is, for the promotion path.
  const everywhere = await Promise.all(
    ENVS.map(async (e) => ({ env: e.key, collection: e.key === env ? c : await getCollection(e.key, id) })),
  );

  const rows: ItemRow[] = c.items.map((i) => {
    const label = itemLabel(i.properties);
    return {
      id: i.id,
      label: label ? tidyCaps(label) : null,
      start: str(i.properties.start_datetime) ?? str(i.properties.datetime),
      end: str(i.properties.end_datetime) ?? null,
    };
  });

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
          label: itemLabel(i.properties) ? tidyCaps(itemLabel(i.properties)!) : undefined,
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
        title={c.title}
        subtitle={
          <>
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
        nav={
          <>
            <Link href={withEnvHome(env)} className="ffx-btn ffx-btn-sm" title="Go to parent: Colorado">
              <Icon d={ICONS.up} size={12} /> Up
            </Link>
            {c.series.versions.length > 1 && <VersionMenu env={env} current={c.id} series={c.series} />}
          </>
        }
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
            <DataMap
              data={geo}
              bbox={c.bbox}
              label={`Items of ${c.title}`}
              hint={`${fmtNum(geo.features.length)} items located. Point at one for its name, click to open it.`}
            />
          </div>
          <Panel title="Quality control" id="qc">
            <div className="px-[var(--ffx-panel-pad)] pb-[var(--ffx-panel-pad)] pt-1">
              <PromotionPath current={env} stages={everywhere.map((s) => ({ env: s.env, qc: s.collection ? s.collection.qc?.qc ?? "pending" : null }))} />
              <QcForm env={env} collection={c.id} edit={c.qc} />
            </div>
          </Panel>
          {c.history.length > 0 && (
            <Panel title="History" id="history">
              <QcHistory events={c.history} />
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
    </div>
  );
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
