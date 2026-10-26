"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon, ICONS } from "./icons";
import { QcChip } from "./qc-chip";
import type { QcStatus } from "@/lib/stac";
import { versionName } from "@/lib/versions";

export type VersionChoice = {
  /** Tells the choices apart; the current one's key is `current`. */
  key: string;
  href: string;
  /** The name shown, e.g. "Version 2" or "Previous version". */
  name: string;
  /** The id under the name: the collection's, or the item's when that's what differs. */
  id: string;
  latest: boolean;
  deprecated: boolean;
  qc: QcStatus;
};

/**
 * The versions of a collection or an item in this environment, newest first,
 * each with its review state. Picking one opens that version's page. Only
 * shown when there's more than one version to pick from.
 */
export function VersionMenu({ current, versions, noun = "versions" }: { current: string; versions: VersionChoice[]; noun?: string }) {
  const here = versions.find((v) => v.key === current);
  const name = here?.name ?? versionName(null);
  const newest = [...versions].reverse();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="ffx-btn ffx-btn-sm" aria-label={`${name}. Change version`}>
        {name}
        <Icon d={ICONS.chevron} size={10} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ffx-menu sx-version-menu" align="end" sideOffset={6} collisionPadding={12}>
          <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-micro text-ink-mut">
            {versions.length} {noun}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={current}>
            {newest.map((v) => (
              <DropdownMenu.RadioItem key={v.key} value={v.key} asChild>
                <Link
                  href={v.href}
                  className="ffx-menu-item sx-version-item"
                  aria-current={v.key === current ? "page" : undefined}
                >
                  <span className="sx-version-name">
                    <span>{v.name}</span>
                    {v.latest && <span className="sx-tag">Latest</span>}
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
