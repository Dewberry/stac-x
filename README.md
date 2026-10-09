# stac-x

A STAC viewer for FFRD's Colorado data. It reads stac-geoparquet files
straight from S3, draws every collection on a map of the South Platte basin,
and lets a reviewer record QC on each collection. The one thing it writes is that QC record.

Collection and item pages put things where STAC Browser puts them, since
that's what people already know (see Page layout below). On a phone the
columns stack, left column first.

![The stac-x homepage with the USGS gages selected: their 192 sites drawn as dots across the South Platte basin, and their row open in the collection list with counts, period of record and review state](docs/images/home.png)

*Development with sample data. Only the two gage collections are real; the
models, reservoir runs and storm catalog are made up to fill the page.*

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

Open http://localhost:3000. With nothing configured, Development reads the
STAC catalog at `s3://south-platte/stac-metadata/catalog.json` and Testing
reads `s3://south-platte/stac-portable/catalog.json`, so both need AWS
credentials with access to that bucket. Without them the pages still load,
with a note that collections couldn't be loaded, and Development shows the
demo gages in `data/demo` instead so there's something to look at. Setting
`STAC_SOURCES_DEV` turns the demo off. Production, at the
unprefixed URLs, reads `.\data\prod` and stays empty until a collection is
approved through Testing (see Environments). The map
tiles come from OpenFreeMap, and the homepage's relief from open elevation
tiles on AWS; both need the internet. Without them the data still draws over
a plain ground.

To point it at the bucket, make a `.env` file from the example:

```powershell
Copy-Item .env.example .env      # PowerShell
```

```bash
cp .env.example .env             # WSL
```

