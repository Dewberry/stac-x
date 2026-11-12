import { NextResponse } from "next/server";
import { keycloak } from "@/auth";
import { markSessionEnded, verifyLogoutToken } from "@/backchannel-logout";

/**
 * Keycloak's back-channel logout endpoint. Keycloak POSTs a signed logout
 * token here, server to server, whenever a session that signed in to this
 * app ends. See src/backchannel-logout.ts for how that reaches the person's
 * next request.
 *
 * It's the client's "Backchannel logout URL", with "Backchannel logout
 * session required" on (docs/keycloak.md). No browser calls it and there's
 * no session to check: the token's signature is the authentication.
 */
export async function POST(request: Request) {
  if (!keycloak?.clientId) return logoutError("Sign-in isn't configured", 501);

  let logoutToken: string | null = null;
  try {
    const value = (await request.formData()).get("logout_token");
    logoutToken = typeof value === "string" ? value : null;
  } catch {
    // Not a form body. Falls through to the missing-token answer.
  }
  if (!logoutToken) return logoutError("Missing logout_token", 400);

  try {
    const { sid, sub } = await verifyLogoutToken(logoutToken, keycloak);
    markSessionEnded(sid);
    console.info("stac-x: Keycloak ended a session", { sub, sid });
  } catch (e) {
    console.error("stac-x: rejected a back-channel logout token", e);
    return logoutError("Invalid logout_token", 400);
  }

  // The spec asks for 200 and no caching.
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

function logoutError(description: string, status: number) {
  return NextResponse.json(
    { error: "invalid_request", error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
