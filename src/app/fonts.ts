import { Bricolage_Grotesque, DM_Mono, Instrument_Sans } from "next/font/google";

/**
 * Bricolage Grotesque carries the headings and the large figures,
 * Instrument Sans the body and controls, DM Mono the identifiers: site
 * numbers, S3 keys, HUCs. Bricolage is loaded as a variable font with its
 * optical size axis, so a 44px headline gets the tighter display cut and a
 * 13px group label the wider text cut, without any CSS asking for it.
 *
 * They're here rather than in the root layout because global-error renders
 * its own <html> and needs the same three.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
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

/** The classes that put all three fonts' variables on <html>. */
export const fontVars = `${display.variable} ${sans.variable} ${mono.variable}`;
