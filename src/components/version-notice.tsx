import Link from "next/link";
import { getCollection } from "@/lib/catalog";
import type { EnvKey } from "@/lib/env";
import type { Collection } from "@/lib/stac";
import { collectionHref, itemHref } from "@/lib/utils";
import { versionName } from "@/lib/versions";

/**
 * Said on an older version's pages, the way STAC Browser does: this isn't the
 * latest, and here's the one that is. On an item page it links to the same
 * item in the latest version when that version has it.
 */
export async function VersionNotice({ env, c, item }: { env: EnvKey; c: Collection; item?: string }) {
  if (c.series.latest === c.id) return null;
  const latest = c.series.versions.find((v) => v.id === c.series.latest);
  const here = c.series.versions.find((v) => v.id === c.id);
  if (!latest) return null;

  let href = collectionHref(env, latest.id);
  let action = `Open ${inline(latest.label)}`;
  if (item) {
    const other = await getCollection(env, latest.id);
    if (other?.items.some((i) => i.id === item)) {
      href = itemHref(env, latest.id, item);
      action = `Open this item in ${inline(latest.label)}`;
    }
  }
  const thisOne = versionName(here?.label ?? null);
  const what = item ? `This item is from ${inline(here?.label ?? null)} of the collection` : `This is ${inline(here?.label ?? null)}`;

  return (
    <div className="sx-notice" role="note">
      {c.deprecated && <span className="sx-tag" data-tone="muted">Deprecated</span>}
      <span>
        {c.deprecated
          ? `${thisOne} is deprecated and may be removed. ${versionName(latest.label)} is the latest.`
          : `${what}. ${versionName(latest.label)} is the latest.`}
      </span>
      <Link href={href} className="ffx-link">
        {action}
      </Link>
    </div>
  );
}

/** "Version 2" mid-sentence: "open version 2". */
function inline(label: string | null) {
  return versionName(label).replace(/^Version /, "version ").replace(/^Unversioned$/, "an unversioned copy");
}
