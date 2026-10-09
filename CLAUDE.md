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
- The look is the "Atlas" direction: map-first,
  white cards on a pale canvas, river blue for data and links, green/amber/red
  only for QC state (approved, needs revision, rejected). Tokens live in `src/app/globals.css` under `--ffx-` names (the
  names are shared with ffrd-x, the values are not). Components use the
  semantic utilities (`bg-surface`, `text-ink-mut`) and the `ffx-`/`sx-`
  classes, never raw hex.
- Fonts: Bricolage Grotesque (headings), Instrument Sans (body), DM Mono (ids).
- Writing style for comments, docs and UI copy: plain, contractions, US
  spelling, no em dashes.
- Every page shows only real collections from the catalog. The app is shown
  to clients, so don't add mock or placeholder data anywhere, including the
  Admin queue and its activity.
