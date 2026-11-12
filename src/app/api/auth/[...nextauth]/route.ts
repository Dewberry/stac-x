import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { BASE_PATH } from "@/lib/utils";

/**
 * Auth.js's routes: the Keycloak callback, the session and CSRF endpoints.
 *
 * Next strips the base path from request.url before a route handler sees it,
 * and Auth.js needs it back to match its own basePath
 * (https://github.com/nextauthjs/next-auth/issues/13034), so it's put back
 * here. lidar-viewer does the same.
 */
function withBasePath(handler: (req: NextRequest) => Promise<Response>) {
  return (req: NextRequest) => {
    if (!BASE_PATH) return handler(req);
    const url = new URL(req.url);
    if (url.pathname === BASE_PATH || url.pathname.startsWith(`${BASE_PATH}/`)) return handler(req);
    url.pathname = `${BASE_PATH}${url.pathname}`;
    return handler(new NextRequest(url, req));
  };
}

export const GET = withBasePath(handlers.GET);
export const POST = withBasePath(handlers.POST);
