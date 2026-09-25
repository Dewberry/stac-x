@AGENTS.md

# stac-x

Read README.md first: it says what the app is, how data flows, and why QC
edits go to a sidecar rather than into the parquet.

- The look is the "Atlas" direction (see README, Design): map-first, white
  cards on a pale canvas, river blue for data and links, green/amber/red for
  QC state. Tokens live in `src/app/globals.css` under `--ffx-` names (the
  names are shared with ffrd-x, the values are not). Components use the
  semantic utilities (`bg-surface`, `text-ink-mut`) and the `ffx-`/`sx-`
  classes, never raw hex.
- Fonts: Bricolage Grotesque (headings), Instrument Sans (body), DM Mono (ids).
- Writing style for comments, docs and UI copy: plain, contractions, US
  spelling, no em dashes.
- `src/lib/fixtures/areas.ts` is mock data for the landing page. Remove entries
  as real collections land in the bucket.
