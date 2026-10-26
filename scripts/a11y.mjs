#!/usr/bin/env node
/**
 * Accessibility check: runs axe-core against the running app, every kind of
 * page in light and dark, and checks that nothing scrolls sideways at 320px
 * (WCAG 1.4.10). Exits 1 if anything fails, so it can gate a change.
 *
 *   npm run dev                         (in another terminal)
 *   npx playwright install chromium     (once)
 *   npm run a11y
 *
 * A11Y_BASE is where the app answers (default http://localhost:3000, add the
 * base path if the build has one) and A11Y_ENV the environment's prefix
 * (default /dev). Pages are found from the catalog, so the first collection
 * and its first item stand in for the rest. Without catalog access only the
 * pages that don't need data are checked, and the script says so.
 *
 * axe covers what a machine can see. It doesn't follow focus through a
 * dialog or hear a live region, so keyboard and screen reader passes are
 * still worth doing by hand after a change to an interactive part.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";

const BASE = (process.env.A11Y_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const ENV = process.env.A11Y_ENV ?? "/dev";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function firstLink(path, pattern) {
  const res = await fetch(BASE + path).catch(() => null);
  if (!res?.ok) return null;
  const m = (await res.text()).match(pattern);
  return m ? m[0] : null;
}

const home = await fetch(BASE + ENV).catch(() => null);
if (!home) {
  console.error(`Nothing answered at ${BASE}${ENV}. Start the app with npm run dev first.`);
  process.exit(2);
}

const collection = await firstLink(ENV, new RegExp(`${ENV}/collections/[^"/?#\\\\]+`));
// A catalog opened in the home rail, when the catalog has catalogs.
const scoped = await firstLink(ENV, new RegExp(`${ENV}\\?in=[^"&#\\\\]+`));
const item = collection && (await firstLink(collection, new RegExp(`${collection}/items/[^"/?#\\\\]+`)));
const pages = [
  "/signin",
  ENV,
  scoped,
  collection,
  item,
  `${ENV}/admin`,
  `${ENV}/admin/not-built-yet`,
  `${ENV}/no-such-page`,
].filter(Boolean);
if (!collection) console.log("No collections found, so collection and item pages are skipped.\n");

const browser = await chromium.launch();
let failures = 0;

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sx-theme", t);
    } catch {}
  }, theme);
  const page = await context.newPage();
  for (const path of pages) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    // The home page with a collection open, which is most of what's on it.
    if (path === ENV && (await page.locator(".sx-row").count())) {
      await page.locator(".sx-row").first().click();
      await page.waitForTimeout(800);
    }
    failures += report(`${theme} ${path}`, await new AxeBuilder({ page }).withTags(TAGS).analyze());
  }
  await context.close();
}

const narrow = await (await browser.newContext({ viewport: { width: 320, height: 640 } })).newPage();
for (const path of pages) {
  await narrow.goto(BASE + path, { waitUntil: "networkidle" });
  const { scroll, view } = await narrow.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    view: document.documentElement.clientWidth,
  }));
  if (scroll > view) {
    failures++;
    console.log(`✗ 320px ${path}: the page scrolls sideways (${scroll}px wide)`);
  } else console.log(`✓ 320px ${path}`);
}

await browser.close();
console.log(failures ? `\n${failures} problem${failures === 1 ? "" : "s"}.` : "\nNo problems found.");
process.exit(failures ? 1 : 0);

function report(label, results) {
  if (!results.violations.length) {
    console.log(`✓ ${label}`);
    return 0;
  }
  console.log(`✗ ${label}`);
  for (const v of results.violations) {
    console.log(`    ${v.id} (${v.impact}): ${v.help}`);
    for (const n of v.nodes.slice(0, 5)) {
      console.log(`      ${n.target.join(" ")}`);
      const why = n.failureSummary?.split("\n")[1]?.trim();
      if (why) console.log(`        ${why}`);
    }
    if (v.nodes.length > 5) console.log(`      and ${v.nodes.length - 5} more`);
  }
  return results.violations.length;
}
