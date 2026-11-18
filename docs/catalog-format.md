# Catalog format

What the files behind a source have to look like for the app to read them.
The app reads stac-geoparquet and static STAC JSON.

## Where files can live

Sources and the files they link to have to be on S3 (`s3://`) or a local
path. `https://` isn't read: the page notes that collections couldn't be
loaded, and the server log says why.

## Catalogs and collections

A STAC catalog's `child` links lead, through any sub-catalogs, to collection
files. Each collection then links to its items in one of two ways.

**GeoParquet.** The link can have any `rel` but `self`, as long as its `type`
says parquet (`application/vnd.apache.parquet`) or its href ends in
`.parquet`, `.geoparquet` or `.pq`. Relative hrefs are fine.

**JSON.** Individual Items with `rel="item"`, or ItemCollections (GeoJSON
FeatureCollections) with `rel="items"`. ItemCollection `next` links are
followed, repeated files and item ids are read once, and relative item links
and asset hrefs resolve against the JSON file containing them.

Linked GeoParquet wins when a collection has both. JSON reads run eight files
at a time, so GeoParquet is still the better choice for a large collection.

Every node is read as either a collection or a catalog (a node that only
holds other nodes), worked out from what it holds on every load:

- A node with items, or with a link to where its items are (a GeoParquet
  file, even one with zero rows so far, or JSON items), is a collection.
- Otherwise a document typed `Catalog` is a catalog.
- A leaf with collection-level assets is a collection (a bundle of files).
- A node with children stays a catalog even when a manifest or README is
  attached to it.
- Anything with nothing in it is a catalog.

On the home page, collections are grouped under the top-level catalog each
sits in. Catalogs are headings there, never rows, and a catalog's own page
shows what's inside it with no map, items or review state. The review counts,
the map and the Admin queue cover collections only.

## Parquet files

- A file with no `id` column (a data table an asset points at, say) is left
  out of the catalog instead of being shown as a collection.
- Give the same kind of asset the same key on every item: `geojson`, not
  `co00002-630_geojson` on one item and `co00003-505_geojson` on the next.
  Parquet has one schema for the whole file, so every asset key becomes its
  own set of columns on every row, and a file of a few megabytes can take
  gigabytes to read. STAC JSON items don't have this problem.
- A file written from a pandas frame of items, with bbox, links, assets and
  properties as JSON text and the geometry as WKB bytes with no `geo`
  metadata, is read too.

## When something can't be read

One bad file doesn't take the catalog with it.

- A collection whose parquet file is missing, has no `id` column, or needs
  more memory or time than a file is allowed still shows as a collection,
  with the reason where its items would be.
- Missing or invalid linked JSON reports an error. It isn't treated as an
  intentionally empty collection.
- A geometry that isn't valid is dropped from its item.
- A collection that can't be read at all is left out, with a note on the page.
- A node whose parent document was listed but didn't load sits at the top of
  the list, and its row says so.

## Line symbology

A line item can say how it's drawn with a `symbology` property:

```json
"symbology": { "color": "#cb4154", "size": 0.5 }
```

- `color` is a hex color, `#rgb` or `#rrggbb`.
- `size` is the line's weight as a multiple of the app's own: 1 changes
  nothing, 0.5 is half as heavy, 2 is double. It's kept between 0.25 and 4.

Both are optional. A line item without the property, or with a value that
can't be used, is drawn in river blue at the default weight. A color that
would be hard to see on the light or the dark map is swapped there for a
lighter or darker shade of the same hue, so a black line is white on the dark
map.

It's set on each item, not on the collection, so one collection can hold more
than one kind of line. In a parquet file it's a struct column of that name.
The home map draws up to 12 different symbologies for one collection and the
rest as plain lines.
