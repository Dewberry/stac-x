import { qcMeta } from "@/lib/stac";

/**
 * The review state as a mark plus a word, never the mark alone. The shape
 * varies with the state as well as the hue, so a colorblind reader gets it
 * from the mark too: a filled square for approved, a ring for pending, a bar
 * for needs revision, a slash for rejected.
 */
const SHAPE: Record<string, string | undefined> = {
  pending: "ring",
  approved: undefined,
  needs_revision: "bar",
  rejected: "slash",
};

export function QcChip({ status, className = "" }: { status: string | null | undefined; className?: string }) {
  const meta = qcMeta(status ?? "pending");
  return (
    <span className={`ffx-chip ${className}`} data-tone={meta.tone} data-shape={SHAPE[meta.value]}>
      {meta.label}
    </span>
  );
}
