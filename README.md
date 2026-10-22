# stac-x

![The stac-x homepage set up for the South Platte basin, in Test with Stream Gages selected: its 192 sites drawn as dots across the basin, and its row open in the collection list with its description, version, dates, license and asset count, its review state, a Browse collection button and the gages listed by name](docs/images/home.png)

A STAC viewer for reviewing a catalog before it's published.

- Reads static STAC catalogs and stac-geoparquet files, from S3 or local folders.
- Draws every collection on a map.
- Lets a reviewer mark each collection approved, needs revision or rejected.
- Approving a collection copies its files into the next environment
  (Development to Test, Test to Production).

It only ever writes two things:

- QC decisions, to a JSON sidecar beside the collection's file
  (`gages.parquet` gets `gages.edits.json`). The parquet itself is never touched.
- Promoted collections, copied byte for byte into the next environment's first source.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer. On WSL, install Node
inside the Linux distro, not on Windows.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Make a `.env` from the example, then point it at your catalogs (see
   [Sources](#sources)):

   ```bash
   cp .env.example .env
   ```

   In PowerShell, use `Copy-Item .env.example .env`.

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Open http://localhost:3000. It opens in Development.

Two things to know:

- Reading from S3 needs AWS credentials with access to the bucket. Without
  them the pages still load, but empty, with a note that collections couldn't
  be loaded.
- There's no identity provider yet. The sign-in page opens Development
  whatever you type, and the account shown is a fixed role.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build`, then `npm start` | Production build. Use it for demos so pages don't compile on first click |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run a11y` | Accessibility check (WCAG 2.2 AA) against the running dev server: axe on each kind of page in light and dark, plus the layout at 320px wide. Run `npx playwright install chromium` once first |

## Configuration

Settings live in `.env`. `.env.example` explains every variable, including
optional ones not covered here.

### Sources

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
  collection's items are the rows of the stac-geoparquet file it links to.
- **An S3 prefix or local folder.** Every parquet file and `catalog.json` in it is read.
- **A single parquet file**, on S3 or local.

Items are always GeoParquet. A collection that keeps one JSON file per item
isn't read, and shows up as an error in the server log.

There are no defaults in the code, so an environment left unset reads nothing
and its pages load empty. The example file points Sandbox and Production at
`./data/sandbox` and `./data/prod`, and Development and Test at placeholder
S3 paths for you to replace.

AWS credentials come from the SDK's usual chain: `AWS_PROFILE`, env keys, or
an instance role.

### Promotion

- Approving copies a collection's parquet file into the next environment.
  That works for parquet files that sit directly in a source folder or prefix.
- A collection read through a STAC catalog can't be copied yet. Approving it
  records the decision, and the review sheet says the copy is coming soon.
- Sandbox is outside promotion. Approving there records the decision and
  copies nothing, and nothing is ever promoted into it.

### Opening page

The app's bare address opens Development, for a deployment whose Production
is still empty. Once collections have been approved through, open on
Production instead:

```bash
STAC_HOME_ENV=prod
```

It takes `sandbox`, `dev`, `test` or `prod`, and is read per request, so a
restart picks it up with no rebuild. Production's home page also answers at
`/prod` whichever you pick.

### Map area

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

## Setting up for another project

Each project runs its own copy with its own `.env`. Everything in
[Configuration](#configuration) applies; this is what a team starting cold
also needs to know.

### What the catalog has to look like

The app reads what the pipeline writes: stac-geoparquet, one file per
collection.

- A STAC catalog's `child` links lead, through any sub-catalogs, to
  collection files. Each collection links to its parquet file with any `rel`
  but `self`, as long as the link's `type` says parquet
  (`application/vnd.apache.parquet`) or its href ends in `.parquet`,
  `.geoparquet` or `.pq`. Relative hrefs are fine.
- A collection that links one JSON file per item is refused, and the server
  log says so. Convert it to stac-geoparquet first.
- Sources and the files they link to have to be on S3 (`s3://`) or a local
  path. `https://` isn't read: the page notes that collections couldn't be
  loaded, and the server log says why.
- A parquet file with no `id` column (a data table an asset points at, say)
  is left out of the catalog rather than shown as a collection.
- Promotion copies parquet files that sit directly in a source folder or
  prefix. A collection read through a catalog records its approval but isn't
  copied yet (see [Promotion](#promotion)).

### AWS permissions

The server's credentials need:

- `s3:ListBucket` on every source prefix, and `s3:GetObject` on everything
  the sources and their catalogs link to, including assets people will
  download or preview.
- `s3:PutObject` beside every source file in every environment, for the QC
  sidecars (`*.edits.json`), and on Test's and Production's first source
  folder, where promoted collections land.

QC saves are conditional writes (`If-Match` and `If-None-Match` on
PutObject), so an S3-compatible store has to support those.

### Put it behind your own sign-in

There's no identity provider yet, so anyone who can reach the app can
approve a collection, and approving copies files into Test or Production
with the server's credentials. Serve it behind the deployment's own auth
(an ALB with OIDC, a VPN, an authenticating proxy) until sign-in is built.
QC records don't name who made them, for the same reason.

### Size

Every environment's catalog is held in memory, all four at once, and a
parquet file that changes is read again in full. Parsing is well under a
second for a hundred thousand items. Memory grows with the item count and
how many properties each item carries, so a project with hundreds of
thousands of items should size the server for it and watch its first load.
Nothing larger has been tried.

## Docker

Every push to `main` publishes `ghcr.io/dewberry/stac-x:main` for
linux/amd64 and linux/arm64 (see `.github/workflows/docker.yml`). Tagging a
release `v1.2.3` also publishes `1.2.3`, `1.2` and `latest`.

The image is a production build with no hot reload. Use it to check what
ships, and keep using `npm run dev` day to day.

### Base path

The published image is built to be served under `/stac`, where Production
lives (`https://ffrd.cloud.dewberryanalytics.com/stac`).

- Next bakes the path into the build, so it can't be changed when the
  container starts. A project served anywhere else, including at the
  domain's root, builds its own image (below).
- Pages, `_next` assets and API routes all answer under `/stac/...`. The
  proxy in front should pass the path through without stripping the prefix.
- To build for another path, set `NEXT_PUBLIC_BASE_PATH` as a build arg.
  Leave it out and the app answers at `/`.

### Running it

If the ghcr.io package is private to you, log in first with a classic
GitHub token that has `read:packages`:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <github-user> --password-stdin
docker run --rm -p 3000:3000 --env-file .env ghcr.io/dewberry/stac-x:main
```

It answers at http://localhost:3000/stac.

To build and run your own instead:

```bash
docker build -t stac-x .
# or, to match Production
docker build --build-arg NEXT_PUBLIC_BASE_PATH=/stac -t stac-x .

docker run --rm -p 3000:3000 --env-file .env -v "$PWD/data:/app/data" stac-x
```

The container reads the same variables as `.env.example`. A few things about
its files:

- Local sources live at `/app/data` and are lost when the container stops.
  The `-v` above mounts the repo's `data` folder there, so promoted
  collections and their QC edits are kept.
- Edits to collections read from S3 go to S3 sidecars either way.
- The image includes the `areas` folder. Mount your own over `/app/areas` to
  use a different map area.

---

<div align="center">
    <sub>Built with ❤️ by Dewberry</sub><br/>
    <sub>Full-Stack Software Engineering</sub>
  </div>
