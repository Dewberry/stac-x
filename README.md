# stac-x

![The stac-x homepage set up for the South Platte basin, in Test with Stream Gages selected: its 192 sites drawn as dots across the basin, and its row open in the collection list with its description, version, dates, license and asset count, its review state, a Browse collection button and the gages listed by name](docs/images/home.png)

A STAC viewer for reviewing a catalog before it's published.

- Reads static STAC catalogs and stac-geoparquet files, from S3 or local folders.
- Draws every collection on a map.
- Lets a reviewer mark each collection approved, needs revision or rejected.
- Approving a collection copies its files into the next environment
  (Development to Test, Test to Production).

It never changes your data. QC decisions go to a JSON file beside the
collection's file (`gages.parquet` gets `gages.edits.json`), and promoted
collections are copied byte for byte.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer. The commands below work
as written in a WSL shell and in PowerShell.

Install dependencies:

```bash
npm install
```

Make a `.env` from the example:

```bash
cp .env.example .env
```

Start the dev server:

```bash
npm run dev
```

Open http://localhost:3000. It opens in Development, which is empty until
`.env` points at a catalog: see [Configuration](docs/configuration.md).

On WSL, install Node inside the Linux distro and keep the repo in the Linux
filesystem (`~/code`, not `/mnt/c`). If the repo has to stay on the Windows
drive, set `NEXT_WATCH_POLL_MS=1000` in `.env` so hot reload works.

Two things that surprise people on a first run:

- Reading from S3 needs AWS credentials with access to the bucket. Without
  them the pages still load, but empty, with a note that collections couldn't
  be loaded.
- Sign-in is off until Keycloak is configured, so every page is open. That's
  fine on your machine and not fine on a server.
  [Deployment](docs/deployment.md#sign-in) says how to turn it on.

## Commands

```bash
# Dev server with hot reload
npm run dev

# Production build, then serve it. Use this for demos so pages don't compile on first click
npm run build
npm start

# ESLint
npm run lint

# TypeScript check. In a fresh checkout, run `npx next typegen` once first
npm run typecheck

# Accessibility check (WCAG 2.2 AA) against the running dev server
npm run a11y
```

`npm run a11y` needs a browser installed once:

```bash
npx playwright install chromium
```

Every pull request is linted, typechecked and built into a Docker image by
the workflows in `.github/workflows`.

## Docker

Every merge to `main` publishes an image. To run it:

```bash
docker run --rm -p 3000:3000 --env-file .env ghcr.io/dewberry/stac-x:latest
```

It answers at http://localhost:3000/stac. Building your own image, serving it
at a different path, and what a real server needs are in
[Deployment](docs/deployment.md).

## Docs

| | |
| --- | --- |
| [Configuration](docs/configuration.md) | Sources for each environment, promotion, the opening page, the map area |
| [Catalog format](docs/catalog-format.md) | What your STAC files have to look like, and what happens when one can't be read |
| [Deployment](docs/deployment.md) | Docker, base path, AWS permissions, sign-in, sizing, versions and releases |
| [Keycloak](docs/keycloak.md) | The Keycloak client's settings |

`.env.example` explains every setting.

---

<div align="center">
    <sub>Built with ❤️ by Dewberry</sub>
</div>
