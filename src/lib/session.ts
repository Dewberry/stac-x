/**
 * Who the shell thinks you are. The same stand-in as ffrd-x's.
 *
 * There is no identity provider wired up yet, so the shell takes an explicit
 * session instead of guessing: the sign-in page passes `null`, and every
 * catalog page passes SESSION. Nothing here fakes a login, stores a token or
 * reads a cookie. Dropping real auth in means turning SESSION into the result
 * of the session lookup.
 *
 * Identities are roles, never people.
 */

export type Session = {
  /** Program account, as it would appear in an audit record. */
  account: string;
  /** Two characters for the header badge. */
  badge: string;
};

export const SESSION: Session = { account: "stac-reviewer", badge: "sr" };
