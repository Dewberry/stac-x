# Deployment

Each project runs its own copy with its own `.env`. This page is what a team
needs to put one on a server: the image, the AWS permissions, sign-in, sizing
and how versions work. [Configuration](configuration.md) covers the settings
themselves.

## The image

Every push to `main` publishes `ghcr.io/dewberry/stac-x:latest` for
linux/amd64 and linux/arm64, plus a `sha-<short sha>` tag for that commit
and the version's own tags, `1.2.3` and `1.2` (see
`.github/workflows/docker.yml`).

It's a production build with no hot reload. The container reads the same
variables as `.env.example`.

Run the published image:

```bash
docker run --rm -p 3000:3000 --env-file .env ghcr.io/dewberry/stac-x:latest
```

It answers at http://localhost:3000/stac.

If the ghcr.io package is private to you, log in first. Docker asks for a
password: paste a classic GitHub token that has `read:packages`.

```bash
docker login ghcr.io -u YOUR_GITHUB_USER
```

To build your own, served at `/`:

```bash
docker build -t stac-x .
```

Or to match Production's path:

```bash
docker build --build-arg NEXT_PUBLIC_BASE_PATH=/stac -t stac-x .
```

Then run it with the repo's `data` folder mounted:

```bash
docker run --rm -p 3000:3000 --env-file .env -v "${PWD}/data:/app/data" stac-x
```

These work as written in a WSL shell and in PowerShell.

A few things about the container's files:

- Local sources live at `/app/data` and are lost when the container stops.
  The `-v` above mounts the repo's `data` folder there, so promoted
  collections and their QC edits are kept.
- Edits to collections read from S3 go to S3 sidecars either way.
- The image includes the `areas` folder. Mount your own over `/app/areas` to
  use a different map area.

Wherever it runs for real, give it a restart policy (`--restart
unless-stopped`) and a memory limit. `/api/health` under the base path
(`/stac/api/health` in the published image) answers 200 whenever the server
is up, without reading the catalog. The image's own health check uses it.

## Base path

The published image is built to be served under `/stac`, where Production
lives (`https://ffrd.cloud.dewberryanalytics.com/stac`).

- Next bakes the path into the build, so it can't be changed when the
  container starts. A project served anywhere else, including at the
  domain's root, builds its own image.
- Pages, `_next` assets and API routes all answer under `/stac/...`. The
  proxy in front should pass the path through without stripping the prefix.
- To build for another path, set `NEXT_PUBLIC_BASE_PATH` as a build arg.
  Leave it out and the app answers at `/`.

## AWS permissions

The server's credentials need:

- `s3:ListBucket` on every source prefix, and `s3:GetObject` on everything
  the sources and their catalogs link to, including assets people will
  download or preview.
- `s3:PutObject` beside every source file in every environment, for the QC
  sidecars (`*.edits.json`), and on Test's and Production's first source
  folder, where promoted collections land.

QC saves are conditional writes (`If-Match` and `If-None-Match` on
PutObject), so an S3-compatible store has to support those. Promotion from
one S3 location to another is a CopyObject, so the file never passes through
the server. It needs nothing beyond the read on the source and the write on
the landing folder listed above.

## Sign-in

The app signs people in with Keycloak (OpenID Connect, through Auth.js).
Set `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`,
`AUTH_SECRET` and `AUTH_URL` (see `.env.example`) to turn it on. The Keycloak
client's settings are in [keycloak.md](keycloak.md).

With it on, every page and API route needs a session, which ends when
Keycloak's does. Anyone who can sign in can browse. Admin and QC saves also
need the `stac-admin` role (`STAC_REVIEWER_ROLE` names a different one, or
`*` for anyone who can sign in), and each QC save records the username of
whoever made it.

With sign-in off, anyone who can reach the app can approve a collection,
and approving copies files into Test or Production with the server's
credentials. Don't deploy it that way without other auth in front (an ALB
with OIDC, a VPN, an authenticating proxy).

## Size

Every environment's catalog is held in memory, all four at once, and a
parquet file that changes is read again in full. Parsing is well under a
second for a hundred thousand items. Memory grows with the item count and
how many properties each item carries, so a project with hundreds of
thousands of items should size the server for it and watch its first load.
Nothing larger has been tried.

Each parquet file is decoded by a process of its own, two at a time, with
a limit on its memory and its time. What a file costs to decode can't be
told from its size, and a server that runs out of memory can't recover, so
a file that needs more than its limit ends that process instead: its
collection says why, and the rest of the app carries on. The limits are
`STAC_PARQUET_MEMORY_MB`, `STAC_PARQUET_MAX_MB` and
`STAC_PARQUET_TIMEOUT_SECONDS` (see `.env.example`).

## Versions and releases

Every merge to `main` is a release with its own version, and nobody has to
bump anything. `package.json` names the series, say `1.2.0`, and the
Docker workflow counts the last number up from the tags already there:
the first merge is `v1.2.0`, the next `v1.2.1`, and so on. The workflow
builds the image with that version, publishes it, then tags the commit and
writes a GitHub release listing the pull requests since the last one. That
list is the changelog. Nothing is committed back to `main`.

The numbers follow [semver](https://semver.org). The last one moving means
"something was merged". To say more than that, start a new series by
changing the version in `package.json` in the pull request that earns it:
`1.3.0` for a feature worth pointing at, `2.0.0` for a change people have
to adjust to.

```bash
npm version minor --no-git-tag-version
```

The app shows its version in the account menu at the top right, for
everyone, with the commit and build date under it, and again at the bottom
of Admin. The same answer comes from the server, which is the quick check
after a deployment:

```bash
curl https://ffrd.cloud.dewberryanalytics.com/stac/api/version
```

A tab that was open through a deployment catches up in one of two ways.
Moving to another page loads it whole from the new build (Next's
`deploymentId`, set to the commit in `next.config.ts`). Staying put brings
up a line under the header saying the app has been updated, with a Reload
button.

Under `npm run dev` the version is `package.json`'s as it stands, marked
as a development build.
