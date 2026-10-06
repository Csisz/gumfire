/** Which web pages may open the relay (M20: the game can be hosted on another site). */
/** May a page from `origin` (served via `host`) use the relay? */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: readonly string[]): boolean {
  if (!allowed.length || allowed.includes('*')) return true;
  if (!origin) return true; // not a browser (tools, tests)
  const o = origin.replace(/\/+$/, '');
  if (host && (o === `http://${host}` || o === `https://${host}`)) return true;
  return allowed.some((a) => (a.startsWith('*.') ? o.endsWith(a.slice(1)) && /^https?:\/\//.test(o) : a === o));
}
