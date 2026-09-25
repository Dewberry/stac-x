import Link from "next/link";

export default function NotFound() {
  return (
    <div className="sx-page">
      <div className="ffx-panel p-[var(--ffx-panel-pad)] max-w-xl">
        <h1 className="text-head font-semibold">Not found</h1>
        <p className="mt-1 text-small text-ink-mut">
          No collection or item by that id is in the catalog. It may have been renamed in the bucket, or the file
          that held it may no longer be listed.
        </p>
        <Link href="/" className="ffx-btn ffx-btn-sm mt-3">
          Back to the map
        </Link>
      </div>
    </div>
  );
}
