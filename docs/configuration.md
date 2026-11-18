# Configuration

Settings live in `.env`. This page covers the ones most projects set.
`.env.example` explains every variable, including the optional ones that
aren't here.

## Sources

Each environment reads from its own variable:

| Environment | Variable |
| --- | --- |
| Sandbox | `STAC_SOURCES_SANDBOX` |
| Development | `STAC_SOURCES_DEV` |
| Test | `STAC_SOURCES_TEST` |
| Production | `STAC_SOURCES_PROD` |

Each value is one or more of these, separated by commas:

- **A STAC catalog**, `catalog.json` or a versioned name like `catalog-v1.json`.
  It's followed through its `child` links to its collections, and each
  collection's items come from linked GeoParquet or JSON files.
- **A single STAC Collection JSON file**, with linked items or metadata only.
- **An S3 prefix or local folder.** Every parquet file in it is read, whether
  it's named `.parquet`, `.geoparquet` or `.pq`, along with `catalog.json` or a
  versioned `catalog-v1.json`. Other JSON files in the folder are only read
  when a catalog or collection links to them.
- **A single parquet file**, on S3 or local, with any of those three extensions.

There are no defaults in the code, so an environment left unset reads nothing
and its pages load empty. The example file points Sandbox and Production at
`./data/sandbox` and `./data/prod`, and Development and Test at placeholder
S3 paths for you to replace.

AWS credentials come from the SDK's usual chain: `AWS_PROFILE`, env keys, or
a task or instance role. Nothing has to name the role.

Changes to source files are picked up on a timer (`STAC_REFRESH_SECONDS`,
30 by default), with no restart.

[Catalog format](catalog-format.md) says what the files behind a source have
to look like.

## Promotion

Approving a collection copies its parquet file into the next environment:
Development to Test, Test to Production. It lands in that environment's first
source.

- This works for parquet files that sit directly in a source folder or prefix.
- A collection read through a STAC catalog can't be copied yet. Approving it
  records the decision, and the review sheet says the copy is coming soon.
- Sandbox is outside promotion. Approving there records the decision and
  copies nothing, and nothing is ever promoted into it.

## Opening page

The app's bare address opens Development, for a deployment whose Production
is still empty. Once collections have been approved through, open on
Production instead:

```bash
STAC_HOME_ENV=prod
```

It takes `sandbox`, `dev`, `test` or `prod`, and is read per request, so a
restart picks it up with no rebuild. Production's home page also answers at
`/prod` whichever you pick.

## Map area

The home map can focus on one area, like a state or a river basin:

```bash
STAC_MAP_AREA=./areas/south-platte.geojson
STAC_MAP_AREA_NAME=the South Platte basin
```

With an area set, the map opens on it, outlines it and dims everything
outside, and collections that cover most of it say "Whole area" in the list.

- `STAC_MAP_AREA_NAME` is used in phrases like "Fit to the South Platte
  basin", so include "the" if it reads better. If it's unset, the file's
  `name` property is used.
- The polygons are sent to the browser with the page, so simplify them first.
  10 to 50 KB is plenty for a state or a large basin.
- Both are read when the server starts. Changing them needs a restart, not a
  rebuild.
- Without an area, the map opens on everything the catalog covers and draws
  no outline. Collections with a national or world-sized box are left out of
  that view.
