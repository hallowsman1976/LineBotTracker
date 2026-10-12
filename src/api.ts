// Dashboard API (POST ...exec?api=1). Pure like webhook.ts; side effects come in through ApiDeps.
import { bangkokDate, validateEntryInput, type Entry, type LedgerEntry } from './parse';
import { monthRange } from './summary';

/** Thrown by verifyIdToken when LINE rejects the token (expired, wrong channel, forged). */
export class InvalidTokenError extends Error {}

export interface ApiDeps {
  /** Returns the LINE userId the token was issued for; throws InvalidTokenError if it isn't valid. */
  verifyIdToken(idToken: string): string;
  isAllowedUser(userId: string): boolean;
  now(): Date;
  ledger: {
    list(userId: string, from: string, to: string): LedgerEntry[];
    /** Returns false when no active entry with this id belongs to the user. */
    update(userId: string, entryId: string, entry: Entry): boolean;
    remove(userId: string, entryId: string): boolean;
  };
  log(level: 'INFO' | 'WARN' | 'ERROR', message: string, detail?: string): void;
}

export type ApiError = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'server_error';

export type ApiResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError; message?: string; userId?: string };

export interface MonthData {
  month: string;
  entries: LedgerEntry[];
}

interface ApiRequest {
  action?: unknown;
  idToken?: unknown;
  month?: unknown;
  entryId?: unknown;
  entry?: unknown;
}

export function handleApi(rawBody: string, deps: ApiDeps): ApiResponse {
  let req: ApiRequest;
  try {
    req = JSON.parse(rawBody) ?? {};
  } catch {
    return fail('bad_request', 'invalid JSON');
  }
  if (typeof req.idToken !== 'string' || !req.idToken) return fail('unauthorized');

  try {
    let userId: string;
    try {
      userId = deps.verifyIdToken(req.idToken);
    } catch (err) {
      if (err instanceof InvalidTokenError) return fail('unauthorized');
      throw err;
    }
    if (!deps.isAllowedUser(userId)) return { ok: false, error: 'forbidden', userId };

    switch (req.action) {
      case 'month':
        return getMonth(deps, userId, req.month);
      case 'update':
        return updateEntry(deps, userId, req.entryId, req.entry);
      case 'delete':
        return deleteEntry(deps, userId, req.entryId);
      default:
        return fail('bad_request', 'unknown action');
    }
  } catch (err) {
    deps.log('ERROR', `api ${String(req.action)} failed`, String((err as Error)?.stack ?? err));
    return fail('server_error');
  }
}

function getMonth(deps: ApiDeps, userId: string, month: unknown): ApiResponse<MonthData> {
  const range = typeof month === 'string' ? monthRange(month) : null;
  if (!range) return fail('bad_request', 'month must be YYYY-MM');
  return { ok: true, data: { month: month as string, entries: deps.ledger.list(userId, range.from, range.to) } };
}

function updateEntry(deps: ApiDeps, userId: string, entryId: unknown, input: unknown): ApiResponse<LedgerEntry> {
  if (typeof entryId !== 'string' || !entryId) return fail('bad_request', 'entryId required');
  const entry = validateEntryInput(input, bangkokDate(deps.now()));
  if (typeof entry === 'string') return fail('bad_request', entry);
  if (!deps.ledger.update(userId, entryId, entry)) return fail('not_found');
  return { ok: true, data: { ...entry, entryId } };
}

function deleteEntry(deps: ApiDeps, userId: string, entryId: unknown): ApiResponse<{ entryId: string }> {
  if (typeof entryId !== 'string' || !entryId) return fail('bad_request', 'entryId required');
  if (!deps.ledger.remove(userId, entryId)) return fail('not_found');
  return { ok: true, data: { entryId } };
}

function fail(error: ApiError, message?: string): { ok: false; error: ApiError; message?: string } {
  return message ? { ok: false, error, message } : { ok: false, error };
}
