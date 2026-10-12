// Entries waiting for the user to confirm. One per user; a newer one replaces the older.
import type { Pending } from './webhook';

const TTL_SECONDS = 10 * 60;
const key = (userId: string) => `pending:${userId}`;

export function putPending(userId: string, pending: Pending): void {
  CacheService.getScriptCache().put(key(userId), JSON.stringify(pending), TTL_SECONDS);
}

/** Returns and clears the pending entries, but only if `id` is the current one (stale buttons do nothing). */
export function takePending(userId: string, id: string): Pending | null {
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key(userId));
  if (!raw) return null;
  const pending = JSON.parse(raw) as Pending;
  if (pending.id !== id) return null;
  cache.remove(key(userId));
  return pending;
}
