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

/** The two editable fields, plus bookkeeping about the edit. */
export type ItemEdit = {
  qc: QcStatus;
  date_approved: string | null;
  note?: string | null;
  updated_at: string;
};

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
  edit: ItemEdit | null;
};

export type Provider = {
  name: string;
  roles?: string[];
  url?: string;
  description?: string;
};

export type Collection = {
  id: string;
  title: string;
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
  items: CatalogItem[];
};

/**
 * The item as STAC JSON for the wire and the JSON view. The edit lands in
 * properties, which is where an item's metadata belongs in STAC, under the
 * same names the geoparquet columns will carry once the pipeline writes them.
 */
export function toStacJson(item: CatalogItem): StacItem {
  const { source: _source, edit, ...rest } = item;
  void _source;
  const properties: Record<string, unknown> = { ...rest.properties };
  if (edit) {
    properties.qc = edit.qc;
    properties.date_approved = edit.date_approved;
    if (edit.note) properties.qc_note = edit.note;
    properties.qc_updated_at = edit.updated_at;
  }
  return { ...rest, properties };
}
