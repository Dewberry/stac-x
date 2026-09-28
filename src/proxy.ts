import { NextResponse, type NextRequest } from "next/server";

/**
 * Environments in the URL. Development and Testing live under /dev and
 * /test; Production is unprefixed, and is rewritten here onto the /prod route
 * segment so every page reads its environment from the same param. A typed
 * /prod URL redirects to the unprefixed one, so each page has one address.
 *
 * Kept free of imports from src/lib: proxy runs apart from the render code.
 */
const PREFIXED = new Set(["dev", "test"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const first = pathname.split("/")[1];

  if (first === "prod") {
    const url = req.nextUrl.clone();
    url.pathname = pathname.slice("/prod".length) || "/";
    url.search = search;
    return NextResponse.redirect(url, 308);
  }
  if (PREFIXED.has(first)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/prod${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Everything but framework files, the environment-free routes (sign-in,
  // asset and preview proxies) and the static files in public/.
  matcher: ["/((?!_next/|api/asset|api/preview|signin|data/|vendor/|favicon\\.ico).*)"],
};
