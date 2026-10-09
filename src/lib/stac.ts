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
  /** URI of the parquet file the row was read from. Never serialized. */
  source: string;
};

export type Provider = {
  name: string;
  roles?: string[];
  url?: string;
  description?: string;
};

export type Collection = {
  id: string;
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
  /** Parquet files that contributed rows to this collection. */
  sources: string[];
  /** True when collection.json was read from the bucket; false when derived. */
  fromDocument: boolean;
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
  items: CatalogItem[];
};

/**
 * A collection's versions in one environment, oldest first. A collection
 * with no other versions is a series of one.
 */
export type Series = {
  /** The shared id, e.g. "gages" for gages-v1 and gages-v2. */
  id: string;
  versions: { id: string; label: string | null; deprecated: boolean; qc: QcStatus }[];
  latest: string;
};

export const VERSION_RELS = ["latest-version", "predecessor-version", "successor-version", "version-history"];
export const VERSION_SCHEMA = "https://stac-extensions.github.io/version/v1.2.0/schema.json";

/** The item as STAC JSON for the wire and the JSON view. */
export function toStacJson(item: CatalogItem): StacItem {
  const { source: _source, ...rest } = item;
  void _source;
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
