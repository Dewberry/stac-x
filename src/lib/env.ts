/**
 * The four environments, the same in stac-x and ffrd-x.
 *
 * One running app reads all four. Which one a page shows is in its URL:
 * Production is unprefixed, the other three carry a prefix, so a shared link
 * opens in the environment it was copied from and two tabs can't quietly
 * disagree. proxy.ts maps the unprefixed URLs onto the /prod route segment.
 *
 * For now the bare root sends you to Development, since Production has no
 * collections yet, and Production's home page lives at /prod. That's the one
 * Production URL with a prefix. Both go away once Production has content.
 *
 * A collection moves forward one environment at a time. Approving it in
 * Development copies it to Test; approving it in Test copies it to
 * Production. Production is the end of the line.
 *
 * Sandbox sits outside that path. It's a scratch catalog: you can review
 * there, but approving doesn't copy anything, and nothing is promoted into it.
 */

export const ENVS = [
  {
    key: "sandbox",
    label: "Sandbox",
    short: "Sandbox",
    prefix: "/sandbox",
    onPath: false,
    blurb: "A scratch catalog outside promotion. Approving here doesn't send anything on.",
  },
  {
    key: "dev",
    label: "Development",
    short: "Dev",
    prefix: "/dev",
    onPath: true,
    blurb: "Where new collections land. Approving one here sends it to Test.",
  },
  {
    key: "test",
    label: "Test",
    short: "Test",
    prefix: "/test",
    onPath: true,
    blurb: "Collections under review. Approving one here sends it to Production.",
  },
  {
    key: "prod",
    label: "Production",
    short: "Prod",
    prefix: "",
    onPath: true,
    blurb: "What everyone sees. Collections arrive here from Test.",
  },
] as const;

export type EnvKey = (typeof ENVS)[number]["key"];
export type Env = (typeof ENVS)[number];

export function isEnv(v: unknown): v is EnvKey {
  return ENVS.some((e) => e.key === v);
}

export function envMeta(key: EnvKey): Env {
  return ENVS.find((e) => e.key === key)!;
}

/** The environments a collection is promoted through, in order. */
export const PATH: Env[] = ENVS.filter((e) => e.onPath);

/** The environment a collection moves to when it's approved here, or null at the end and off the path. */
export function nextEnv(key: EnvKey): Env | null {
  const i = PATH.findIndex((e) => e.key === key);
  return i < 0 ? null : (PATH[i + 1] ?? null);
}

/** Production's home page. The bare root goes to Development while Production is empty. */
const PROD_HOME = "/prod";

/** A path inside an environment: withEnv("test", "/collections/a") is "/test/collections/a". */
export function withEnv(env: EnvKey, path: string): string {
  const prefix = envMeta(env).prefix;
  if (path === "/" || path === "") return prefix || PROD_HOME;
  return `${prefix}${path}`;
}

/** Split a browser path into its environment and the path inside it. */
export function splitEnv(pathname: string): { env: EnvKey; rest: string } {
  for (const e of ENVS) {
    if (!e.prefix) continue;
    if (pathname === e.prefix || pathname.startsWith(`${e.prefix}/`)) {
      return { env: e.key, rest: pathname.slice(e.prefix.length) || "/" };
    }
  }
  if (pathname === PROD_HOME) return { env: "prod", rest: "/" };
  return { env: "prod", rest: pathname || "/" };
}
