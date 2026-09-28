# stac-x

A STAC viewer for FFRD's Colorado data. It reads stac-geoparquet files
straight from S3, draws every collection on a map of the state, and lets a
reviewer record QC on each collection. The one thing it writes is that QC record.

The layout follows STAC Browser, which is the layout people already know:
breadcrumbs, a title row with the page's actions, and two columns under it.
The narrow column holds the map and what describes the object (metadata,
assets). The wide column holds what it contains (items) or what there is to
read about it. On a phone the columns stack, map first.

![The stac-x homepage: a map of Colorado with every collection pinned and the published gages drawn on it](docs/images/home.png)

## Running it

Everyone on the team runs this on Windows, from PowerShell or from WSL.
The commands below are the same in both unless marked.

Install [Node.js](https://nodejs.org) 20 or newer (24 is what this was built
with). On WSL, install Node inside the Linux distro rather than using the
Windows install.

```powershell
npm install
npm run dev
```

Open http://localhost:3000. With nothing configured the app reads `.\data`,
which holds the sample gages file, so it runs with no AWS account. The map
tiles come from OpenFreeMap and need the internet; without them the data still
draws over a plain ground.

To point it at the bucket, make a `.env` file from the example:

```powershell
Copy-Item .env.example .env      # PowerShell
```

```bash
cp .env.example .env             # WSL
```

Set `STAC_SOURCES_DEV`, `STAC_SOURCES_TEST` and `STAC_SOURCES_PROD` to where
each environment's files live: an S3 prefix (every `.parquet` and `.pq` under
it), one object, a local folder, or a local file, separated by commas. Unset,
they're `./data/dev`, `./data/test` and `./data/prod`. AWS credentials
come from the SDK's usual chain: `AWS_PROFILE`, env keys, or an instance role.
`.env.example` explains each variable.

Other commands:

```powershell
npm run build      # production build
npm run start      # serve it
npm run lint
npm run typecheck
```

### Windows and WSL notes

Port 3000 is often taken by another dev server. Next moves to the next free
port and prints it; or pick one: `npm run dev -- -p 3005`.

On WSL, clone into the Linux filesystem under `~`, not under `/mnt/c`. A
checkout on the Windows drive is slow to read and file change events don't
cross that boundary, so hot reload never fires. If hot reload still misses
edits, set `NEXT_WATCH_POLL_MS=1000` in `.env` and restart; the dev server
then polls for changes instead of waiting to be told.

Git Bash is the one shell to avoid for anything that takes a path argument;
it rewrites Unix-style paths before Node sees them.

## What's where

```
src/proxy.ts                maps unprefixed URLs to Production, /dev and /test to theirs
src/app/[env]/              routes per environment: landing page, collection, item, JSON APIs
src/app/signin/             the stand-in sign-in
src/app/actions.ts          the server action that saves QC and sends a collection on
src/components/             UI: shell, maps, item list, assets, QC form, metadata table
src/lib/catalog.ts          the in-memory catalog: parses every source, merges edits, groups by collection
src/lib/parquet.ts          stac-geoparquet to STAC items, with hyparquet
src/lib/storage.ts          S3 and local disk behind one interface, with conditional writes
src/lib/env.ts              the three environments and the links between them
src/lib/edits.ts            the QC sidecar: where it lives, how it is written
src/lib/promote.ts          copies an approved collection to the next environment
src/lib/fixtures/areas.ts   the mocked model areas on the landing page
data/dev/                   sample parquet; data/test and data/prod fill as you promote (ignored by git)
scripts/vendor-maplibre.mjs copies MapLibre's worker into public/ before dev and build
```

## How the data flows

Every request wants the same thing, so the catalog is held in memory. On the
first request the app lists the configured sources, reads each parquet file
with hyparquet (pure JS, decodes the WKB geometry itself), and turns each row
back into a STAC item. After that a request costs nothing until
`STAC_REFRESH_SECONDS` have passed, when each file's ETag is checked and only
a changed file is re-read. A new file in the bucket shows up on its own.

Collection metadata comes from the `collection.json` the items link to, when
the app can read it. Otherwise it is derived from the items (count, extent,
temporal range) and the page says so.

## QC edits

