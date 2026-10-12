// Entries waiting for the user to confirm, one cache entry per item so several can wait at once.
import type { Pending } from './webhook';

const TTL_SECONDS = 30 * 60;
const key = (userId: string, id: string) => `pending:${userId}:${id}`;

export function putPending(userId: string, pending: Pending): void {
  CacheService.getScriptCache().put(key(userId, pending.id), JSON.stringify(pending), TTL_SECONDS);
}

export function getPending(userId: string, id: string): Pending | null {
  const raw = CacheService.getScriptCache().get(key(userId, id));
  return raw ? (JSON.parse(raw) as Pending) : null;
}

/** Returns and clears the item, so a second tap on the same button does nothing. */
export function takePending(userId: string, id: string): Pending | null {
  const pending = getPending(userId, id);
  if (pending) CacheService.getScriptCache().remove(key(userId, id));
  return pending;
}
