# stac-x

A STAC viewer for reviewing a catalog before it's published. It reads static
STAC catalogs and stac-geoparquet files, from S3 or local folders, draws every
collection on a map, and lets a reviewer record QC on each collection.
Approving a collection copies its files into the next environment
(Development to Test, Test to Production).

It writes two things. QC decisions go to a JSON sidecar beside the
collection's file (`gages.parquet` gets `gages.edits.json`), never into the
parquet itself, and a promoted collection is copied byte for byte into the
next environment's first source.

![The stac-x homepage set up for the South Platte basin, in Test with Stream Gages selected: its 192 sites drawn as dots across the basin, and its row open in the collection list with its description, review state and the gages listed by name](docs/images/home.png)

## Running it

Install [Node.js](https://nodejs.org) 20 or newer. On WSL, install Node
inside the Linux distro rather than using the Windows install.

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open http://localhost:3000, which lands in Development. Reading catalogs on
S3 needs AWS credentials with access to their bucket. Without them the pages
still load, empty, with a note that collections couldn't be loaded.

There's no identity provider yet. The sign-in page is a stand-in that opens
Development whatever you type, and the account shown is a fixed role.

For a demo, build for production and serve that instead, so pages don't
compile on first click:

```bash
npm run build
```

```bash
npm start
```

Lint and typecheck:

```bash
npm run lint
```

```bash
npm run typecheck
```

## Docker image

Every push to `main` builds the image and publishes it to GitHub's container
registry as `ghcr.io/dewberry/stac-x:main` (see
`.github/workflows/docker.yml`). Tagging a release `v1.2.3` also publishes
`1.2.3`, `1.2` and `latest`. Each tag covers both linux/amd64 and linux/arm64,
so the image runs natively on Intel and AMD machines, Apple Silicon Macs and
ARM servers, and Docker pulls the right one on its own.

The published image is built to be served under `/stac`, since that's where
Production lives (`https://ffrd.cloud.dewberryanalytics.com/stac`). Next bakes
the path into the build, so it can't be changed when the container starts:
pages, `_next` assets and API routes all answer under `/stac/...`, and the
proxy in front should pass the path through as is, without stripping the
prefix. To build for a different path, or for the root, set
`NEXT_PUBLIC_BASE_PATH` as a build arg. Leave it out and the app answers at `/`.

To run the app from a local build instead of the dev server:

```bash
docker build -t stac-x .
docker run --rm -p 3000:3000 --env-file .env stac-x
# or, to match Production
docker build --build-arg NEXT_PUBLIC_BASE_PATH=/stac -t stac-x .
```

The container reads the same variables as `.env.example`. Local sources
(`./data/prod` by default) live at `/app/data` inside the container and are
lost when it stops, so mount the repo's `data` folder there to keep the
collections promoted into Production and their QC edits, the same place the
dev server writes them. Edits to collections read from S3 go to S3 sidecars
either way:

```bash
docker run --rm -p 3000:3000 --env-file .env -v "$PWD/data:/app/data" stac-x
```

To run the published image, log in to ghcr.io first. The repo is private, so
this needs a classic GitHub token with `read:packages`:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <github-user> --password-stdin
docker run --rm -p 3000:3000 --env-file .env ghcr.io/dewberry/stac-x:main
```

It answers at `http://localhost:3000/stac`.

The image is a production build with no hot reload, so keep using `npm run dev`
for day-to-day work and reach for the container to check what actually ships.

## Environment variables

Make a `.env` file from the example. In PowerShell:

```powershell
Copy-Item .env.example .env
```

In WSL:

```bash
cp .env.example .env
```

Set `STAC_SOURCES_SANDBOX`, `STAC_SOURCES_DEV`, `STAC_SOURCES_TEST` and
`STAC_SOURCES_PROD` to where each environment's files live: a STAC `catalog.json`, an S3 prefix, one
object, a local folder, or a local file, separated by commas. A prefix or
folder is read for every parquet file and `catalog.json` in it. A catalog
(`catalog.json`, or a versioned name like `catalog-v1.json`) is followed
through its `child` links to its collections, and each collection's items are
the rows of the stac-geoparquet file it links to. Every environment reads
GeoParquet. A collection that only links to one JSON file per item isn't read
and shows up as an error in the server log.

There are no defaults in the code: an environment left unset reads nothing
and its pages load empty. The example file points Sandbox at `./data/sandbox`,
Development and Test at placeholder S3 catalogs to replace with your own, and
Production at `./data/prod`.
Sandbox sits outside promotion: approving a collection there records the
decision and copies nothing, and nothing is promoted into it. Promotion copies
parquet files that sit directly in a source folder. A collection read through
a catalog can't be sent on yet: approving it records the decision, and the
review sheet says the copy is coming soon.
AWS credentials come from the SDK's usual chain: `AWS_PROFILE`, env keys, or
an instance role. `.env.example` explains each variable.

### The map's area

The home map can focus on one area, such as a state or a river basin. Set
`STAC_MAP_AREA` to a GeoJSON file of its polygons and the map opens on it,
outlines it, and dims everything outside. Collections that cover most of it
say "Whole area" in the list. `STAC_MAP_AREA_NAME` is what the page calls it,
in phrases like "Fit to the South Platte basin", so include "the" if it reads
better. Without a name the file's `name` property is used.

```bash
STAC_MAP_AREA=./areas/south-platte.geojson
STAC_MAP_AREA_NAME=the South Platte basin
```

Without `STAC_MAP_AREA` the map opens on everything the catalog covers and
draws no outline. A collection whose box is national or world-sized, far
bigger than the rest, is left out of that view. Both are read when the server starts, so changing them
needs a restart, not a rebuild.

The polygons are sent to the browser with the page, so simplify them first.
Around 10 to 50 KB is plenty for a state or a large basin. The Docker image
includes the `areas` folder; mount your own over `/app/areas` to use a
different file.

---

<div align="center">
    <sub>Built with ❤️ by Dewberry</sub><br/>
    <sub>Full-Stack Software Engineering</sub>
  </div>
