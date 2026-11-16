/**
 * Keeping the session here in step with Keycloak's.
 *
 * The cookie alone would last eight hours whatever happened at Keycloak.
 * The back-channel route (backchannel-logout.ts) covers a logout while
 * Keycloak's session is alive, but not a session that timed out there, and
 * nothing would keep that session alive while someone works here: the realm
 * ends one after 30 idle minutes, and then FFRD Cloud asks for the password
 * again.
 *
 * So every few minutes the jwt callback in auth.ts trades the refresh token
 * for a new one. While that works the person is still signed in at Keycloak,
 * and asking counts as activity there. When Keycloak says the token is no
 * good, its session is over, however that happened, and the one here ends
 * with it. If Keycloak can't be reached or answers with a server error, the
 * session is kept and the check runs again next time: an outage there
 * shouldn't sign everyone out here.
 *
 * One request can read the session several times (the proxy, the layout,
 * the page), and only the proxy can write the refreshed cookie back. The
 * last answer per Keycloak session is kept in this process's memory, so
 * those reads, and the requests of the next few minutes, share one call.
 * The realm doesn't revoke a refresh token on use, so a read that still
 * holds the previous one isn't turned away.
 *
 * Kept free of imports from src/lib, since auth.ts (and so proxy.ts)
 * imports it.
 */

/** How often to ask, in seconds. Well inside the realm's 30 minute idle limit. */
const CHECK_SECONDS = Math.max(5, Number(process.env.KEYCLOAK_CHECK_SECONDS) || 300);

type Checked = { at: number; refreshToken: string | null; alive: boolean };

const g = globalThis as typeof globalThis & {
  stacxChecked?: Map<string, Checked>;
  stacxChecking?: Map<string, Promise<Checked>>;
};
const checked = (g.stacxChecked ??= new Map());
const checking = (g.stacxChecking ??= new Map());
const MAX_REMEMBERED = 10_000;

export type KeycloakClient = { issuer: string; clientId: string; clientSecret: string };

/**
 * Whether the Keycloak session behind a token is still alive, asking at
 * most every CHECK_SECONDS. Returns the refresh token to carry from now on,
 * or null when the session is over.
 */
export async function keepAlive(
  client: KeycloakClient,
  sid: string,
  refreshToken: string,
  lastChecked: number,
): Promise<{ refreshToken: string; checkedAt: number } | null> {
  const now = Date.now();
  const known = checked.get(sid);
  const at = Math.max(lastChecked, known?.at ?? 0);
  if (known && !known.alive) return null;
  if (now - at < CHECK_SECONDS * 1000) {
    return { refreshToken: known?.refreshToken ?? refreshToken, checkedAt: at };
  }

  let pending = checking.get(sid);
  if (!pending) {
    pending = ask(client, known?.refreshToken ?? refreshToken).finally(() => checking.delete(sid));
    checking.set(sid, pending);
  }
  const answer = await pending;
  if (checked.size >= MAX_REMEMBERED) {
    const oldest = checked.keys().next().value;
    if (oldest !== undefined) checked.delete(oldest);
  }
  checked.set(sid, answer);
  if (!answer.alive) return null;
  return { refreshToken: answer.refreshToken ?? refreshToken, checkedAt: answer.at };
}

async function ask(client: KeycloakClient, refreshToken: string): Promise<Checked> {
  const at = Date.now();
  try {
    const res = await fetch(`${client.issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { refresh_token?: unknown };
      return { at, alive: true, refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null };
    }
    // 400 invalid_grant is Keycloak saying the session is gone or the token
    // expired. A 401 would be this app's own secret being wrong, and a 5xx
    // is Keycloak's trouble: neither says anything about the person.
    if (res.status === 400) return { at, alive: false, refreshToken: null };
    console.error("stac-x: Keycloak answered the session check with", res.status);
  } catch (e) {
    console.error("stac-x: couldn't reach Keycloak to check a session", e);
  }
  return { at, alive: true, refreshToken: null };
}
