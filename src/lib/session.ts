import "server-only";

import { auth, authEnabled } from "@/auth";

/**
 * Who the shell thinks you are.
 *
 * With Keycloak configured (src/auth.ts), that's the signed-in person, or
 * null when nobody is. proxy.ts sends anyone without a session to the
 * sign-in page before a catalog page renders, so null only reaches the
 * sign-in page itself.
 *
 * Without it, the app runs as it did before there was an identity provider:
 * every page is open and the shell shows a fixed role, the same stand-in as
 * ffrd-x's.
 */

export type Session = {
  /** Who's signed in, as the header and the QC records show it: Keycloak's username, or the stand-in role. */
  account: string;
  /** Whether this person may use Admin and save QC (STAC_REVIEWER_ROLE). */
  reviewer: boolean;
  /** Signed in through Keycloak, so signing out posts to the federated logout route. */
  federated: boolean;
};

const STAND_IN: Session = { account: "stac-reviewer", reviewer: true, federated: false };

export async function getSession(): Promise<Session | null> {
  if (!authEnabled) return STAND_IN;
  const s = await auth();
  if (!s?.user) return null;
  return { account: s.user.username || s.user.email || "signed in", reviewer: s.user.reviewer, federated: true };
}

export { authEnabled };
