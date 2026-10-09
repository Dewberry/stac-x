# stac-x

A STAC viewer for FFRD's Colorado data. It reads stac-geoparquet files
straight from S3, draws every collection on a map of the South Platte basin,
and lets a reviewer record QC on each collection. The one thing it writes is that QC record.

![The stac-x homepage in Testing with Stream Gages selected: its 192 sites drawn as dots across the South Platte basin, and its row open in the collection list with item count, period of record and review state](docs/images/home.png)

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

Open http://localhost:3000, which lands in Development. Reading the S3
catalogs needs AWS credentials with access to the `south-platte` bucket.
Without them the pages still load, empty, with a note that collections
couldn't be loaded.

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

## Environment variables

Make a `.env` file from the example. In PowerShell:

```powershell
Copy-Item .env.example .env
```

In WSL:

```bash
cp .env.example .env
```

Set `STAC_SOURCES_DEV`, `STAC_SOURCES_TEST` and `STAC_SOURCES_PROD` to where
each environment's files live: a STAC `catalog.json`, an S3 prefix, one
object, a local folder, or a local file, separated by commas. Unset, Development
reads `s3://south-platte/stac-metadata/catalog.json`, Testing reads
`s3://south-platte/stac-portable/catalog.json`, and Production reads
`./data/prod`. AWS credentials come from the SDK's usual chain: `AWS_PROFILE`,
env keys, or an instance role. `.env.example` explains each variable.
