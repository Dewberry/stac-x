/**
 * Which build of the app this is: the release version, the commit it was
 * built from and when. next.config.ts works the three out once, at build
 * time, and Next writes them into the server and browser code alike, so a
 * page always knows the build it came from, even after the server behind
 * it has moved on. That's what lets an open tab notice a deployment
 * (components/build-notice.tsx).
 *
 * The version is package.json's and follows semver. A release is that
 * version tagged `v1.2.3` on main; README.md has the steps. Builds between
 * releases share a version, so the commit is what tells them apart.
 *
 * Not to be confused with lib/versions.ts, which is about the versions of
 * a collection. Safe to import from client components.
 */
const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const commit = process.env.NEXT_PUBLIC_APP_COMMIT || "";
const builtAt = process.env.NEXT_PUBLIC_APP_BUILT_AT || "";

export const BUILD = {
  version,
  /** The full commit hash. Empty when the build couldn't tell, like a Docker build run by hand without APP_COMMIT. */
  commit,
  /** The commit as people quote it: the first seven characters. */
  shortCommit: commit.slice(0, 7),
  /** ISO time of the build. Empty under `next dev`, which isn't built. */
  builtAt,
};

/** The build on one line, as pasted into a bug report: "stac-x 1.2.3 (abc1234), built 2026-11-18 14:02 UTC". */
export function buildSummary(builtLabel: string): string {
  const parts = [`stac-x ${BUILD.version}`];
  if (BUILD.shortCommit) parts[0] += ` (${BUILD.shortCommit})`;
  parts.push(builtLabel);
  return parts.join(", ");
}

/** "built 2026-11-18 14:02 UTC", or what stands in for it when there was no build. */
export function builtLabel(when: string): string {
  return when ? `built ${when}` : "development build";
}
