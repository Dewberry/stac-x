import { NextResponse, type NextRequest } from "next/server";

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
 * Kept free of imports from src/lib: proxy runs apart from the render code.
 */
const PREFIXED = new Set(["sandbox", "dev", "test"]);

/** The environment the bare root opens, read per request so a container can set it at run time. */
function homeEnv(): string {
  const v = process.env.STAC_HOME_ENV?.trim().toLowerCase();
  return v === "prod" || (v && PREFIXED.has(v)) ? v : "dev";
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
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

export const config = {
  // Everything but framework files, the environment-free routes (sign-in,
  // asset and preview proxies), the icons and web app manifest, and the
  // static files in public/. The bare "/" is listed on its own because under
  // a base path the pattern only matches /stac/..., never /stac itself.
  matcher: ["/", "/((?!_next/|api/asset|api/preview|signin|data/|vendor/|icons/|favicon\\.ico|apple-icon\\.png|manifest\\.webmanifest).*)"],
};
