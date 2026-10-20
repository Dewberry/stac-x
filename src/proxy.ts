import { NextResponse, type NextRequest } from "next/server";

/**
 * Environments in the URL. Sandbox, Development and Test live under
 * /sandbox, /dev and /test; Production is unprefixed, and is rewritten here onto the /prod route
 * segment so every page reads its environment from the same param. A typed
 * /prod/... URL redirects to the unprefixed one, so each page has one address.
 *
 * The bare root is the exception. Production has no collections yet, so
 * opening the app at / sends you to Development, and Production's own home
 * page answers at /prod instead. Once the first collections are approved
 * through, drop both special cases and / is Production's home again.
 *
 * Kept free of imports from src/lib: proxy runs apart from the render code.
 */
const PREFIXED = new Set(["sandbox", "dev", "test"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const first = pathname.split("/")[1];

  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/dev";
    url.search = search;
    return NextResponse.redirect(url, 307);
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
  // asset and preview proxies) and the static files in public/.
  matcher: ["/((?!_next/|api/asset|api/preview|signin|data/|vendor/|favicon\\.ico).*)"],
};
