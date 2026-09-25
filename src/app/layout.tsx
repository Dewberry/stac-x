import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Mono, Instrument_Sans } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/shell";
import { ThemeScript } from "@/components/theme";
import { catalogTitle } from "@/lib/config";
import "./globals.css";

/**
 * Bricolage Grotesque carries the headings, Instrument Sans the body and
 * controls, DM Mono the identifiers: site numbers, S3 keys, HUCs.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--sx-display-loaded",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--ffx-sans-loaded",
  display: "swap",
});

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--ffx-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: catalogTitle,
    template: `%s | ${catalogTitle}`,
  },
  description: "Browse STAC collections and items held as geoparquet in S3, and record QC on each item.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full ${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main id="main" tabIndex={-1} className="ffx-shell flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
