import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { keycloak, SESSION_COOKIE_NAME, signOut } from "@/auth";
import { BASE_PATH } from "@/lib/utils";

/**
 * Sign out of this app and of Keycloak, in one navigation.
 *
 * Ending only the session here would leave the Keycloak one alive, and on a
 * realm shared with the other FFRD apps the next "Sign in" would then
 * finish with no prompt, so signing out would look like it did nothing.
 *
 * The Keycloak session is ended server to server with the refresh token kept
 * at sign-in, and the browser comes straight back to the sign-in page. The
 * browser's end-session URL can't do that without Keycloak's "Do you want to
 * log out?" page, so it's only the fallback, for when that call fails.
 *
 * POST only, from the account menu's form. A GET would let any site sign
 * someone out with a link or an image. A cross-site form POST arrives
 * without the SameSite=Lax cookie, and the origin check refuses it before
 * anything is touched. The redirects are 303 so the browser follows with a
 * GET instead of posting to Keycloak.
 */
export async function POST(request: Request) {
  if (isCrossSite(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const landing = `${publicOrigin(request)}${BASE_PATH}/signin`;

  // Read before signOut, which clears the cookie it lives in.
  const refreshToken = await readRefreshToken(request);

  // The local session goes first. If the hand-off to Keycloak then fails,
  // the person is still signed out here, which is the safer way to fail.
  try {
    await signOut({ redirect: false });
  } catch (e) {
    console.error("stac-x: clearing the session on sign-out", e);
  }

  if (!keycloak?.clientId) return NextResponse.redirect(landing, 303);

  if (refreshToken && keycloak.clientSecret && (await endKeycloakSession(refreshToken))) {
    return NextResponse.redirect(landing, 303);
  }

  const params = new URLSearchParams({ client_id: keycloak.clientId, post_logout_redirect_uri: landing });
  return NextResponse.redirect(`${keycloak.issuer}/protocol/openid-connect/logout?${params}`, 303);
}

/**
 * The origin people reach the app at, not the one the container sees.
 * AUTH_URL first, then what the reverse proxy forwards, then the request's
 * own. It's only ever handed to Keycloak, which checks it against the
 * client's registered URIs, so trusting the forwarded header isn't an open
 * redirect.
 */
function publicOrigin(request: Request): string {
  try {
    if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  } catch {
    // A malformed AUTH_URL: fall through rather than fail a sign-out over it.
  }
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (host) {
    const proto = (request.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
    try {
      return new URL(`${proto}://${host}`).origin;
    } catch {
      // Falls through to the request's own origin.
    }
  }
  return new URL(request.url).origin;
}

/**
 * Is this POST somebody else's form? Browsers send Origin on form POSTs, so
 * one naming another host, or the opaque "null", is refused. A missing
 * Origin is allowed: a cross-site POST without one arrives without the
 * session cookie anyway, so there's nothing for it to end.
 */
function isCrossSite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  try {
    return new URL(origin).host !== new URL(publicOrigin(request)).host;
  } catch {
    return true;
  }
}

async function readRefreshToken(request: Request): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const token = await getToken({ req: request, secret, cookieName: SESSION_COOKIE_NAME, salt: SESSION_COOKIE_NAME });
    return typeof token?.refresh_token === "string" ? token.refresh_token : null;
  } catch (e) {
    console.error("stac-x: reading the session token on sign-out", e);
    return null;
  }
}

/** End the Keycloak session behind a refresh token. Keycloak answers 204 when it's gone. */
async function endKeycloakSession(refreshToken: string): Promise<boolean> {
  if (!keycloak) return false;
  try {
    const res = await fetch(`${keycloak.issuer}/protocol/openid-connect/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: keycloak.clientId,
        client_secret: keycloak.clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error("stac-x: Keycloak refused to end the session", { status: res.status });
    return res.ok;
  } catch (e) {
    console.error("stac-x: ending the Keycloak session", e);
    return false;
  }
}
