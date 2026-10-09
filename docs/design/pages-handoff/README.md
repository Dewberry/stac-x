# STAC collection, item and admin pages: design review brief

You reviewed the landing page last round, and those changes are in. This time I'd like a critique of the other pages: the collection page, the item page, the Admin review queue and the sign-in page. For each, tell me what's working, what isn't and what you'd change, with mockups for the changes you'd make. Please work from the screenshots; the app runs on a local machine and you can't reach it.

## What the app is

The app (its header now just says STAC) is an internal web app for FEMA's Future of Flood Risk Data (FFRD) program in Colorado. The program produces hydrologic and hydraulic data for the South Platte River basin: USGS stream gages, HEC-HMS and HEC-RAS models, storm catalogs, terrain, structure inventories. Each is published as a STAC collection (STAC is the standard catalog format for geospatial data) in an S3 bucket.

The app reads those catalogs, draws them on maps and lets a reviewer record quality control on each collection: Not reviewed, Approved, Needs revision or Rejected. That QC record is the only thing it writes. Approving a collection in one environment sends it on to the next (Development, then Testing, then Production), so review is how data gets published.

The people using it are engineers and data reviewers at Dewberry and FEMA. They know the basin and the models well, and most of them have used a STAC browser before.

## How much is open on each page

**Collection and item pages: the look is open, the placement isn't.** These copy the layout of Radiant Earth's STAC Browser on purpose, because nearly every public STAC catalog is served through it (including FFRD's own) and modelers already know where to look. Please keep every panel in its column and in its order:

- Item: left column is the map, Assets, then Additional resources. Right column is Description, Collection, then Metadata.
- Collection: left column is Description (with keywords, license and temporal extent), the map, then Metadata. Right column is Items. Quality control and History have no STAC Browser counterpart, so they sit in the left column between the map and Metadata.
- Header: title on the left, no breadcrumb. At the right, a nav group (Collection and Up on an item; Up and, when there are versions, a version picker on a collection), then JSON, Download and Copy link.
- Panel names stay STAC Browser's: Description, Assets, Additional resources, Collection, Metadata, Items.

Inside those panels everything is open: how metadata is laid out, how asset rows look and what they show when expanded, how the item list reads, how the QC panel is put together, type, spacing, density. Moving a panel isn't.

**Admin and sign-in: open.** Admin has no STAC Browser equivalent. Layout, hierarchy, the counts, the queue, the review sheet and activity are all on the table. The sign-in page is a stand-in until there's an identity provider, so it only needs to look like it belongs.

## Screenshots

All are from the Testing environment at 1440 by 900 at 2x, except the phone shots (390 wide, 3x). "Full page" means the whole scroll height.

| File | What it shows |
| --- | --- |
| `01-collection-gages.png` | Collection page, first screen: 192 USGS gages (points) |
| `02-collection-gages-full-page.png` | The same, full page |
| `03-collection-storms.png` | Storm catalog, 450 items, full page |
| `04-collection-terrain.png` | Terrain tiles (polygons), 39 items, full page. Note the WKT2 string in Metadata |
| `05-collection-structures.png` | Structure inventory, 2 items, full page. Nested table in Metadata |
| `06-collection-qc-needs-revision.png` | The QC panel with Needs revision picked, before saving |
| `07-item-gage.png` | A gage item: point, 7 assets, an external link |
| `08-item-storm.png` | A storm item: titled only "1" |
| `09-item-terrain.png` | A terrain tile item, one GeoTIFF |
| `10-item-structures.png` | A structure inventory item, one parquet |
| `11-item-calibration.png` | An HMS calibration item: 52 assets, very long metadata |
| `12-collection-dark.png` | Collection page, dark mode |
| `13-item-dark.png` | Item page, dark mode |
| `14-collection-phone.png` | Collection page on a phone, full length |
| `15-item-phone.png` | Item page on a phone, full length |
| `16-not-in-production.png` | Opening a collection in an environment it hasn't reached yet |
| `17-admin-queue.png` | Admin: counts, review queue, recent activity |
| `18-admin-review-sheet.png` | Admin with the review sheet open on one collection |
| `19-admin-bulk-select.png` | Admin with three rows selected |
| `20-admin-dark.png` | Admin, dark mode |
| `21-admin-phone.png` | Admin on a phone |
| `22-signin.png` | Sign-in |

### About the data in them

The collection and item pages are real: they're what's in the Testing bucket today, metadata quirks and all. The Admin queue mixes those six real collections with sample rows I made to fill it out (Clear Creek, Denver metro 2D, Chatfield and Cherry Creek, the South Platte storm catalog and others), and the recent activity is mostly from those. The sample rows' history and notes are made up.

The real metadata is messy because the pipeline is young: generic descriptions ("STAC collection generated from gage items."), a structure inventory whose extent is all of North America, storm items whose ids are bare numbers. The pipeline will improve, but the pages should hold up when it doesn't.

## What I'd like from you

Look at these pages as a reviewer who opens a collection, checks a few items and its assets, and records a decision, a few times a week. Then look at Admin as the person working through what's waiting.

Problems I've already noticed. You don't need to find these, but I'd like your fix for each:

1. Metadata swallows the item page. One WKT2 projection string fills half the panel (screenshots 4 and 9), and the calibration item (11) runs about six screens. Long values need a better treatment than wrapping, whether that's truncating with an expand, a copy button or something else.
2. Nested values in Metadata get a label column too narrow for their own labels: "Description" and "Mappings" break mid-word in screenshot 5.
3. A flat list of 52 assets (screenshot 11) is hard to scan. Grouping by role or format, or a compact table, might help. Asset rows already expand to show details and, for images and parquet, a preview.
4. Items with no title fall back to their id. For storms that's "1" as the page heading (8), and for terrain it's a 40-character filename (9). The collection's item list has the same problem (3, 4).
5. On a collection page the item list is the right column, so on a phone it comes last, after QC and Metadata (14). That follows STAC Browser's stacking, but it's a long way to scroll for the thing most people came for.
6. The QC panel is plain. The promotion path (Development, Testing, Production) reads like three radio buttons, which it isn't, and the form under it doesn't say what saving will do. Admin's review sheet (18) already does this better with described choices, so maybe the two should share a pattern.
7. The Admin table doesn't fit a phone (21): Kind, Items, Status and the Review button scroll off to the right.
8. The "isn't in Production yet" page (16) is a small card in an empty window.

## Constraints

These have been decided, so please keep them.

- The look is the "Atlas" direction: white cards on a pale cool-gray canvas, lifted by a shadow rather than a border, one shared corner radius. The PDFs in this folder are the original direction (`stac-x-design-c-detail-page.pdf` covers these pages).
- Color has fixed jobs. River blue is for data on the map and for links. Green, amber and red mean approved, needs revision and rejected, and nothing else. A collection nobody has reviewed is ink.
- Type: Bricolage Grotesque for headings and big figures, Instrument Sans for everything else, DM Mono only for identifiers (ids, S3 paths, media types), never for counts. Nothing under 11px.
- Panel placement on collection and item pages, as above.
- The environment band (purple for Development, plum for Testing), the header and the environment switcher are shared with a sister app and stay as they are.
- It has to work on a phone. The team works on Windows laptops, mostly at 1366 to 1920 wide.
- Dark mode follows the OS and has to keep working.
- Copy is plain and uses contractions and US spelling.

## Source files

`source/` holds the current code, in case the details help:

- `globals.css`: every design token (the `--ffx-` custom properties, light and dark) and the component classes
- `collection-page.tsx`, `item-page.tsx`, `admin-page.tsx`, `signin-page.tsx`: the four routes
- `shell.tsx`: the page header and the panel component
- `map.tsx`, `map-core.tsx`: the MapLibre map on collection and item pages
- `items-list.tsx`, `assets.tsx`, `asset-preview.tsx`, `meta-table.tsx`: the item list, asset rows and previews, and the metadata table
- `qc-form.tsx`, `qc-chip.tsx`, `promotion-path.tsx`, `qc-history.tsx`: the QC panel and its parts
- `not-in-env.tsx`: the "isn't here yet" page
- `admin-console.tsx`, `admin-activity.tsx`: the Admin queue, review sheet, bulk actions and activity

It's a Next.js and Tailwind app, and the maps are MapLibre GL on OpenFreeMap tiles.
