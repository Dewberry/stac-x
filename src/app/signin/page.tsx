import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to STAC.",
};

/**
 * The stand-in sign-in, the same as ffrd-x's. There's no identity provider
 * yet, so the form goes straight to the catalog. The fields have no names on
 * purpose: nothing typed here is sent anywhere, and a passphrase never ends
 * up in a URL.
 */
export default function SignIn() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
      <div className="w-full max-w-[26rem]">
        <h1 className="font-display text-head font-semibold tracking-[-0.02em] text-ink">Sign in</h1>

        <form action="/" className="mt-6 space-y-4">
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
      </div>
    </div>
  );
}
