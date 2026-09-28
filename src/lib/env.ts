/**
 * The three environments, the same in stac-x and ffrd-x.
 *
 * One running app reads all three. Which one a page shows is in its URL:
 * Production is unprefixed, the other two carry a prefix, so a shared link
 * opens in the environment it was copied from and two tabs can't quietly
 * disagree. proxy.ts maps the unprefixed URLs onto the /prod route segment.
 *
 * A collection moves forward one environment at a time. Approving it in
 * Development copies it to Testing; approving it in Testing copies it to
 * Production. Production is the end of the line.
 */

export const ENVS = [
  {
    key: "dev",
    label: "Development",
    short: "Dev",
    prefix: "/dev",
    blurb: "Where new collections land. Approving one here sends it to Testing.",
  },
  {
    key: "test",
    label: "Testing",
    short: "Test",
    prefix: "/test",
    blurb: "Collections under review. Approving one here sends it to Production.",
  },
  {
    key: "prod",
    label: "Production",
    short: "Prod",
    prefix: "",
    blurb: "What everyone sees. Collections arrive here from Testing.",
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

/** The environment a collection moves to when it's approved here, or null at the end. */
export function nextEnv(key: EnvKey): Env | null {
  const i = ENVS.findIndex((e) => e.key === key);
  return ENVS[i + 1] ?? null;
}

/** A path inside an environment: withEnv("test", "/collections/a") is "/test/collections/a". */
export function withEnv(env: EnvKey, path: string): string {
  const prefix = envMeta(env).prefix;
  if (path === "/" || path === "") return prefix || "/";
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
  return { env: "prod", rest: pathname || "/" };
}
