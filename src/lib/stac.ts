import type { NodeKind } from "./collection-hierarchy";
import type { EnvKey } from "./env";
import type { Geometry } from "geojson";

/**
 * STAC types, as narrow as this app needs them.
 *
 * The parquet rows come in as stac-geoparquet: the STAC top-level fields are
 * columns, every other column is an item property, and geometry is WKB. The
 * reader in parquet.ts turns a row back into a plain STAC Item so that the rest
 * of the app never knows the data came from parquet.
 */

export type StacLink = {
  href: string;
  rel: string;
  title?: string | null;
  type?: string | null;
};

export type StacAsset = {
  href: string;
  title?: string | null;
  description?: string | null;
  type?: string | null;
  roles?: string[] | null;
  /** Anything else on the asset, such as file:values, is kept and shown. */
  [key: string]: unknown;
};

export type StacItem = {
  type: "Feature";
  stac_version: string;
  stac_extensions: string[];
  id: string;
  collection: string;
  geometry: Geometry | null;
  /** Why the row's geometry couldn't be read, when it couldn't. Not in the STAC JSON. */
  geometryError?: string;
  bbox: [number, number, number, number] | null;
  properties: Record<string, unknown>;
  links: StacLink[];
  assets: Record<string, StacAsset>;
};

/** A collection's QC record: the editable fields, plus when it was saved. */
export type QcEdit = {
  qc: QcStatus;
  date_approved: string | null;
  note?: string | null;
  updated_at: string;
};

/**
 * One line of a collection's history in an environment: a QC save, the
 * collection leaving for the next environment, or arriving from the one
 * before. Oldest first in the sidecar.
 */
export type QcEvent =
  | { kind: "qc"; at: string; qc: QcStatus; date_approved: string | null; note?: string | null }
  | { kind: "promoted"; at: string; to: EnvKey; files: string[] }
  | { kind: "received"; at: string; from: EnvKey; files: string[] };

export const QC_STATUSES = [
  { value: "pending", label: "Not reviewed", tone: "idle" },
  { value: "approved", label: "Approved", tone: "verified" },
  { value: "needs_revision", label: "Needs revision", tone: "attn" },
  { value: "rejected", label: "Rejected", tone: "bad" },
] as const;

export type QcStatus = (typeof QC_STATUSES)[number]["value"];

export function isQcStatus(v: unknown): v is QcStatus {
  return QC_STATUSES.some((s) => s.value === v);
}

export function qcMeta(v: unknown) {
  return QC_STATUSES.find((s) => s.value === v) ?? QC_STATUSES[0];
}

/** An item as the catalog holds it: the STAC item plus where it came from. */
export type CatalogItem = StacItem & {
  /** URI of the parquet or collection JSON source. Never serialized. */
  source: string;
};

export type Provider = {
  name: string;
  roles?: string[];
  url?: string;
  description?: string;
};

export type Collection = {
  /**
   * What this app calls the collection: its URL, its key in the catalog.
   * Usually the STAC id. When several versions of a collection share one
   * STAC id (the generator writes basin-data-dams-nid at 0.1, 0.2 and 0.3,
   * each in its own file), the current one keeps the bare id and the
   * others get a version suffix, basin-data-dams-nid-v0.2, so each has a
   * page of its own. See build() in catalog.ts.
   */
  id: string;
  /** The id as the STAC document has it, for the JSON and anywhere the id is shown. */
  stacId: string;
  /** The STAC type its document has. Derived collections are Collections. */
  type: "Catalog" | "Collection";
  /** A catalog (a folder) or a dataset; see kindOf in collection-hierarchy.ts. */
  kind: NodeKind;
  /** The name to show, from collectionName. */
  title: string;
  /** The title as the collection.json has it, or null when it has none. */
  sourceTitle: string | null;
  description: string | null;
  license: string | null;
  keywords: string[];
  providers: Provider[];
  /** Union of item bboxes, or the collection.json extent when it has one. */
  bbox: [number, number, number, number] | null;
  temporal: [string | null, string | null];
  itemCount: number;
  /** Links a parquet file or JSON items, so it's a dataset even before it has rows. */
  itemsLinked: boolean;
  /**
   * Reached through a document that didn't load, so it sits at the top of
   * the tree for now and the page says why.
   */
  parentMissing: boolean;
  /** Distinct loaded collections linked directly as children, not all descendants. */
  childCollectionCount: number;
  /** Resolved child document hrefs, for matching loaded collections to navigation links. */
  childCollectionHrefs: string[];
  /** Parquet or collection JSON sources, including those with no items. */
  sources: string[];
  /** True when collection.json was read from the bucket; false when derived. */
  fromDocument: boolean;
  /** The collection's own assets from collection.json, hrefs resolved. */
  assets: Record<string, StacAsset>;
  /** Remaining fields of collection.json that have no slot above. */
  extra: Record<string, unknown>;
  /** The Version extension's fields, from the collection metadata. */
  version: string | null;
  deprecated: boolean;
  experimental: boolean;
  /** Where the collection metadata was read from, for resolving its links. */
  docHref: string | null;
  /** The metadata's latest-, predecessor- and successor-version links. */
  versionLinks: StacLink[];
  /** The versions this collection is one of; see versions.ts. */
  series: Series;
  /** The collection's QC record, from the sidecar. Null until someone saves one. */
  qc: QcEdit | null;
  /** What happened to the collection in this environment, newest first. */
  history: QcEvent[];
  /**
   * How many items' geometry couldn't be read. Any at all means the file's
   * geometry can't be trusted, so the pages draw none of it and say so.
   */
  geometryErrors: number;
  items: CatalogItem[];
};

/**
 * A collection's versions in one environment, oldest first. A collection
 * with no other versions is a series of one.
 */
export type Series = {
  /** The shared id, e.g. "gages" for gages-v1 and gages-v2. */
  id: string;
  versions: {
    id: string;
    stacId: string;
    label: string | null;
    /** The file the version's metadata came from, which tells versions with one STAC id apart. */
    file: string | null;
    deprecated: boolean;
    qc: QcStatus;
  }[];
  latest: string;
};

export const VERSION_RELS = ["latest-version", "predecessor-version", "successor-version", "version-history"];
export const VERSION_SCHEMA = "https://stac-extensions.github.io/version/v1.2.0/schema.json";

/** The item as STAC JSON for the wire and the JSON view. */
export function toStacJson(item: CatalogItem): StacItem {
  const { source: _source, geometryError: _err, ...rest } = item;
  void _source; void _err;
  return rest;
}

/**
 * A QC record as top-level collection fields, under the names the pipeline
 * will use once it folds the sidecar into the collection metadata.
 */
export function qcFields(qc: QcEdit | null): Record<string, unknown> {
  if (!qc) return { qc: "pending", date_approved: null };
  return {
    qc: qc.qc,
    date_approved: qc.date_approved,
    ...(qc.note ? { qc_note: qc.note } : {}),
    qc_updated_at: qc.updated_at,
  };
}
