import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { isSessionEnded } from "./backchannel-logout";

/**
 * Sign-in through Keycloak, with Auth.js. The realm is FFRD's
 * (https://auth.dewberryanalytics.com/auth/realms/ffrd), shared with the
 * other FFRD Cloud apps, so a person signed in to one of them signs in here
 * without typing anything.
 *
 * Auth is on when KEYCLOAK_ISSUER is set and off when it isn't. Off, the app
 * behaves as it did before there was an identity provider: every page is
 * open and the header shows the stand-in account (lib/session.ts). That
 * keeps a checkout with no .env, and a deployment that hasn't been given a
 * client yet, working as they are. Auth.js also throws on an OIDC provider
 * with no issuer, which would take every /api/auth route down, so the
 * provider is left out rather than registered empty.
 *
 * Sessions are JWT cookies, eight hours long, with nothing stored server
 * side. The refresh token is kept in the cookie for one reason: federated
 * logout hands it back to Keycloak to end the session there too, which
 * skips Keycloak's "Do you want to log out?" page. Nothing refreshes with it.
 *
 * This file is imported by proxy.ts, which runs apart from the render code,
 * so it stays free of imports from src/lib.
 */

const issuer = process.env.KEYCLOAK_ISSUER?.trim().replace(/\/+$/, "") || "";
const clientId = process.env.KEYCLOAK_CLIENT_ID?.trim() || "";

export const authEnabled = Boolean(issuer);

/** The Keycloak settings the logout routes need, or null when auth is off. */
export const keycloak = authEnabled
  ? { issuer, clientId, clientSecret: process.env.KEYCLOAK_CLIENT_SECRET?.trim() || "" }
  : null;

/**
 * A realm role or a role on this app's client that's needed to review:
 * the Admin page and saving QC, which also promotes. Unset, anyone who can
 * sign in can review, the same as before there was sign-in.
 */
const reviewerRole = process.env.STAC_REVIEWER_ROLE?.trim() || "";

// The same value as BASE_PATH in lib/utils.ts, read here directly to keep
// this file free of src/lib.
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/**
 * Cookie names come from static config, evaluated once, while Auth.js picks
 * secure cookies per request from the URL. So the prefix follows AUTH_URL,
 * which is set wherever the app is served over https. Only names are set
 * below; Auth.js deep-merges them over its defaults, so httpOnly, sameSite
 * and secure are its own.
 */
const secure = (process.env.AUTH_URL ?? "").startsWith("https://");
const securePrefix = secure ? "__Secure-" : "";
const hostPrefix = secure ? "__Host-" : "";

/** Auth.js also salts the JWT with this name, so the logout route needs the same one to read it. */
export const SESSION_COOKIE_NAME = `${securePrefix}stac-x.session-token`;

if (!authEnabled && process.env.NODE_ENV === "production") {
  console.warn("stac-x: KEYCLOAK_ISSUER isn't set, so sign-in is off and every page is open.");
}

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      /** Keycloak's username, which is what the header and the QC records show. */
      username: string;
      /** Whether this person may use Admin and save QC. */
      reviewer: boolean;
    };
  }
}

/** The roles an access token carries: the realm's and this client's. */
function rolesIn(accessToken: string | undefined): string[] {
  if (!accessToken) return [];
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const realm: unknown = claims?.realm_access?.roles;
    const client: unknown = claims?.resource_access?.[clientId]?.roles;
    return [...(Array.isArray(realm) ? realm : []), ...(Array.isArray(client) ? client : [])].filter(
      (r): r is string => typeof r === "string",
    );
  } catch {
    return [];
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  basePath: `${BASE_PATH}/api/auth`,
  trustHost: true,
  providers: authEnabled
    ? [
        Keycloak({
          issuer,
          clientId,
          clientSecret: keycloak?.clientSecret,
        }),
      ]
    : [],

  // Auth.js's own pages are unstyled and offer a button to a provider list
  // of one. Ours is /signin; failures land there too, with ?error=. Auth.js
  // redirects to these as written, so they carry the base path.
  pages: { signIn: `${BASE_PATH}/signin`, error: `${BASE_PATH}/signin` },

  // The defaults are authjs.* at path "/", shared with every app on the same
  // host (ffrd.cloud.dewberryanalytics.com has several), so two sign-ins in
  // two tabs could clobber each other's PKCE and state cookies. The session
  // cookie is also scoped to the base path, so it isn't sent along to the
  // host's other apps.
  cookies: {
    sessionToken: { name: SESSION_COOKIE_NAME, options: { path: BASE_PATH || "/" } },
    callbackUrl: { name: `${securePrefix}stac-x.callback-url` },
    csrfToken: { name: `${hostPrefix}stac-x.csrf-token` },
    pkceCodeVerifier: { name: `${securePrefix}stac-x.pkce.code_verifier` },
    state: { name: `${securePrefix}stac-x.state` },
    nonce: { name: `${securePrefix}stac-x.nonce` },
  },

  session: { strategy: "jwt", maxAge: 8 * 60 * 60, updateAge: 15 * 60 },

  callbacks: {
    // Callers pass paths without the base path. Add it here, once, and keep
    // every redirect on this origin.
    redirect({ url, baseUrl }) {
      const origin = new URL(baseUrl).origin;
      if (url.startsWith("/") && !url.startsWith("//")) {
        const prefixed = BASE_PATH && (url === BASE_PATH || url.startsWith(`${BASE_PATH}/`));
        return `${origin}${prefixed ? url : BASE_PATH + url}`;
      }
      try {
        const u = new URL(url);
        if ((u.protocol === "http:" || u.protocol === "https:") && u.origin === origin) return url;
      } catch {
        // Not a URL. Falls through to the app's root.
      }
      return `${origin}${BASE_PATH}/`;
    },

    // `profile` and `account` are only there on the sign-in call, so what
    // they carry is copied onto the token once and rides along after that.
    // sid is the Keycloak session this sign-in belongs to: when Keycloak
    // ends it, the back-channel route records it and this clears the cookie.
    async jwt({ token, profile, account }) {
      if (isSessionEnded(typeof token.sid === "string" ? token.sid : undefined)) return null;
      if (profile?.sub) {
        token.authId = profile.sub;
        token.sid = typeof profile.sid === "string" ? profile.sid : undefined;
        token.username =
          (typeof profile.preferred_username === "string" && profile.preferred_username) || profile.email || profile.sub;
      }
      if (account) {
        token.reviewer = !reviewerRole || rolesIn(account.access_token).includes(reviewerRole);
        if (account.refresh_token) token.refresh_token = account.refresh_token;
      }
      return token;
    },

    session({ session, token }) {
      session.user.username = typeof token.username === "string" ? token.username : (session.user.email ?? "");
      session.user.reviewer = token.reviewer === true;
      return session;
    },
  },
});
