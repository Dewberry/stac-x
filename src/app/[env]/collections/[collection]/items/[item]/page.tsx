import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { FeatureCollection } from "geojson";
import { Assets } from "@/components/assets";
import { CopyButton } from "@/components/copy-button";
import { DataMap } from "@/components/map";
import { MetaTable, type Entry } from "@/components/meta-table";
import { Icon, ICONS, PageHead, Panel } from "@/components/shell";
import { NotInEnv } from "@/components/not-in-env";
import { VersionNotice } from "@/components/version-notice";
import { getCollection } from "@/lib/catalog";
import { pageEnv } from "@/lib/page-env";
import { fmtNum, fmtRange, humanize, itemLabel, tidyCaps } from "@/lib/format";
import { collectionHref, itemJsonHref } from "@/lib/utils";
import { versionName } from "@/lib/versions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ env: string; collection: string; item: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const env = await pageEnv(params);
  const { collection, item } = await params;
  const c = await getCollection(env, decodeURIComponent(collection));
  const i = c?.items.find((x) => x.id === decodeURIComponent(item));
  const label = i ? itemLabel(i.properties) : null;
  return { title: i ? (label ? `${tidyCaps(label)} (${i.id})` : i.id) : "Item" };
}

/** The STAC "core" fields, shown first and under their own names. */
const CORE = ["datetime", "start_datetime", "end_datetime", "created", "updated", "title", "description"];

export default async function ItemPage({ params }: Props) {
  const env = await pageEnv(params);
  const { collection: rawC, item: rawI } = await params;
  const c = await getCollection(env, decodeURIComponent(rawC));
  if (!c) return <NotInEnv env={env} collection={decodeURIComponent(rawC)} />;
  const id = decodeURIComponent(rawI);
  const item = c.items.find((x) => x.id === id);
  if (!item) notFound();
  const version = c.series.versions.length > 1 ? c.series.versions.find((v) => v.id === c.id)?.label ?? null : null;

  const label = itemLabel(item.properties);
  const title = label ? tidyCaps(label) : item.id;
  const p = item.properties;

  const geo: FeatureCollection = {
    type: "FeatureCollection",
    features: item.geometry
      ? [{ type: "Feature", id: item.id, properties: { id: item.id, label: title }, geometry: item.geometry }]
      : [],
  };

  const core: Entry[] = [
    { key: "id", value: item.id, label: "Id" },
    ...(p.start_datetime || p.end_datetime
      ? [{ key: "range", value: fmtRange(str(p.start_datetime), str(p.end_datetime)), label: "Period" }]
      : []),
    ...CORE.filter((k) => k in p && k !== "title" && k !== "description").map((k) => ({ key: k, value: p[k] })),
    ...(item.bbox ? [{ key: "bbox", value: item.bbox.map((n) => n.toFixed(5)).join(", "), label: "Bounding box" }] : []),
    { key: "geometry_type", value: item.geometry?.type ?? null, label: "Geometry" },
  ];
  const rest: Entry[] = Object.entries(p)
    .filter(([k]) => !CORE.includes(k))
    .map(([key, value]) => ({ key, value }));

  const links = item.links.filter((l) => !["self", "parent", "root", "collection"].includes(l.rel));
  const structural = item.links.filter((l) => ["self", "parent", "root", "collection"].includes(l.rel));

  return (
    <div className="sx-page">
      <PageHead
        title={title}
        subtitle={
          <>
            {label && <span className="ffx-id">{item.id}</span>}
            {(p.start_datetime || p.end_datetime) && (
              <span className="ffx-num">{fmtRange(str(p.start_datetime), str(p.end_datetime))}</span>
            )}
            {typeof p.drain_area_va === "number" && <span>{p.drain_area_va} mi² drainage</span>}
            {!label && str(p.description)}
          </>
        }
        nav={
          <>
            <Link href={collectionHref(env, c.id)} className="ffx-btn ffx-btn-sm" title={`Go to the collection: ${c.title}`}>
              <Icon d={ICONS.folder} size={12} /> Collection
            </Link>
            <Link href={collectionHref(env, c.id)} className="ffx-btn ffx-btn-sm" title={`Go to parent: ${c.title}`}>
              <Icon d={ICONS.up} size={12} /> Up
            </Link>
          </>
        }
        actions={
          <>
            <a
              href={itemJsonHref(env, c.id, item.id)}
              className="ffx-btn ffx-btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              <Icon d={ICONS.json} size={12} /> JSON
            </a>
            <a
              href={`${itemJsonHref(env, c.id, item.id)}?download=1`}
              className="ffx-btn ffx-btn-sm"
              download
            >
              <Icon d={ICONS.download} size={12} /> Download
            </a>
            <CopyButton currentUrl label="Copy link" icon={ICONS.link} />
          </>
        }
      />

      <VersionNotice env={env} c={c} item={item.id} />

      {/* STAC Browser's item layout: map, assets and other links on the
          left; description, the parent collection and metadata on the right. */}
      <div className="sx-cols">
        <div className="sx-col">
          <div className="sx-mapcard">
            <DataMap
              data={geo}
              bbox={item.bbox}
              selected={item.id}
              label={`Location of ${title}`}
              hint={item.geometry ? `${item.geometry.type}, WGS 84` : "No geometry on this item."}
            />
          </div>
          <Panel title="Assets" note={`${Object.keys(item.assets).length}`} id="assets">
            <Assets assets={item.assets} />
          </Panel>
          {links.length > 0 && (
            <Panel title="Additional resources" id="links">
              <ul className="divide-y divide-grid pb-1">
                {links.map((l, i) => (
                  <li key={`${l.rel}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-[var(--ffx-panel-pad)] py-2">
                    <a href={l.href} className="ffx-link" target="_blank" rel="noreferrer">
                      {l.title || l.href}
                    </a>
                    <span className="sx-tag">{l.rel}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <div className="sx-col">
          {str(p.description) && label && (
            <Panel title="Description">
              <div className="sx-desc ffx-prose">{str(p.description)}</div>
            </Panel>
          )}
          <Panel title="Collection" id="collection">
            <Link href={collectionHref(env, c.id)} className="sx-row">
              <div className="sx-row-main">
                <div className="sx-row-title">{version ? `${c.title}, ${versionName(version)}` : c.title}</div>
                <div className="sx-row-sub">
                  {c.title !== c.id && <span className="ffx-id">{c.id}</span>}
                  <span>
                    <span className="ffx-num">{fmtNum(c.itemCount)}</span> items
                  </span>
                  {(c.temporal[0] || c.temporal[1]) && (
                    <span className="ffx-num">{fmtRange(c.temporal[0], c.temporal[1])}</span>
                  )}
                </div>
                {c.description && <p className="sx-row-desc">{c.description}</p>}
              </div>
            </Link>
          </Panel>
          <Panel title="Metadata" id="meta">
            <div className="pb-2">
              <div className="sx-meta-group">General</div>
              <MetaTable entries={core} />
              {rest.length > 0 && (
                <>
                  <div className="sx-meta-group">Properties</div>
                  <MetaTable entries={rest.map((e) => ({ ...e, label: humanize(e.key) }))} />
                </>
              )}
              {structural.length > 0 && (
                <>
                  <div className="sx-meta-group">STAC</div>
                  <MetaTable
                    entries={[
                      { key: "stac_version", value: item.stac_version },
                      { key: "stac_extensions", value: item.stac_extensions },
                      ...structural.map((l) => ({ key: `link_${l.rel}`, value: l.href, label: `${humanize(l.rel)} link` })),
                    ]}
                  />
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
