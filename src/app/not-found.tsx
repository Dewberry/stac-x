"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { splitEnv, withEnv } from "@/lib/env";

export default function NotFound() {
  const { env } = splitEnv(usePathname());
  return (
    <div className="sx-page">
      <div className="ffx-panel p-[var(--ffx-panel-pad)] max-w-xl">
        <h1 className="text-head font-semibold">Not found</h1>
        <p className="mt-1 text-small text-ink-mut">
          No collection or item by that id is in the catalog. It may have been renamed in the bucket, or the file
          that held it may no longer be listed.
        </p>
        <Link href={withEnv(env, "/")} className="ffx-btn ffx-btn-sm mt-3">
          Back to the map
        </Link>
      </div>
    </div>
  );
}
