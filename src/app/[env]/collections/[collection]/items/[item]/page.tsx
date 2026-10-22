import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { FeatureCollection } from "geojson";
import { assetNote, Assets } from "@/components/assets";
import { CopyButton } from "@/components/copy-button";
import { PreviewButton } from "@/components/data-modal";
import { DataMap } from "@/components/map";
import { MetadataPanel, type Entry } from "@/components/meta-table";
import { homeCrumb, Icon, ICONS, PageHead, Panel } from "@/components/shell";
import { NotInEnv } from "@/components/not-in-env";
import { VersionNotice } from "@/components/version-notice";
import { getCollection } from "@/lib/catalog";
import { pageEnv } from "@/lib/page-env";
import { collectionName, fmtDate, fmtNum, fmtRange, humanize, itemLabel, tidyCaps } from "@/lib/format";
import { itemKindLabel, projectTitle, untitledName } from "@/lib/item-kinds";
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

  const p = item.properties;
  const kind = itemKindLabel(c, item);
  // An item without a title is named for what it is, or for its model
  // project, never its bare id; the id is always in the chip beside it.
  const project = projectTitle(p);
  const label = itemLabel(p) ?? (project ? collectionName(project, project) : null);
  const unnamed = label ? null : untitledName(kind, item.id);
  const title = label ? tidyCaps(label) : unnamed!.title;
  const assetCount = Object.keys(item.assets).length;
  // The collection is named in the trail as it is in its own card below:
  // with its version when there's more than one to tell apart.
  const collectionLabel = version ? `${c.title}, ${versionName(version)}` : c.title;

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
        crumbs={[homeCrumb(env), { label: collectionLabel, href: collectionHref(env, c.id) }, { label: title }]}
        kicker={unnamed ? c.title : undefined}
        title={title}
        subtitle={
          <>
            {!unnamed?.idInTitle && <span className="ffx-id">{item.id}</span>}
            {p.start_datetime || p.end_datetime ? (
              <span className="ffx-num">{fmtRange(str(p.start_datetime), str(p.end_datetime))}</span>
            ) : (
              str(p.datetime) && <span className="ffx-num">{fmtDate(str(p.datetime), { time: false })}</span>
            )}
            {typeof p.drain_area_va === "number" && <span>{p.drain_area_va} mi² drainage</span>}
            {assetCount > 0 && (
              <span>
                <span className="ffx-num">{fmtNum(assetCount)}</span> {assetCount === 1 ? "asset" : "assets"}
              </span>
            )}
          </>
        }
        actions={
          <>
            <PreviewButton
              mode="json"
              url={itemJsonHref(env, c.id, item.id)}
              file={`${item.id}.json`}
              title={title}
              format="item"
              icon={ICONS.json}
              actions={
                <>
                  <a href={`${itemJsonHref(env, c.id, item.id)}?download=1`} className="ffx-btn ffx-btn-sm" download>
                    <Icon d={ICONS.download} size={12} /> Download
                  </a>
                  <a
                    href={itemJsonHref(env, c.id, item.id)}
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
          <Panel title="Assets" note={assetNote(item.assets)} id="assets">
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
          {str(p.description) && (
            <Panel title="Description">
              <div className="sx-desc ffx-prose">{str(p.description)}</div>
            </Panel>
          )}
          <Panel title="Collection" id="collection">
            <Link href={collectionHref(env, c.id)} className="sx-row">
              <div className="sx-row-main">
                <div className="sx-row-title">{collectionLabel}</div>
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
          <MetadataPanel
            sections={[
              { title: "General", entries: core },
              ...(rest.length ? [{ title: "Properties", entries: rest.map((e) => ({ ...e, label: humanize(e.key) })) }] : []),
              ...(structural.length
                ? [
                    {
                      title: "STAC",
                      collapsible: true,
                      summary: [
                        `version ${item.stac_version}`,
                        plural(item.stac_extensions?.length ?? 0, "extension"),
                        plural(structural.length, "link"),
                      ].join(" · "),
                      entries: [
                        { key: "stac_version", value: item.stac_version },
                        { key: "stac_extensions", value: item.stac_extensions },
                        ...structural.map((l) => ({ key: `link_${l.rel}`, value: l.href, label: `${humanize(l.rel)} link` })),
                      ],
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${fmtNum(n)} ${word}${n === 1 ? "" : "s"}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
