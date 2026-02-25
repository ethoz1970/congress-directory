const cache = new Map<string, { data: unknown; expires: number }>();

/**
 * Fetch with in-memory caching. Returns cached data if available and not expired.
 * Falls back to a normal fetch otherwise.
 */
export async function cachedFetch<T = unknown>(url: string, ttlMs: number = 300000): Promise<T> {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.expires > now) {
    return cached.data as T;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  cache.set(url, { data, expires: now + ttlMs });
  return data as T;
}

/** Clear a specific URL from cache */
export function clearCachedFetch(url: string): void {
  cache.delete(url);
}

/** Clear all cached entries */
export function clearAllCachedFetch(): void {
  cache.clear();
}

// TTL presets (in ms)
export const CACHE_TTL = {
  LEGISLATOR: 5 * 60 * 1000,     // 5 minutes
  COMMITTEES: 10 * 60 * 1000,    // 10 minutes
  YOUTUBE: 15 * 60 * 1000,       // 15 minutes
  LEGISLATION: 5 * 60 * 1000,    // 5 minutes
} as const;
