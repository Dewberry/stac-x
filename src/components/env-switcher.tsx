"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ENVS, envMeta, splitEnv, withEnv, type EnvKey } from "@/lib/env";
import type { Session } from "@/lib/session";

/**
 * The header's right end and the environment band. This file is the same in
 * stac-x and ffrd-x; keep the two copies identical.
 *
 * Everything here reads the environment from the URL on the client rather
 * than taking it from a layout, because a layout that holds the header can
 * stay mounted when you move between environments and would keep showing the
 * one you started in.
 *
 * From the sm breakpoint up the bar holds the environment switcher, whatever
 * the app puts beside it (ffrd-x's search), and the account menu. Below it
 * the switcher and the account menu fold into one menu button, which keeps
 * the environment's name and color, so on a phone it's still never a
 * question which environment you're in. Changing environment keeps you on
 * the same page in the other one. The account menu can carry app pages
 * (stac-x's Admin) under Home, each kept in the current environment, and a
 * block of the app's own items above Sign out (stac-x's theme).
 */

const SIGN_IN = "/signin";

export function HeaderControls({
  session,
  home,
  homeLabel,
  signOut,
  links = [],
  menuItems,
  children,
}: {
  session: Session | null;
  /** The signed-in home, without an environment prefix: "/" or "/study-areas". */
  home: string;
  homeLabel: string;
  signOut: string;
  /** Pages for the account menu, without an environment prefix: [{ href: "/admin", label: "Admin" }]. */
  links?: MenuLink[];
  /** App-specific account menu items, above Sign out: Radix DropdownMenu parts. */
  menuItems?: ReactNode;
  /** App-specific controls between the switcher and the account menu. */
  children?: ReactNode;
}) {
  const pathname = usePathname();
  if (!session || pathname === SIGN_IN) {
    return (
      <Link href={SIGN_IN} className="ffx-btn ffx-btn-sm no-underline">
        Sign in
      </Link>
    );
  }
  const { env } = splitEnv(pathname);
  const account = {
    session,
    home: withEnv(env, home),
    homeLabel,
    signOut,
    links: links.map((l) => ({ ...l, href: withEnv(env, l.href) })),
    menuItems,
  };
  return (
    <>
      <div className="hidden sm:block">
        <EnvSwitcher env={env} />
      </div>
      {children}
      <div className="hidden sm:block">
        <AccountMenu {...account} />
      </div>
      <div className="sm:hidden">
        <MobileMenu env={env} {...account} />
      </div>
    </>
  );
}

/**
 * The band under the header outside Production. Production has none:
 * it looks the way the app always does.
 */
export function EnvBand() {
  const pathname = usePathname();
  if (pathname === SIGN_IN) return null;
  const { env } = splitEnv(pathname);
  if (env === "prod") return null;
  const e = envMeta(env);
  return (
    <section className="ffx-envband" data-env={env} aria-label="Environment">
      <div className="ffx-shell ffx-envband-inner">
        <b>{e.label}</b>
        <span>{e.blurb}</span>
      </div>
    </section>
  );
}

type MenuLink = { href: string; label: string };
type Account = {
  session: Session;
  home: string;
  homeLabel: string;
  signOut: string;
  links: MenuLink[];
  menuItems?: ReactNode;
};

function EnvSwitcher({ env }: { env: EnvKey }) {
  const current = envMeta(env);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="ffx-env-trigger" data-env={env} aria-label={`Environment: ${current.label}. Change environment`}>
        <span className="ffx-env-dot" data-env={env} aria-hidden="true" />
        {current.label}
        <Chevron />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ffx-menu ffx-env-menu" align="end" sideOffset={6}>
          <EnvItems env={env} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function AccountMenu(account: Account) {
  const { session } = account;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="ffx-account-trigger" aria-label={`Account menu, signed in as ${session.account}`}>
        <Avatar />
        <Chevron />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ffx-menu" align="end" sideOffset={6}>
          <AccountItems {...account} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Below sm: one button with the environment on it, opening both menus in one. */
function MobileMenu({ env, ...account }: Account & { env: EnvKey }) {
  const current = envMeta(env);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="ffx-env-trigger" data-env={env} aria-label={`Menu. Environment: ${current.label}`}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" strokeLinecap="round" />
        </svg>
        {current.label}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ffx-menu ffx-env-menu ffx-mobile-menu" align="end" sideOffset={6} collisionPadding={12}>
          <EnvItems env={env} />
          <DropdownMenu.Separator className="my-1 h-px bg-rule" />
          <AccountItems {...account} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Each environment's entry opens its landing page, wherever the viewer is.
 * A collection open in Test needn't exist in Development, and the home
 * page is where its collections are listed.
 */
function EnvItems({ env }: { env: EnvKey }) {
  return (
    <>
      <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-micro text-ink-mut">Environment</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={env}>
        {ENVS.map((e) => (
          <DropdownMenu.RadioItem key={e.key} value={e.key} asChild>
            <Link href={withEnv(e.key, "/")} className="ffx-menu-item ffx-env-item" aria-current={e.key === env ? "true" : undefined}>
              <span className="ffx-env-dot" data-env={e.key} aria-hidden="true" />
              <span>
                <span className="ffx-env-name">{e.label}</span>
                <span className="ffx-env-blurb">{e.blurb}</span>
              </span>
            </Link>
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    </>
  );
}

function AccountItems({ session, home, homeLabel, signOut, links, menuItems }: Account) {
  return (
    <>
      <DropdownMenu.Label className="px-2.5 pb-1.5 pt-1 text-micro text-ink-mut">
        Signed in as <span className="ffx-id text-ink">{session.account}</span>
      </DropdownMenu.Label>
      <DropdownMenu.Separator className="my-1 h-px bg-rule" />
      <DropdownMenu.Item asChild>
        <Link href={home} className="ffx-menu-item">
          {homeLabel}
        </Link>
      </DropdownMenu.Item>
      {links.map((l) => (
        <DropdownMenu.Item key={l.href} asChild>
          <Link href={l.href} className="ffx-menu-item">
            {l.label}
          </Link>
        </DropdownMenu.Item>
      ))}
      {menuItems && (
        <>
          <DropdownMenu.Separator className="my-1 h-px bg-rule" />
          {menuItems}
          <DropdownMenu.Separator className="my-1 h-px bg-rule" />
        </>
      )}
      <DropdownMenu.Item asChild>
        <Link href={signOut} className="ffx-menu-item">
          Sign out
        </Link>
      </DropdownMenu.Item>
    </>
  );
}

/**
 * A generic person silhouette. Identities are roles, not people, so there is
 * no photo to show; the shape still says "this is you" faster than initials
 * do, and the chevron beside it says there's a menu.
 */
function Avatar() {
  return (
    <span className="ffx-avatar" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <circle cx="12" cy="9" r="4" />
        <path d="M4.5 20.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6v.5h-15z" />
      </svg>
    </span>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
