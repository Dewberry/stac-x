import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/callback-url";

/**
 * GET /api/auth/start?callbackUrl=/dev/admin
 *
 * Where proxy.ts sends someone who opens a page without a session. It goes
 * straight on to Keycloak and back to the page, so a person already signed
 * in to another FFRD app doesn't see a sign-in page at all.
 *
 * It isn't the /signin page because Auth.js sends failed sign-ins there
 * with ?error=, and a page that always went on to Keycloak would loop.
 */
export async function GET(request: Request) {
  const redirectTo = safeCallbackUrl(new URL(request.url).searchParams.get("callbackUrl"));
  // Throws Next's redirect to Keycloak, after setting the state and PKCE cookies.
  await signIn("keycloak", { redirectTo });
}
