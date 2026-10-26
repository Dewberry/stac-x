import Link from "next/link";
import { CopyButton } from "./copy-button";
import { FolderGlyph, ICONS } from "./icons";
import { MetaTable, type Entry } from "./meta-table";
import { QC_LABEL, QcMark } from "./qc-mark";
import { CollapsiblePanel, homeCrumb, PageHead, Panel } from "./shell";
import type { EnvKey } from "@/lib/env";
import { unitOf } from "@/lib/footprint";
import { fmtNum } from "@/lib/format";
import type { Collection } from "@/lib/stac";
import { collectionHref } from "@/lib/utils";

/**
 * A catalog's page. A catalog is a folder (lib/collection-hierarchy.ts):
 * a title, a description and what's inside, nothing else. So it has no map,
 * items, assets, review state or JSON to download, all of which would say
 * there's data here when there isn't. What's inside comes datasets first,
 * then the catalogs inside it with how much each holds. The right column
 * says where it sits and the few facts it has.
 *
 * The columns split the way a dataset's page does: what to browse on the
 * left, the rest on the right.
 */

/** A node directly inside a catalog, or inside a dataset that holds catalogs. */
export type Inside = { collection: Collection; datasetsBelow: number };

const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`;

/** "Nothing in it yet" for an empty catalog, or how many datasets are anywhere below it. */
const holds = (n: number) => (n ? plural(n, "dataset", "datasets") : "Nothing in it yet");

/**
 * The line beside a catalog's title: "6 datasets · 17 catalogs inside with
 * nothing in them yet", or "3 catalogs inside · no datasets anywhere below
 * yet" when it's empty all the way down.
 */
function summaryOf(datasetsBelow: number, inside: Inside[]): string {
  const catalogs = inside.filter((i) => i.collection.kind === "catalog");
  const empty = catalogs.filter((i) => !i.datasetsBelow).length;
  if (datasetsBelow) {
    const tail = empty === 1 ? "1 catalog inside with nothing in it yet" : `${fmtNum(empty)} catalogs inside with nothing in them yet`;
    return empty ? `${plural(datasetsBelow, "dataset", "datasets")} · ${tail}` : plural(datasetsBelow, "dataset", "datasets");
  }
  return catalogs.length ? `${plural(catalogs.length, "catalog inside", "catalogs inside")} · no datasets anywhere below yet` : "Nothing in it yet";
}

/** A dataset inside a catalog: its name and review state, its count at the right. */
function DatasetRow({ env, c }: { env: EnvKey; c: Collection }) {
  const state = c.qc?.qc ?? "pending";
  const unit = unitOf(c);
  const one: Record<typeof unit, string> = { points: "point", shapes: "shape", items: "item" };
  return (
    <li>
      <Link href={collectionHref(env, c.id)} className="sx-row sx-inside-row">
        <span className="sx-row-main">
          <span className="sx-row-title">{c.title}</span>
          <span className="sx-row-sub">
            <span className="sx-inside-qc">
              <QcMark state={state} />
              {QC_LABEL[state]}
            </span>
          </span>
        </span>
        <span className="sx-inside-count">
          <b className="ffx-num">{fmtNum(c.itemCount)}</b> {c.itemCount === 1 ? one[unit] : unit}
        </span>
      </Link>
    </li>
  );
}

/** A catalog inside another, or inside a dataset: folder, name, id, description, and how much it holds. */
function CatalogRow({ env, inside }: { env: EnvKey; inside: Inside }) {
  const c = inside.collection;
  return (
    <li>
      <Link href={collectionHref(env, c.id)} className="sx-row sx-inside-row" data-kind="catalog">
        <span className="sx-row-main">
          <span className="sx-row-title">
            <FolderGlyph />
            {c.title}
          </span>
          {c.title !== c.id && <span className="ffx-id sx-inside-id">{c.id}</span>}
          {c.description && <span className="sx-row-desc">{c.description}</span>}
        </span>
        <span className="sx-inside-status">{holds(inside.datasetsBelow)}</span>
      </Link>
    </li>
  );
}

/** What's directly inside a catalog or a dataset: datasets first, then catalogs, each a link to its page. */
export function InsideRows({ env, inside }: { env: EnvKey; inside: Inside[] }) {
  return (
    <ul className="sx-inside-list">
      {inside
        .filter((i) => i.collection.kind === "dataset")
        .map((i) => (
          <DatasetRow key={i.collection.id} env={env} c={i.collection} />
        ))}
      {inside
        .filter((i) => i.collection.kind === "catalog")
        .map((i) => (
          <CatalogRow key={i.collection.id} env={env} inside={i} />
        ))}
    </ul>
  );
}

/** The FFRD fields a generated catalog carries, nested or prefixed. */
function ffrdField(c: Collection, name: string): unknown {
  const nested = c.extra.ffrd;
  if (nested && typeof nested === "object" && name in nested) return (nested as Record<string, unknown>)[name];
  return c.extra[`ffrd:${name}`];
}

export function CatalogLayout({
  env,
  c,
  ancestors,
  inside,
  datasetsBelow,
}: {
  env: EnvKey;
  c: Collection;
  /** The catalogs above it, top first. */
  ancestors: Collection[];
  /** What's directly inside it, by name. */
  inside: Inside[];
  datasetsBelow: number;
}) {
  const type = ffrdField(c, "catalog_type");
  const spec = ffrdField(c, "specification_version");
  const details: Entry[] = [
    { key: "id", value: c.id, label: "Id" },
    { key: "kind", value: "Catalog", label: "Kind" },
    ...(type != null ? [{ key: "catalog_type", value: type, label: "Catalog type" }] : []),
    ...(spec != null ? [{ key: "specification_version", value: spec, label: "Specification version" }] : []),
  ];
  return (
    <div className="sx-page">
      <PageHead
        crumbs={[
          homeCrumb(env),
          ...ancestors.map((a) => ({ label: a.title, href: collectionHref(env, a.id), catalog: a.kind === "catalog" })),
          { label: c.title, catalog: true },
        ]}
        title={
          <span className="sx-catalog-title">
            <FolderGlyph size={22} />
            {c.title}
          </span>
        }
        subtitle={
          <>
            <span className="sx-kind">Catalog</span>
            <span>{summaryOf(datasetsBelow, inside)}</span>
          </>
        }
        actions={<CopyButton currentUrl label="Copy link" icon={ICONS.link} />}
      />

      <div className="sx-cols">
        <div className="sx-col">
          {(c.description || c.keywords.length > 0) && (
            <CollapsiblePanel title="Description" id="about">
              {c.description && <div className="sx-desc ffx-prose">{c.description}</div>}
              {c.keywords.length > 0 && (
                <ul className="sx-keywords" aria-label="Keywords">
                  {c.keywords.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              )}
            </CollapsiblePanel>
          )}
          <Panel title="Inside" note={inside.length ? fmtNum(inside.length) : undefined} id="inside">
            {inside.length ? (
              <InsideRows env={env} inside={inside} />
            ) : (
              <p className="sx-empty">Nothing in it yet.</p>
            )}
            <p className="sx-inside-note">
              A catalog is a folder. It has no extent, no items and no review state of its own; datasets that land
              inside it get reviewed one by one.
            </p>
          </Panel>
        </div>
        <div className="sx-col">
          {ancestors.length > 0 && (
            <Panel title="Where this sits" id="where">
              <ol className="sx-sits">
                {ancestors.map((a, i) => (
                  <li key={a.id} style={{ "--depth": i } as React.CSSProperties}>
                    <Link href={collectionHref(env, a.id)}>
                      {a.kind === "catalog" && <FolderGlyph />}
                      {a.title}
                    </Link>
                  </li>
                ))}
                <li style={{ "--depth": ancestors.length } as React.CSSProperties} aria-current="page">
                  <FolderGlyph />
                  {c.title}
                </li>
              </ol>
            </Panel>
          )}
          <Panel title="Details" id="details">
            <div className="pb-2">
              <MetaTable entries={details} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
