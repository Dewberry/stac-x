/**
 * Where to go after signing in, from a ?callbackUrl= the app wrote itself
 * (proxy.ts) or anyone typed. Only a path on this app is kept, without the
 * base path; anything else, like another site or a protocol-relative
 * "//host", falls back to the bare root, which opens the home environment.
 */
export function safeCallbackUrl(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