Set `STAC_SOURCES_DEV`, `STAC_SOURCES_TEST` and `STAC_SOURCES_PROD` to where
each environment's files live: a STAC `catalog.json`, an S3 prefix (every
`.parquet`, `.pq` and `catalog.json` under it), one object, a local folder,
or a local file, separated by commas. Unset, they're the two S3 catalogs
above and `./data/prod`. Point at a catalog itself rather than its prefix,
or every asset `.pq` under the prefix gets read as a source. AWS credentials
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
src/app/[env]/              routes per environment: landing page, collection, item, admin, JSON APIs
src/app/signin/             the stand-in sign-in
src/app/actions.ts          the server action that saves QC and sends a collection on
src/components/             UI: shell, maps, item list, assets, QC form, metadata table
src/lib/catalog.ts          the in-memory catalog: parses every source, merges edits, groups by collection
src/lib/parquet.ts          stac-geoparquet to STAC items, with hyparquet
src/lib/storage.ts          S3 and local disk behind one interface, with conditional writes
src/lib/env.ts              the three environments and the links between them
src/lib/edits.ts            the QC sidecar: where it lives, how it is written
src/lib/stac-json.ts        reads a static STAC collection.json and its items
src/lib/promote.ts          copies an approved collection to the next environment
src/lib/versions.ts         works out which collections are versions of each other
src/lib/fixtures/review.ts  mocked review queue rows for the Admin page
src/lib/overview.ts         what each collection draws on the landing page map
src/lib/kinds.ts            collection kinds (gages, HMS, RAS...) and their labels
data/demo/                  the USGS gages, shown in Development when the bucket can't be read
data/test/, data/prod/      local landing folders for promoted collections (ignored by git)
scripts/vendor-maplibre.mjs copies MapLibre's worker into public/ before dev and build
```

## How the data flows

Every request wants the same thing, so the catalog is held in memory. On the
first request the app lists the configured sources, reads each parquet file
with hyparquet (pure JS, decodes the WKB geometry itself), and turns each row
back into a STAC item. After that a request costs nothing until
`STAC_REFRESH_SECONDS` have passed, when each file's ETag is checked and only
a changed file is re-read. A new file in the bucket shows up on its own.

A source can also be a static STAC catalog. A `catalog.json` at the root of
a source folder or prefix is followed through its `child` links, and any
sub-catalogs, to collections, whatever their files are called
(`collection-v1.0.json` is fine). Each collection is a source: its `item`
links are read and their relative hrefs resolved against the file they're
in, so to the rest of the app the items look the same as parquet rows. A
child that can't be read is logged and counted as a load error. A
collection's ETag says nothing about its items, so JSON sources are re-read
on every refresh. QC for a JSON collection goes to a sidecar beside its file
(`collection-v1.0.edits.json`). Approving one can't send it on yet, because
promotion copies parquet files and JSON collections aren't handled.

Collection metadata comes from the `collection.json` the items link to, when
the app can read it, and then from the copy a stac-geoparquet 1.1 file can
carry in its own metadata (the `stac-geoparquet` key). Otherwise it is
derived from the items (count, extent, temporal range) and the page says so.

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

The Admin page (`/admin`, `/dev/admin`, `/test/admin`, reached from the
account menu) is the review queue for one environment. Four counts sit across
the top (waiting, oldest waiting, sent back, approved in the last 30 days).
The queue opens on what nobody has reviewed yet, oldest first, with tabs for
the other states, a search, and the filter in the URL so a filtered view can
be linked. Review opens a sheet from the right with where the collection
stands, its last note and its history; after a decision it moves on to the
next one, and J and K step through the queue. Selecting rows decides on
several at once, with a result per collection. Every save goes through the
same server action as the collection page's form, so approving still
promotes. The sheet asks for a note on Needs revision and Reject; back-dating
an approval or resetting to Not reviewed still happens on the collection
page. Recent activity beside the queue merges every collection's history.

Until there are more collections, the queue is filled out from
`src/lib/fixtures/review.ts`, the South Platte models from the landing page's
mock at different points in review. A decision on one of those only changes
the page in front of you. Delete entries as real collections land.

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
on its own, since copying it would move the other collection too. Nor can one
whose file name is already taken in the next environment by a different
collection, since files land there by name and one would replace the other.

## Versions

A collection can have several versions, and each version is its own
collection: its own id, page, QC record and promotion. Development can be a
version ahead of Production, which is the usual state of things. The app
only works out which collections belong together (`src/lib/versions.ts`),
two ways:

- The [STAC Version extension](https://github.com/stac-extensions/version).
  When a collection's metadata has `latest-version`, `predecessor-version` or
  `successor-version` links, they decide the grouping and the order, and its
  `version` and `deprecated` fields are shown.
- The id. Most public catalogs skip the extension and put the version in the
  id (`HLSL30_2.0` in NASA's CMR, `usgs-lcmap-conus-v13` on Planetary
  Computer), so ids that differ only by a suffix like `-v2`, `_v2` or `_2.0`
  are grouped as well. A bare trailing number (`reach-12`) doesn't count.

We don't know yet which of these the FFRD pipeline will write, so both work.
What doesn't work is two versions sharing one id in different files: they
merge into one collection, as any two files with the same id do.

A collection page with other versions has a version menu in its actions,
newest first, each with its review state. An older version says so under the
title and links to the latest; on its item pages that link goes to the same
item in the latest version when it's there. The landing page draws each
collection once, from its latest version, and counts only latest versions in
its totals, while the card over the map says how many earlier versions there
are. The collection JSON API returns `version` and `deprecated`, plus version
links that point back into this app.

## The landing page

The home page is a console for people who already know FFRD, so it has no
hero or introduction; the header says what the app is. Under the
environment band the collection list sits on the left and a map of the South
Platte basin, the only basin the program covers, fills the rest of the
window edge to edge. On a wide screen the page itself doesn't scroll, only
the list does, and the footer is left off (it's on every other page). Only
what's in the catalog is shown, with no placeholders for work that hasn't
landed. Each collection links to its page and its counts are real. Its kind
is guessed from its id and keywords, so nothing here has to change for a
new file to appear.

The menu in the map's bottom-right corner is the legend for the pins' marks
and the review filter in one. Each row is a state (approved, needs revision,
rejected, not reviewed) with its count; clicking one narrows the list to
that state and dims the other pins, and clicking it again clears it. The
list's head counts what's showing ("1 of 10"). On a phone the map is a band
across the top, the list follows it, and the menu's four buttons sit in the
list's head instead.

A collection's pin sits under the middle of its extent, and its mark is its
review state: filled green, amber or red, or a hollow ring when nobody has
reviewed it. A collection whose extent covers most of the basin (70% of the
basin's area, in `src/app/[env]/page.tsx`), such as the gages or a storm
catalog, gets no pin, since its middle is the basin's middle and every such
pin would stack on one spot; its row says "Whole basin" instead. A pin's name
sits on whichever side of its mark is clear of other pins, the map's edge
and its controls, or hides and leaves the mark. While a collection is
selected the other pins are marks only, since the map has zoomed in and
their names would sit on the basemap's town labels. On a phone the pins are
marks only.

Selecting a collection draws its footprint; what that looks like depends on
the shape of its items, not on what kind of collection it is. Point items,
like gages, are drawn as dots. A model's items are usually polygons:
thousands of simulated events sharing one domain, or subbasins that tile
it, or a few 2D flow areas and 1D reaches. Drawing those one by one says
nothing at state scale, so `src/lib/overview.ts` draws each distinct shape
once, as a faint fill, and outlines the whole with the edges between
neighbors removed, which turns a model's subbasins into its domain. When
there are more than 40 distinct polygons and they mostly sit on top of each
other, like a storm catalog's transposition areas, it counts how many cover
each spot on a grid of about 2 km and draws that in three steps of blue,
split at the terciles, with the legend saying what each step means. When a
collection's shapes are too heavy to send to the browser, its extent is
drawn as a dashed box instead.

Selecting a collection, from its row or its pin, opens the row in place
with its description, counts, years, review state, version, the last
reviewer's note when it was sent back, and "Open collection", which is the
way in. Nothing covers the map. Enter on a row opens the collection, Escape
closes the row, and clicking the open row or its pin again closes it too.
On a phone the same details open as a sheet over the map. The rail groups by
kind or by review state (the choice is remembered in the browser), and
search matches titles, ids and kinds.

The map opens on the South Platte, and the basin's outline is the only
boundary drawn on it: no state border, no other basin. Inside the line the
basemap is at full strength, with near-white land, shaded relief and rivers
in a pale blue. Everything outside sits under a sand-colored wash that's
darker than the page, so the basin is the brightest thing on the card
instead of blending into the canvas behind it. The ground is warm on purpose:
the page is a cool gray, and blue is left to mean water and data. The colors are the `--ffx-map-` tokens in
`globals.css`; the relief comes from Mapzen's terrarium elevation tiles
(`NEXT_PUBLIC_MAP_TERRAIN`, set it to nothing to turn relief off). Clicking
the basin zooms to its collections.

The basin polygons are `public/data/co-huc4.json`: the HUC4 units that
touch Colorado, pulled once from the USGS Watershed Boundary Dataset and
simplified to about 0.006 degrees. The map draws only the South Platte
(`FOCUS_BASIN` in `src/lib/basins.ts`); the rest are still used to place a
collection that falls outside it. `src/lib/basins.ts` maps HUC4 codes to
names.

## Page layout

The look is ours, but where things sit on a collection or item page copies
[Radiant Earth STAC Browser](https://github.com/radiantearth/stac-browser)
(checked against 5.1, `src/views/Item.vue` and `src/views/Catalog.vue`).
Nearly every public STAC catalog is served through it, including USGS, NASA
VEDA, Copernicus Data Space, eoAPI, STAC Index and FFRD's own
`fema-ffrd/stac-browser`, which is an unmodified fork. Someone who has used
any of those should find things in the same place here. The two columns are
equal width.

The header is STAC Browser's too, with no breadcrumb. The title is on the
left. At the right end there are two button groups. The first is for getting
around: Collection and Up on an item (both lead to its collection, as they do
in STAC Browser), and Up and the version picker on a collection. The second
is the page's source: JSON, Download, and Copy link, which sit where STAC
Browser has Source and Share.

On an item page the left column is the map, then the assets, then additional
resources (the item's other links). The right column is the description,
a card for the parent collection, then the metadata.

On a collection page the left column is the description with its keywords,
license and temporal extent, then the map, then the metadata. The right
column is the item list. QC has no counterpart in STAC Browser, so its panel
and the history go in the left column between the map and the metadata,
which keeps it near the top without moving anything a STAC Browser user
would look for.

Panel names follow STAC Browser's too: Description, Assets, Additional
resources, Collection, Metadata, Items. Inside an asset row the name is on
the left and its roles and format are at the right end.

Before moving a panel, check where STAC Browser has it. Portolan's fork is
the one well-known browser that moves the map to a full-width band above the
columns; the map-first apps (Planetary Computer Explorer, Earth Search's
FilmDrop console, stac-map) put everything in a side panel beside a
full-screen map, which is a different kind of app.

## Design

The map is the app. The home page is the collection list beside a map of
the South Platte that fills the rest of the window. Collection and item pages keep
STAC Browser's placement (see Page layout). Cards are white on a pale canvas, lifted by a
shadow rather than a border, and they all share one corner radius. Every page
keeps its content on the same edges as the header's. River blue is for data on the map and for links. Green,
amber and red are QC states and nothing else: approved, needs revision,
rejected. A collection nobody has reviewed is a hollow ring, so a filled
green mark on the homepage always means approved. The homepage map's ground is warm
(see the landing page section) and everything around it is a cool gray.

Type is Bricolage Grotesque for headings and large figures, Instrument Sans
for everything else, DM Mono for identifiers only (ids, S3 paths, media-type
tags), never for counts. Sizes come from the `--ffx-t-` steps: headings scale
with the viewport, nothing is set under 11px, and on a phone the small steps
go up a notch and form controls are 16px so iOS doesn't zoom on focus.
Tokens live in `src/app/globals.css`; the
custom property names are inherited from ffrd-x so the two apps read the
same token names, but the values are this app's own. Dark mode follows the
OS and can be forced from the footer, which every page but the home page
shows on a wide screen.

Three earlier directions were mocked up before this one was chosen; the
PDFs of the chosen direction are in `docs/design/`.
