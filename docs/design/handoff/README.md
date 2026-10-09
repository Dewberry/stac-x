# stac-x landing page: design review brief

I'd like a critique of the stac-x landing page and a proposal for what to change. The page works and the look is settled (more on that below). What I want to know is whether the page answers its question well now that it has a realistic amount of data on it, and where it falls down. Please work from the screenshots; the app runs on a local machine and you can't reach it.

## What the app is

stac-x is an internal web app for FEMA's Future of Flood Risk Data (FFRD) program in Colorado. The program produces a lot of hydrologic and hydraulic data for the South Platte River basin: USGS stream gages, HEC-HMS rainfall-runoff models, HEC-RAS flood models, HEC-ResSim reservoir models, and storm catalogs. Each of those is published as a STAC collection (STAC is the standard catalog format for geospatial data) in an S3 bucket.

stac-x reads those catalogs, draws every collection on a map of the basin, and lets a reviewer record quality control on each collection: Not reviewed, Approved, Needs revision, or Rejected. That QC record is the only thing it writes. Approving a collection in one environment sends it on to the next (Development, then Testing, then Production), so review is how data gets published.

The people using it are engineers and data reviewers at Dewberry and FEMA. They know the basin and the models well. They come to the landing page to see what's in the catalog, find one collection, and go review or download it. A smaller group comes to see what's waiting for review, though that has its own Admin page (screenshot 10).

The collection and item pages deliberately copy the layout of Radiant Earth's STAC Browser, which nearly everyone in this field has used. Their placement is fixed; only their look is ours. The landing page has no STAC Browser equivalent, so it's the one page with room to rethink.

## The landing page today

The headline asks "What's in the catalog, and where?" Three figures sit beside it (collections, items, approved). Below that, one card holds the collection list on the left and the map on the right. Every collection gets a pin at the middle of its extent. Clicking a name or a pin opens a preview card over the map with the description, counts, dates, version and QC state, and draws the collection's footprint. "Open collection" goes to the collection page.

How a footprint draws depends on the shape of the items, not on what kind of collection it is:

- Point items (gages) draw as dots.
- Polygons draw once each as a faint fill, with the edges neighbors share removed. A model whose items are 1,000 simulated events over one domain draws as that one domain; a model whose items are subbasins draws as their outline.
- If the shapes are too heavy to send to the browser, the collection's bounding box draws dashed.

The map opens on the South Platte. Inside the basin outline the basemap is at full strength with shaded relief; outside it sits under a warm sand wash, so the basin is the brightest thing on the card.

## Screenshots

All are from the Development environment at 1440 by 900 at 2x, except the phone shots (390 wide, 3x).

| File | What it shows |
| --- | --- |
| `01-home.png` | Landing page, nothing selected |
| `02-home-model-selected.png` | An HMS model selected: one shared domain |
| `03-home-ras-selected.png` | A RAS model selected: 2D flow areas and 1D reaches |
| `04-home-gages-selected.png` | The gages selected: 192 points |
| `05-home-storms-selected.png` | The storm catalog selected: 240 overlapping footprints |
| `06-home-full-page.png` | The whole page, including the footer |
| `07-home-dark.png` | Dark mode |
| `08-collection-page.png` | A collection page, for context (layout fixed) |
| `09-item-page.png` | An item page, for context (layout fixed) |
| `10-admin-queue.png` | The Admin review queue |
| `11-home-production-empty.png` | Production with nothing published yet: the empty state |
| `12-home-phone.png` | The landing page on a phone, full length |

### About the data in them

Only the gages are real. `gages` and `South Platte gages (versioned sample)` are real USGS sites from the FFRD bucket. Everything else (the HMS, RAS, ResSim and storm collections, their item counts, footprints and review notes) is sample data I made for this review, so the page carries roughly the number and mix of collections we expect. The footprints are hand-drawn approximations of the real watersheds, and the storm footprints are random. Judge the layout against the shapes, not the shapes themselves.

## What I'd like from you

Look at the landing page as someone who opens it a few times a week to find a collection. Tell me what's working, what isn't, and what you'd change, with a mockup of your proposal. Changes to layout, hierarchy, the rail, the map treatment, the preview card and the figures are all on the table.

Problems I've already noticed, so you don't need to find them, but I'd like your fix for each:

1. Pins collide. Collections that cover the whole basin (the storm catalog, the calibration events, both gage collections) all land on the basin's center, and their labels overlap into an unreadable stack. Clear Creek's label is cut off by Denver metro's. On the phone (screenshot 12) the labels fill the map.
2. Pins say nothing about QC. Every pin is ink, so the map can't answer "what's approved?" Green, amber and red are reserved for QC state, so they're available.
3. The rail is a flat alphabetical list. With ten collections it's fine; with forty it won't be. Grouping by kind (gages, HMS, RAS, ResSim, storms) or by QC state are both possible, and filtering is too.
4. The preview card can cover the footprint it's showing, as in screenshot 5.
5. Dense polygon collections like the storm catalog draw as a solid blob. Maybe that's honest, but it doesn't help anyone.
6. The three figures at the top are thin. "4 approved" doesn't say approved out of what, or what's waiting.
7. A collection without a title shows its raw id (`gages`, lowercase). That's the data, and the pipeline will fix it, but the design should survive it.

## Constraints

Please keep these; they've been decided.

- The look is the "Atlas" direction: map first, white cards on a pale cool-gray canvas, lifted by a shadow rather than a border, one shared corner radius. The PDFs in this folder (`stac-x-design-c-homepage.pdf`, `stac-x-design-c-detail-page.pdf`) are the original direction.
- Color has fixed jobs. River blue is for data on the map and for links. Green, amber and red mean approved, needs revision and rejected, and nothing else. A collection nobody has reviewed is ink. The map's ground is warm on purpose so blue stays meaning water and data.
- Type: Bricolage Grotesque for headings and big figures, Instrument Sans for everything else, DM Mono only for identifiers (ids, S3 paths, media types), never for counts. Nothing under 11px.
- The page shows only what's in the catalog. No placeholder or "coming soon" areas for work that hasn't landed.
- There's only one basin, the South Platte. Don't design for a basin picker.
- The environment band (purple for Development, plum for Testing) and the header switcher are shared with a sister app and stay as they are.
- It has to work on a phone. The team works on Windows laptops, mostly at 1366 to 1920 wide.
- Dark mode follows the OS and has to keep working.
- Copy is plain and uses contractions and US spelling.

## Source files

`source/` holds the current code for the page, in case the details help:

- `globals.css`: every design token (the `--ffx-` custom properties, light and dark) and the component classes
- `env-page.tsx`: the route, which builds the data for the page
- `home.tsx`: the hero, figures and rail
- `home-map.tsx`: the MapLibre map, pins, footprints and legend
- `home-preview.tsx`: the preview card
- `kinds.ts`: collection kinds and their labels
- `overview.ts`: how each collection's footprint is reduced for the map

It's a Next.js and Tailwind app, and the map is MapLibre GL on OpenFreeMap tiles.
