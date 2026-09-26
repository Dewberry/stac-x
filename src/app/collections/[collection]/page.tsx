import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { FeatureCollection } from "geojson";
import { CopyButton } from "@/components/copy-button";
import { ItemsList, type ItemRow } from "@/components/items-list";
import { DataMap } from "@/components/map";
import { MetaTable, type Entry } from "@/components/meta-table";
import { QcChip } from "@/components/qc-chip";
import { Icon, ICONS, PageHead, Panel } from "@/components/shell";
import { getCollection } from "@/lib/catalog";
import { fmtNum, fmtRange, itemLabel, tidyCaps } from "@/lib/format";
import { QC_STATUSES } from "@/lib/stac";
import { baseName } from "@/lib/storage";
import { itemHref } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ collection: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { collection } = await params;
  const c = await getCollection(decodeURIComponent(collection));
  return { title: c ? c.title : "Collection" };
}

/**
 * A collection: the STAC Browser layout. Map and metadata in the narrow
 * column, description and the item list in the wide one.
 */
export default async function CollectionPage({ params }: Props) {
  const { collection: raw } = await params;
  const id = decodeURIComponent(raw);
  const c = await getCollection(id);
  if (!c) notFound();

  const rows: ItemRow[] = c.items.map((i) => {
    const label = itemLabel(i.properties);
    return {
      id: i.id,
      label: label ? tidyCaps(label) : null,
      start: str(i.properties.start_datetime) ?? str(i.properties.datetime),
      end: str(i.properties.end_datetime) ?? null,
      qc: i.edit?.qc ?? "pending",
      dateApproved: i.edit?.date_approved ?? null,
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
          href: itemHref(c.id, i.id),
          label: itemLabel(i.properties) ? tidyCaps(itemLabel(i.properties)!) : undefined,
          qc: i.edit?.qc ?? "pending",
        },
        geometry: i.geometry!,
      })),
  };

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.qc] = (counts[r.qc] ?? 0) + 1;
  const reviewed = rows.length - (counts.pending ?? 0);

  const meta: Entry[] = [
    { key: "id", value: c.id, label: "Id" },
    { key: "items", value: c.itemCount, label: "Items" },
    { key: "temporal", value: fmtRange(c.temporal[0], c.temporal[1]) || null, label: "Temporal extent" },
    {
      key: "bbox",
      value: c.bbox ? c.bbox.map((n) => n.toFixed(4)).join(", ") : null,
      label: "Spatial extent",
    },
    ...(c.license ? [{ key: "license", value: c.license, label: "License" }] : []),
    ...(c.keywords.length ? [{ key: "keywords", value: c.keywords, label: "Keywords" }] : []),
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
            <span>
              <span className="ffx-num">{fmtNum(c.itemCount)}</span> items
            </span>
            {c.temporal[0] || c.temporal[1] ? (
              <span className="ffx-num">{fmtRange(c.temporal[0], c.temporal[1])}</span>
            ) : null}
            {!c.fromDocument && <span>metadata derived from the items</span>}
          </>
        }
        actions={
          <>
            <Link href="/" className="ffx-btn ffx-btn-sm">
              <Icon d={ICONS.up} size={12} /> Up
            </Link>
            <CopyButton currentUrl label="Copy link" icon={ICONS.link} />
            <a href={`/api/collections/${encodeURIComponent(c.id)}`} className="ffx-btn ffx-btn-sm" target="_blank" rel="noreferrer">
              <Icon d={ICONS.json} size={12} /> JSON
            </a>
            <a href={`/api/collections/${encodeURIComponent(c.id)}?download=1`} className="ffx-btn ffx-btn-sm" download>
              <Icon d={ICONS.download} size={12} /> Download
            </a>
          </>
        }
      />

      <div className="sx-mapwide">
        <DataMap
          data={geo}
          bbox={c.bbox}
          label={`Items of ${c.title}`}
          hint={`${fmtNum(geo.features.length)} items located. Point at one for its name, click to open it.`}
        />
      </div>

      <div className="sx-cols">
        <div className="sx-col">
          <Panel title="Review progress" id="qc">
            <div className="px-[var(--ffx-panel-pad)] pb-[var(--ffx-panel-pad)] pt-1">
              <div className="sx-bar" role="img" aria-label={`${reviewed} of ${rows.length} items reviewed`}>
                {QC_STATUSES.filter((s) => s.value !== "pending").map((s) => (
                  <span
                    key={s.value}
                    style={{ width: `${((counts[s.value] ?? 0) / Math.max(1, rows.length)) * 100}%`, background: `var(--ffx-${s.tone})` }}
                  />
                ))}
              </div>
              <div className="sx-bar-legend">
                {QC_STATUSES.map((s) => (
                  <span key={s.value} className="inline-flex items-center gap-1.5">
                    <QcChip status={s.value} />
                    <span className="ffx-num text-micro text-ink-mut">{counts[s.value] ?? 0}</span>
                  </span>
                ))}
              </div>
            </div>
          </Panel>
          {c.description && (
            <Panel title="About">
              <div className="sx-desc ffx-prose">{c.description}</div>
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
            <ItemsList collection={c.id} rows={rows} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