QC is recorded per collection, on the collection page: a status (not
reviewed, approved, needs revision, rejected), an approval date, and an
optional note. Picking Approved fills today's date, which stays editable.
Items don't carry their own QC.

Edits are not written into the parquet file. They go to a JSON sidecar beside
it:

```
s3://bucket/path/gages_all_items_geopq.parquet
s3://bucket/path/gages_all_items_geopq.edits.json
```

Rewriting a parquet file for two cells means re-encoding every column and
reproducing the geo metadata exactly, and the next pipeline run would drop the
edit anyway. The sidecar is one small object that can't corrupt the source,
every write is a full record, and the pipeline can fold it into the parquet on
its next run. The viewer merges it on read, so to a reader the collection
simply has `qc` and `date_approved`, which is also how the collection JSON
API returns them. The sidecar is keyed by collection id. A collection whose
items span several parquet files keeps its record beside the first one.

Writes are conditional on the sidecar's ETag (S3 `If-Match`), so two reviewers
saving at once can't overwrite each other; the loser re-reads and retries.

There is no identity provider yet. The sign-in page is a stand-in, the same
as ffrd-x's, and anyone who can reach the app can save QC; the records carry
no author. Put the deployment behind something (an ALB with OIDC, a VPN)
until there is a user model.

## Environments

There are three, matching the deployment: Development, Testing and
Production. One running app reads all three, each from its own sources.
Production's pages are unprefixed; the other two live under `/dev` and
`/test`, so a copied link opens in the environment it came from. The header
switcher keeps you on the same page when you change environments, and outside
Production a colored band under the header and a `[Dev]` or `[Test]` tab title
say where you are. ffrd-x has the same switcher, band and URLs.

A collection moves forward one environment at a time, and the QC form is what
moves it. Approving it in Development copies its parquet files, byte for byte,
into Testing's landing folder; approving it in Testing copies them into
Production, after a confirmation step and a required note. A copy starts
unreviewed in its new environment. If Testing marks it Needs revision or
Rejected it stays there, blocked, until a fixed version is approved in
Development and sent again, which replaces it. Each environment's sidecar keeps
its own QC record and a history of every save and move, shown on the
collection page along with where the collection stands in all three.

A parquet file that also holds another collection's items can't be promoted
on its own, since copying it would move the other collection too.

## The landing page

The map of Colorado shows every model area in the state. Today one
collection exists as a geoparquet file (the South Platte gages). The rest come
from `src/lib/fixtures/areas.ts`, a mocked list of basins and model domains.
An entry there whose `collection` id the catalog holds becomes live: it links
to the collection, its counts are real, and its items are drawn on the map.
Everything else is drawn as in progress and can't be opened. A collection in the
catalog that no entry names is added as its own live area, so nothing here
has to change for a new file to appear. Delete mock entries as real
collections land.

## The landing page map

Clicking a collection in the rail or a pin on the map opens a card over the
map with the collection's description, counts, dates and review progress;
"Open collection" is the way in. The rail groups collections by USGS
four-digit hydrologic basin, with a flat list one click away, and the
basins are drawn on the map, tinted where a basin has published or planned
work. Clicking a basin zooms to it and scrolls the rail to its group.

The basin polygons are `public/data/co-huc4.json`: the HUC4 units that
touch Colorado, pulled once from the USGS Watershed Boundary Dataset and
simplified to about 0.006 degrees. Each area in `src/lib/fixtures/areas.ts`
names its basin by HUC4 code; `src/lib/basins.ts` maps codes to names.

## Design

The map is the app. The landing page is an edge-to-edge map of Colorado with
a panel floating over it; collection and item pages put a full-width map
under the title and the cards below it, which is the layout STAC Browser
and Portolan use. Cards are white on a pale canvas, lifted by a shadow rather
than a border. River blue is for data on the map and for links; green means
published or approved, amber needs revision, red rejected.

Type is Bricolage Grotesque for headings, Instrument Sans for everything
else, DM Mono for identifiers. Tokens live in `src/app/globals.css`; the
custom property names are inherited from ffrd-x so the two apps read the
same token names, but the values are this app's own. Dark mode follows the
OS and can be forced from the footer.

Three earlier directions were mocked up before this one was chosen; the
PDFs of the chosen direction are in `docs/design/`.
