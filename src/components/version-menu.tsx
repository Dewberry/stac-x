"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon, ICONS } from "./icons";
import { QcChip } from "./qc-chip";
import type { EnvKey } from "@/lib/env";
import type { Series } from "@/lib/stac";
import { collectionHref } from "@/lib/utils";
import { versionName } from "@/lib/versions";

/**
 * The versions of a collection in this environment, newest first, each with
 * its review state. Picking one opens that version's page. Only shown when
 * there's more than one version to pick from.
 */
export function VersionMenu({ env, current, series }: { env: EnvKey; current: string; series: Series }) {
  const here = series.versions.find((v) => v.id === current);
  const newest = [...series.versions].reverse();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="ffx-btn ffx-btn-sm" aria-label={`${versionName(here?.label ?? null)}. Change version`}>
        {versionName(here?.label ?? null)}
        <Icon d={ICONS.chevron} size={10} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ffx-menu sx-version-menu" align="end" sideOffset={6} collisionPadding={12}>
          <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-micro text-ink-mut">
            {series.versions.length} versions
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={current}>
            {newest.map((v) => (
              <DropdownMenu.RadioItem key={v.id} value={v.id} asChild>
                <Link
                  href={collectionHref(env, v.id)}
                  className="ffx-menu-item sx-version-item"
                  aria-current={v.id === current ? "page" : undefined}
                >
                  <span className="sx-version-name">
                    <span>{versionName(v.label)}</span>
                    {v.id === series.latest && <span className="sx-tag">Latest</span>}
                    {v.deprecated && <span className="sx-tag" data-tone="muted">Deprecated</span>}
                  </span>
                  <span className="sx-version-sub">
                    <span className="ffx-id">{v.id}</span>
                    <QcChip status={v.qc} />
                  </span>
                </Link>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
