@AGENTS.md

# stac-x

README.md covers what the app is and how to run it. The rest of what you
need to know is here.

- QC edits never go into the parquet. They go to a JSON sidecar beside it
  (`foo.parquet` gets `foo.edits.json`), keyed by collection id, and the
  viewer merges it on read (`src/lib/edits.ts`). Rewriting parquet means
  re-encoding every column and the geo metadata, and the next pipeline run
  would drop the edit anyway. Writes are conditional on the sidecar's ETag
  so two reviewers can't overwrite each other.
- Collection and item pages put panels where STAC Browser puts them. Only
  the look is ours.
- The look is the "Atlas" direction: map-first, white cards on a pale
  canvas, river blue for data and links, green/amber/red only for QC state
  (approved, needs revision, rejected). Tokens live in
  `src/app/styles/tokens.css` under `--ffx-` names (the names are shared
  with ffrd-x, the values are not). Components use the semantic utilities
  (`bg-surface`, `text-ink-mut`) and the `ffx-`/`sx-` classes, never raw hex.
- Fonts: Bricolage Grotesque (headings), Instrument Sans (body), DM Mono (ids).
- Writing style for comments, docs and UI copy: plain, contractions, US
  spelling, no em dashes.
- Every page shows only real collections from the catalog. The app is shown
  to clients, so don't add mock or placeholder data anywhere, including the
  Admin queue and its activity.

## Where things are

Every file in `src/lib` opens with a comment saying what it's for; read that
before the code.

- `src/app/[env]/...` holds the pages and API routes. The environment is the
  first path segment (`/dev`, `/test`, `/sandbox`); `src/proxy.ts` rewrites
  Production's unprefixed URLs onto `/prod`.
- `src/components` is flat, grouped by prefix: `home-*` for the home page,
  `admin-*` for Admin (`admin-console.tsx` is the queue,
  `admin-review-sheet.tsx` the sheet it opens), `map*` for the maps.
- Reading: `lib/catalog.ts` holds everything in memory, fed by
  `lib/stac-json.ts` and `lib/parquet.ts` through `lib/storage.ts` (S3 or
  local disk). Writing: `app/actions.ts` saves QC through `lib/edits.ts` and
  promotes through `lib/promote.ts`.
- CSS: `src/app/globals.css` only imports `src/app/styles/*.css`, and lists
  what each file holds. Import order is cascade order, so a new file goes
  where it belongs in that list, not at the end by default.

## Checking a change

There are no unit tests. Before calling a change done, run:

```bash
npm run typecheck
npm run lint
```

For anything a person sees, look at it in the running app. The dev server
is usually already up on port 3000 with real catalog data; check with
`lsof -i :3000` before starting another. Then run the accessibility check
against it (needs `npx playwright install chromium` once):

```bash
npm run a11y
```

## Accessibility

The app has to meet WCAG 2.2 AA. `npm run a11y` (axe in light and dark, plus
reflow at 320px) and the jsx-a11y lint rules catch what a machine can, and
both pass today, so keep them passing. They can't see focus or hear a
screen reader, so these are the patterns the code follows by hand:

- Focus never falls to `<body>`. When a control goes away or gets disabled
  while focused (a "Show all" that disappears, a pager at its last page, a
  form that remounts), move focus somewhere steady first, or use
  `aria-disabled` and ignore the click instead of `disabled`.
- Status changes are spoken from a `role="status"` element that's always
  mounted and only changes its text, usually an `sr-only` one. A region
  that mounts together with its text is often missed.
- Dialogs are native `<dialog>` with `showModal()`, labeled by their `h2`,
  which takes focus on open (`tabIndex={-1}`).
- No controls inside `<summary>`. Put the control beside the `<details>`.
- A link inside a sentence is underlined; color alone doesn't set it apart.
- Content that shows on hover (map tooltips) goes away on Escape.
- Nothing a person needs lives only in a `title` tooltip, which keyboards
  and touch can't reach. A cut-off value unfolds while its link or Copy has
  focus, or opens whole (a long table cell opens into the drawer row).
- Buttons repeated down a list get names that tell them apart
  (`Preview gages.parquet`, `Copy Source file`), starting with the visible
  label.
- Text uses `--ffx-ink`, `--ffx-ink-sec` or `--ffx-ink-mut`. `--ffx-ink-dim`
  is only 4.5:1 on white and fails on the sunken surfaces; the raw `--ffx-n-*`
  grays are for borders and fills.
- The home page has a visually hidden `h1`; every other page has a visible
  one. Keep one `h1` per page.
