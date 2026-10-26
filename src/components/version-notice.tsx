import Link from "next/link";
import { getCollection } from "@/lib/catalog";
import { envMeta, type EnvKey } from "@/lib/env";
import type { Collection } from "@/lib/stac";
import { collectionHref, itemHref } from "@/lib/utils";
import { compareLabels, versionName } from "@/lib/versions";
import { versionsElsewhere } from "@/lib/versions-elsewhere";

/**
 * Said on an older version's pages, the way STAC Browser does: this isn't the
 * latest, and here's the one that is. On an item page it links to the same
 * item in the latest version when that version has it. The latest can live
 * in another environment (the Sandbox copy of a dataset names the
 * Development one as its successor); then the notice says where.
 */
export async function VersionNotice({ env, c, item }: { env: EnvKey; c: Collection; item?: string }) {
  // A newer version held elsewhere outranks this environment's latest.
  const away = (await versionsElsewhere(env, c))
    .filter((v) => v.rel === "successor-version" || v.rel === "latest-version")
    .sort((a, b) => compareLabels(a.label, b.label))
    .at(-1);
  if (!away && c.series.latest === c.id) return null;
  const here = c.series.versions.find((v) => v.id === c.id);
  const latest = away
    ? { env: away.env, id: away.collection.id, label: away.label, items: away.collection.items }
    : await (async () => {
        const v = c.series.versions.find((x) => x.id === c.series.latest);
        return v ? { env, id: v.id, label: v.label, items: (await getCollection(env, v.id))?.items ?? [] } : null;
      })();
  if (!latest) return null;

  const where = latest.env === env ? "" : `, in ${envMeta(latest.env).label},`;
  const there = latest.env === env ? "" : ` in ${envMeta(latest.env).label}`;
  let href = collectionHref(latest.env, latest.id);
  let action = `Open ${inline(latest.label)}${there}`;
  if (item && latest.items.some((i) => i.id === item)) {
    href = itemHref(latest.env, latest.id, item);
    action = `Open this item in ${inline(latest.label)}${there}`;
  }
  const thisOne = versionName(here?.label ?? c.version);
  const what = item ? `This item is from ${inline(here?.label ?? c.version)} of the collection` : `This is ${inline(here?.label ?? c.version)}`;

  return (
    <div className="sx-notice" role="note">
      {c.deprecated && <span className="sx-tag" data-tone="muted">Deprecated</span>}
      <span>
        {c.deprecated
          ? `${thisOne} is deprecated and may be removed. ${versionName(latest.label)}${where} is the latest.`
          : `${what}. ${versionName(latest.label)}${where} is the latest.`}
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
