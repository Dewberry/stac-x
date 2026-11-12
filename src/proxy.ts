import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth, authEnabled } from "./auth";

/**
 * Environments in the URL. Sandbox, Development and Test live under
 * /sandbox, /dev and /test; Production is unprefixed, and is rewritten here onto the /prod route
 * segment so every page reads its environment from the same param. A typed
 * /prod/... URL redirects to the unprefixed one, so each page has one address.
 *
 * The bare root is the exception. It opens the environment STAC_HOME_ENV
 * names (default Development, for a deployment whose Production is still
 * empty): a redirect to that environment's prefix, or for Production its home
 * page served in place. Production's home also answers at /prod, which is
 * where its links point, so they work whichever environment / opens.
 *
 * With Keycloak configured (src/auth.ts) it's also the sign-in gate. A page
 * opened without a session goes to Keycloak and comes back to it. An API
 * route (the asset and preview proxies included) or a server action answers
 * 401 instead, since a redirect is no answer to a fetch. The action checks
 * the session itself as well (app/actions.ts).
 *
 * Kept free of imports from src/lib: proxy runs apart from the render code.
 */
const PREFIXED = new Set(["sandbox", "dev", "test"]);

/** The environment the bare root opens, read per request so a container can set it at run time. */
function homeEnv(): string {
  const v = process.env.STAC_HOME_ENV?.trim().toLowerCase();
  return v === "prod" || (v && PREFIXED.has(v)) ? v : "dev";
}

/** Routes that sit outside the environments: served as they are, never rewritten onto /prod. */
const ENV_FREE = /^\/api\/(asset|preview)(\/|$)/;

function route(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (ENV_FREE.test(pathname)) return NextResponse.next();
  const first = pathname.split("/")[1];

  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = `/${homeEnv()}`;
    url.search = search;
    return url.pathname === "/prod" ? NextResponse.rewrite(url) : NextResponse.redirect(url, 307);
  }
  if (pathname === "/prod") return NextResponse.next();
  if (first === "prod") {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice("/prod".length);
    url.search = search;
    return NextResponse.redirect(url, 308);
  }
  if (PREFIXED.has(first)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/prod${pathname}`;
  return NextResponse.rewrite(url);
}

/**
 * What a request without a session gets, or null to carry on. nextUrl has
 * the base path stripped, which is what a callbackUrl wants.
 */
function gate(req: NextRequest, signedIn: boolean): NextResponse | null {
  if (signedIn) return null;
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/") || pathname.includes("/api/") || req.headers.has("next-action")) {
    return NextResponse.json({ error: "Sign in to use this." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/api/auth/start";
  url.search = `?callbackUrl=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url, 307);
}

/**
 * Auth.js's wrapper reads the session and keeps its cookie fresh, but with
 * AUTH_URL set it hands on a copy of the request rebuilt from the URL alone,
 * whose nextUrl has lost the base path ("/stac/dev" instead of "/dev"). So
 * only the session is taken from it, and the routing reads the request Next
 * passed in.
 */
export async function proxy(req: NextRequest, event: NextFetchEvent) {
  if (!authEnabled) return route(req);
  const withSession = auth((authed) => gate(req, Boolean(authed.auth?.user)) ?? route(req));
  // Typed for a route handler; as proxy it takes the request and the event.
  return (withSession as unknown as (r: NextRequest, e: NextFetchEvent) => Promise<Response>)(req, event);
}

export const config = {
  // Everything but framework files, the routes that work without a session
  // (sign-in, Auth.js's own, the health check), the icons and web app
  // manifest, and the static files in public/. The asset and preview
  // proxies are matched so they're behind sign-in, and route() passes them
  // through. The bare "/" is listed on its own because under a base path
  // the pattern only matches /stac/..., never /stac itself.
  matcher: ["/", "/((?!_next/|api/auth/|api/health|signin|data/|vendor/|icons/|favicon\\.ico|apple-icon\\.png|manifest\\.webmanifest).*)"],
};
