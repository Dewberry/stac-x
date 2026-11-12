import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

/**
 * Keycloak's back-channel logout, for sessions ended somewhere else.
 *
 * Keycloak POSTs a signed logout token to /api/auth/backchannel-logout when
 * one of its sessions ends: a logout in another FFRD app (they share the
 * realm), an admin ending the session in the console, or the session timing
 * out. Without it, a session ended elsewhere would keep working here for the
 * rest of its eight hours, since this app never goes back to Keycloak after
 * sign-in.
 *
 * Sessions are JWT cookies, so there's nothing server side to delete. The
 * route records the Keycloak session id (sid) instead, and the jwt callback
 * in auth.ts clears any token carrying a recorded one. The record lives in
 * this process's memory, which is fine for an app that runs as one
 * container. A restart loses it, and then a session ended elsewhere lasts
 * until its own maxAge, as it would with no route at all.
 *
 * Ported from lidar-viewer, which does the same against its own realm.
 * Kept free of imports from src/lib, since auth.ts (and so proxy.ts)
 * imports it.
 */

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

// Longer than a session lasts (eight hours), so a recorded sid outlasts
// every token that carries it.
const ENDED_SESSION_TTL_MS = 13 * 60 * 60 * 1000;
const MAX_ENDED_SESSIONS = 10_000;
// Logout tokens are minted right before they're sent. This allows for skew.
const MAX_TOKEN_AGE_SECONDS = 5 * 60;
const JWKS_TTL_MS = 10 * 60 * 1000;

// On globalThis so the proxy and every route bundle in the process share one record.
const g = globalThis as typeof globalThis & { stacxEndedSessions?: Map<string, number> };
const endedSessions = (g.stacxEndedSessions ??= new Map());

export function markSessionEnded(sid: string): void {
  if (endedSessions.size >= MAX_ENDED_SESSIONS) {
    const now = Date.now();
    for (const [key, expiresAt] of endedSessions) if (expiresAt <= now) endedSessions.delete(key);
    // Still full: drop the oldest. A Map iterates in insertion order.
    if (endedSessions.size >= MAX_ENDED_SESSIONS) {
      const oldest = endedSessions.keys().next().value;
      if (oldest !== undefined) endedSessions.delete(oldest);
    }
  }
  endedSessions.set(sid, Date.now() + ENDED_SESSION_TTL_MS);
}

export function isSessionEnded(sid: string | undefined): boolean {
  if (!sid) return false;
  const expiresAt = endedSessions.get(sid);
  if (expiresAt === undefined) return false;
  if (Date.now() < expiresAt) return true;
  endedSessions.delete(sid);
  return false;
}

type Jwk = JsonWebKey & { kid?: string; use?: string };

let jwksCache: { issuer: string; keys: Jwk[]; fetchedAt: number } | null = null;

async function signingKeys(issuer: string, refresh: boolean): Promise<Jwk[]> {
  if (!refresh && jwksCache?.issuer === issuer && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`${issuer}/protocol/openid-connect/certs`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Keycloak certs answered ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { issuer, keys, fetchedAt: Date.now() };
  return keys;
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/**
 * Check a back-channel logout token (OpenID Connect Back-Channel Logout 1.0,
 * section 2.6) and return its session id. Throws on anything invalid.
 *
 * Only RS256 is accepted, which is what the realm signs with. Pinning the
 * algorithm instead of trusting the header's keeps a token signed some other
 * way from being checked against the wrong kind of key.
 */
export async function verifyLogoutToken(
  logoutToken: string,
  { issuer, clientId }: { issuer: string; clientId: string },
): Promise<{ sid: string; sub?: string }> {
  const parts = logoutToken.split(".");
  if (parts.length !== 3) throw new Error("Not a JWS");
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeSegment(headerSegment);
  if (header.alg !== "RS256") throw new Error(`Unexpected alg ${String(header.alg)}`);

  const findKey = (keys: Jwk[]) => keys.find((k) => k.kid === header.kid && k.use !== "enc");
  // A kid that isn't cached means Keycloak rotated its keys since.
  const key = findKey(await signingKeys(issuer, false)) ?? findKey(await signingKeys(issuer, true));
  if (!key) throw new Error("No matching signing key");

  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${headerSegment}.${payloadSegment}`),
    createPublicKey({ key, format: "jwk" }),
    Buffer.from(signatureSegment, "base64url"),
  );
  if (!valid) throw new Error("Bad signature");

  const claims = decodeSegment(payloadSegment);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const events = claims.events as Record<string, unknown> | undefined;
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (claims.iss !== issuer) throw new Error("Wrong issuer");
  if (!audience.includes(clientId)) throw new Error("Wrong audience");
  if (typeof claims.iat !== "number" || Math.abs(nowSeconds - claims.iat) > MAX_TOKEN_AGE_SECONDS) {
    throw new Error("Stale, future or missing iat");
  }
  if (typeof events?.[BACKCHANNEL_EVENT] !== "object") throw new Error("Not a logout event");
  // The spec forbids a nonce, so an ID token can't pass for a logout token.
  if ("nonce" in claims) throw new Error("Has a nonce");
  // The client has "Backchannel logout session required" on, so every
  // logout token names a session. Without one there's nothing to end.
  if (typeof claims.sid !== "string" || !claims.sid) throw new Error("No sid");

  return { sid: claims.sid, sub: typeof claims.sub === "string" ? claims.sub : undefined };
}
