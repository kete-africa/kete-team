/**
 * Where a page of this app opens for who reads it at the center (kete-core spec 114): an https
 * address of the app, or none.
 */
export function linkOf(path: string): { href?: string } {
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  return base.startsWith('https://') ? { href: `${base}${path}` } : {};
}
