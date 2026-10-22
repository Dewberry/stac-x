"use client";

import { ErrorCard } from "@/components/error-card";
import { useStoredTheme } from "@/components/theme";
import { withBase } from "@/lib/utils";
import { fontVars } from "./fonts";
import "./globals.css";

/**
 * The root layout itself threw, so this replaces the whole document. It
 * brings its own fonts, styles and theme, and a bar with the wordmark alone
 * where the header was, so it still looks like the app rather than a
 * browser error.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const theme = useStoredTheme();
  return (
    <html lang="en" className={`h-full ${fontVars}`} data-theme={theme} suppressHydrationWarning>
      <head>
        <title>Something went wrong</title>
      </head>
      <body className="flex min-h-full flex-col">
        <header className="sx-header">
          <div className="ffx-shell sx-header-inner">
            <a href={withBase("/")} className="sx-brand">
              STAC
            </a>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="ffx-shell flex-1">
          <div className="sx-page sx-msg">
            <div className="sx-msg-stage">
              <ErrorCard error={error} retry={retry} home={withBase("/")} />
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
