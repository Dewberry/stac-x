import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authEnabled, signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/callback-url";
import { withEnv } from "@/lib/env";
import { getSession } from "@/lib/session";
import { withBase } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to STAC.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * What a failed sign-in comes back with (Auth.js's error codes), said
 * plainly. Anything not listed gets the general line.
 */
const ERRORS: Record<string, string> = {
  Configuration: "Sign-in isn't set up correctly on the server. The server log has the details.",
  AccessDenied: "Your account doesn't have access to this app.",
};

/**
 * The sign-in page.
 *
 * With Keycloak configured (src/auth.ts), it's one button that goes on to
 * Keycloak. Most people never see it: proxy.ts sends a signed-out visitor
 * straight to Keycloak through /api/auth/start. It's where signing out lands
 * and where a failed sign-in comes back to, with ?error=.
 *
 * Without Keycloak it's the stand-in, the same as ffrd-x's: the form goes
 * straight to the catalog. Its fields have no names on purpose, so nothing
 * typed is sent anywhere and a passphrase never ends up in a URL. It lands
 * in Development, the same place the bare root sends you while Production
 * is empty. A plain form action gets no base path from Next, so it goes
 * through withBase.
 */
export default async function SignIn({ searchParams }: Props) {
  const sp = await searchParams;
  const callbackUrl = safeCallbackUrl(sp.callbackUrl);
  const error = typeof sp.error === "string" ? sp.error : null;

  if (!authEnabled) return <StandIn />;

  // Already signed in: there's nothing to do here.
  if (!error && (await getSession())) redirect(callbackUrl);

  async function start() {
    "use server";
    await signIn("keycloak", { redirectTo: callbackUrl });
  }

  return (
    <Card>
      {error && (
        <p role="alert" className="mt-4 text-small text-ink-sec">
          {ERRORS[error] ?? "Sign-in didn't finish. Try again."}
        </p>
      )}
      <p className="mt-4 text-small text-ink-sec">Sign in with your FFRD Cloud account.</p>
      <form action={start} className="mt-6">
        <button type="submit" className="ffx-btn ffx-btn-primary w-full">
          Sign in
        </button>
      </form>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
      <div className="w-full max-w-[26rem]">
        <h1 className="font-display text-head font-semibold tracking-[-0.02em] text-ink">Sign in</h1>
        {children}
      </div>
    </div>
  );
}

function StandIn() {
  return (
    <Card>
      <form action={withBase(withEnv("dev", "/"))} className="mt-6 space-y-4">
        <div>
          <label htmlFor="subject" className="mb-1.5 block text-micro text-ink-mut">
            Program account
          </label>
          <input id="subject" type="text" autoComplete="username" className="ffx-input" />
        </div>

        <div>
          <label htmlFor="passphrase" className="mb-1.5 block text-micro text-ink-mut">
            Passphrase
          </label>
          <input id="passphrase" type="password" autoComplete="current-password" className="ffx-input" />
        </div>

        <button type="submit" className="ffx-btn ffx-btn-primary w-full">
          Sign in
        </button>
      </form>
    </Card>
  );
}
