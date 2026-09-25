import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { FeatureCollection } from "geojson";
import { Assets } from "@/components/assets";
import { CopyButton } from "@/components/copy-button";
import { DataMap } from "@/components/map";
import { MetaTable, type Entry } from "@/components/meta-table";
import { QcForm } from "@/components/qc-form";
import { Icon, ICONS, PageHead, Panel } from "@/components/shell";
import { getCollection } from "@/lib/catalog";
import { fmtRange, humanize, itemLabel, tidyCaps } from "@/lib/format";
import { collectionHref, itemHref } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ collection: string; item: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { collection, item } = await params;
  const c = await getCollection(decodeURIComponent(collection));
  const i = c?.items.find((x) => x.id === decodeURIComponent(item));
  const label = i ? itemLabel(i.properties) : null;
  return { title: i ? (label ? `${tidyCaps(label)} (${i.id})` : i.id) : "Item" };
}

/** The STAC "core" fields, shown first and under their own names. */
const CORE = ["datetime", "start_datetime", "end_datetime", "created", "updated", "title", "description"];

export default async function ItemPage({ params }: Props) {
  const { collection: rawC, item: rawI } = await params;
  const c = await getCollection(decodeURIComponent(rawC));
  if (!c) notFound();
  const id = decodeURIComponent(rawI);
  const index = c.items.findIndex((x) => x.id === id);
  if (index < 0) notFound();
  const item = c.items[index];
  const prev = c.items[index - 1] ?? null;
  const next = c.items[index + 1] ?? null;

  const label = itemLabel(item.properties);
  const title = label ? tidyCaps(label) : item.id;
  const p = item.properties;

  const geo: FeatureCollection = {
    type: "FeatureCollection",
    features: item.geometry
      ? [{ type: "Feature", id: item.id, properties: { id: item.id, label: title, qc: item.edit?.qc ?? "pending" }, geometry: item.geometry }]
      : [],
  };

  const core: Entry[] = [
    { key: "id", value: item.id, label: "Id" },
    { key: "collection", value: c.id, label: "Collection" },
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
        actions={
          <>
            <Link href={collectionHref(c.id)} className="ffx-btn ffx-btn-sm">
              <Icon d={ICONS.up} size={12} /> {c.title}
            </Link>
            {prev ? (
              <Link href={itemHref(c.id, prev.id)} className="ffx-btn ffx-btn-sm" aria-label={`Previous item, ${prev.id}`}>
                <Icon d={ICONS.prev} size={12} /> Prev
              </Link>
            ) : (
              <button type="button" className="ffx-btn ffx-btn-sm" disabled>
                <Icon d={ICONS.prev} size={12} /> Prev
              </button>
            )}
            {next ? (
              <Link href={itemHref(c.id, next.id)} className="ffx-btn ffx-btn-sm" aria-label={`Next item, ${next.id}`}>
                Next <Icon d={ICONS.next} size={12} />
              </Link>
            ) : (
              <button type="button" className="ffx-btn ffx-btn-sm" disabled>
                Next <Icon d={ICONS.next} size={12} />
              </button>
            )}
            <CopyButton currentUrl label="Copy link" icon={ICONS.link} />
            <a
              href={`/api/collections/${encodeURIComponent(c.id)}/items/${encodeURIComponent(item.id)}`}
              className="ffx-btn ffx-btn-sm"
              target="_blank"
              rel="noreferrer"
            >
              <Icon d={ICONS.json} size={12} /> JSON
            </a>
          </>
        }
      />

      <div className="sx-mapwide">
        <DataMap
          data={geo}
          bbox={item.bbox}
          selected={item.id}
          label={`Location of ${title}`}
          hint={item.geometry ? `${item.geometry.type}, WGS 84` : "No geometry on this item."}
        />
      </div>

      <div className="sx-cols">
        <div className="sx-col">
          <Panel title="Assets" note={`${Object.keys(item.assets).length}`} id="assets">
            <Assets assets={item.assets} />
          </Panel>
          {links.length > 0 && (
            <Panel title="Links" id="links">
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
            <Panel title="About">
              <div className="sx-desc ffx-prose">{str(p.description)}</div>
            </Panel>
          )}
          <Panel title="Quality control" note="Writes to the bucket" id="qc">
            <div className="px-[var(--ffx-panel-pad)] pb-[var(--ffx-panel-pad)] pt-1">
              <QcForm collection={c.id} id={item.id} edit={item.edit} />
            </div>
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
