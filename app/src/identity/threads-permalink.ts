// Shared producer/consumer contract. A claim can remain valid even when no safe link is available.
export function threadsPermalink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['threads.com','www.threads.com','threads.net','www.threads.net'].includes(u.hostname)
      && !u.port && !u.username && !u.password && !u.search && !u.hash
      && /^\/@[a-zA-Z0-9._]{1,30}\/post\/[A-Za-z0-9_-]{5,40}\/?$/.test(u.pathname) ? u.href : null;
  } catch { return null; }
}
