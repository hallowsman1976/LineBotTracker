import { InvalidTokenError } from './api';
import { LINE_LOGIN_CHANNEL_ID } from './publicConfig';

const MAX_CACHE_SECONDS = 60 * 60;

/**
 * Verifies a LIFF ID token with LINE and returns its userId (`sub`).
 * Results are cached by token hash until the token expires, so the dashboard
 * doesn't pay a LINE round trip on every request.
 */
export function verifyIdToken(idToken: string): string {
  if (!LINE_LOGIN_CHANNEL_ID) throw new Error('LINE_LOGIN_CHANNEL_ID is not set in src/publicConfig.ts');

  const cache = CacheService.getScriptCache();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  const key = `idt:${Utilities.base64EncodeWebSafe(digest)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: LINE_LOGIN_CHANNEL_ID },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new InvalidTokenError(res.getContentText().slice(0, 200));

  const { sub, exp } = JSON.parse(res.getContentText()) as { sub?: string; exp?: number };
  if (!sub) throw new InvalidTokenError('token has no sub');

  const ttl = Math.min(MAX_CACHE_SECONDS, Math.floor((exp ?? 0) - Date.now() / 1000));
  if (ttl > 10) cache.put(key, sub, ttl);
  return sub;
}
