import type { Metadata, Viewport } from "next";
import { EnvBand, SiteFooter, SiteHeader } from "@/components/shell";
import { ThemeScript } from "@/components/theme";
import { appDescription, catalogTitle } from "@/lib/config";
import { SESSION } from "@/lib/session";
import { fontVars } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: catalogTitle,
    template: `%s | ${catalogTitle}`,
  },
  description: appDescription,
  applicationName: catalogTitle,
  // iOS ignores the manifest's name for "Add to Home Screen" and reads this.
  appleWebApp: { title: catalogTitle, capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The surface color in each scheme, so the browser bar matches the header.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a2027" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full ${fontVars}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">
        <SiteHeader session={SESSION} />
        <EnvBand />
        <main id="main" tabIndex={-1} className="ffx-shell flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
