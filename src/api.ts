// Dashboard API (POST ...exec?api=1). Pure like webhook.ts; side effects come in through ApiDeps.
import {
  bangkokDate,
  validateEntryInput,
  type Entry,
  type ImageResult,
  type ImageSource,
  type LedgerEntry,
  type SlipParties,
} from './parse';
import { saveRule, type RecurringIncome, type RecurringStore } from './recurring';
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
    add(id: string, entries: Entry[], meta: { userId: string; rawText: string; source: string; ref?: string }): void;
    /** True when an active entry of this user already carries this slip reference. */
    hasRef(userId: string, ref: string): boolean;
  };
  /** Reads one slip/receipt photo (base64 JPEG) for this user; throws when Gemini fails. */
  readSlip(imageBase64: string, userId: string, today: string): ImageResult;
  recurring: RecurringStore;
  newId(): string;
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

export interface RecurringData {
  rules: RecurringIncome[];
}

/** What the dashboard gets back for one photo picked from the gallery. */
export type SlipReadData =
  | {
      status: 'ok';
      source: ImageSource;
      entry: Entry;
      ref: string;
      parties: SlipParties;
      /** An active entry already carries this ref; the dashboard leaves it unticked. */
      duplicate: boolean;
    }
  | { status: 'other' }
  | { status: 'unreadable' };

export interface SlipSaveData {
  saved: number;
  /** Refs skipped because they were already saved (before or earlier in this batch). */
  duplicates: string[];
}

/** One reviewed slip sent back for saving. */
export interface SlipSaveItem {
  entry: Entry;
  source: ImageSource;
  ref?: string;
  parties?: SlipParties;
}

// ~6 MB of base64 (about 4.5 MB of JPEG); the dashboard downsizes far below this.
const MAX_IMAGE_BASE64 = 6_000_000;
const MAX_SLIPS_PER_SAVE = 30;

interface ApiRequest {
  image?: unknown;
  items?: unknown;
  action?: unknown;
  idToken?: unknown;
  month?: unknown;
  entryId?: unknown;
  entry?: unknown;
  /** Recurring rule id; omitted on recurringSave to create a new rule. */
  id?: unknown;
  rule?: unknown;
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
      case 'recurring':
        return { ok: true, data: { rules: deps.recurring.list(userId) } };
      case 'recurringSave':
        return saveRecurring(deps, userId, req.id, req.rule);
      case 'recurringDelete':
        return deleteRecurring(deps, userId, req.id);
      case 'slipRead':
        return readSlip(deps, userId, req.image);
      case 'slipSave':
        return saveSlips(deps, userId, req.items);
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

function saveRecurring(deps: ApiDeps, userId: string, id: unknown, rule: unknown): ApiResponse<RecurringIncome> {
  if (id !== undefined && (typeof id !== 'string' || !id)) return fail('bad_request', 'id must be a string');
  const saved = saveRule(deps.recurring, userId, id as string | undefined, rule, bangkokDate(deps.now()), deps.newId);
  if (saved === null) return fail('not_found');
  if (typeof saved === 'string') return fail('bad_request', saved);
  return { ok: true, data: saved };
}

function deleteRecurring(deps: ApiDeps, userId: string, id: unknown): ApiResponse<{ id: string }> {
  if (typeof id !== 'string' || !id) return fail('bad_request', 'id required');
  if (!deps.recurring.remove(userId, id)) return fail('not_found');
  return { ok: true, data: { id } };
}

function readSlip(deps: ApiDeps, userId: string, image: unknown): ApiResponse<SlipReadData> {
  if (typeof image !== 'string' || !image) return fail('bad_request', 'image required');
  if (image.length > MAX_IMAGE_BASE64) return fail('bad_request', 'รูปใหญ่เกินไป');
  if (!/^[A-Za-z0-9+/=]+$/.test(image)) return fail('bad_request', 'image must be base64');

  let result: ImageResult;
  try {
    result = deps.readSlip(image, userId, bangkokDate(deps.now()));
  } catch (err) {
    deps.log('ERROR', 'dashboard slip read failed', String((err as Error)?.message ?? err));
    return fail('server_error', 'อ่านรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
  if (result.kind !== 'transaction') return { ok: true, data: { status: result.kind } };
  const duplicate = !!result.ref && deps.ledger.hasRef(userId, result.ref);
  return {
    ok: true,
    data: { status: 'ok', source: result.source, entry: result.entry, ref: result.ref, parties: result.parties, duplicate },
  };
}

/**
 * Saves the slips the user reviewed. Every entry is validated like a hand edit, and each slip
 * gets its own id so it can be cancelled on its own. Already-saved refs are skipped, not errors.
 */
function saveSlips(deps: ApiDeps, userId: string, rawItems: unknown): ApiResponse<SlipSaveData> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return fail('bad_request', 'items required');
  if (rawItems.length > MAX_SLIPS_PER_SAVE) return fail('bad_request', `บันทึกได้ครั้งละไม่เกิน ${MAX_SLIPS_PER_SAVE} รายการ`);

  const today = bangkokDate(deps.now());
  const items: { entry: Entry; source: ImageSource; ref: string; rawText: string }[] = [];
  for (const raw of rawItems as Partial<Record<keyof SlipSaveItem, unknown>>[]) {
    const entry = validateEntryInput(raw?.entry, today);
    if (typeof entry === 'string') return fail('bad_request', entry);
    if (raw.source !== 'slip' && raw.source !== 'receipt') return fail('bad_request', 'source must be slip or receipt');
    const ref = typeof raw.ref === 'string' ? raw.ref.replace(/[^0-9A-Za-z]/g, '').slice(0, 60) : '';
    const p = (raw.parties ?? {}) as Partial<Record<keyof SlipParties, unknown>>;
    const name = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
    const rawText = [name(p.sender), name(p.receiver)].filter(Boolean).join(' → ');
    items.push({ entry, source: raw.source, ref, rawText });
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  let saved = 0;
  for (const item of items) {
    if (item.ref && (seen.has(item.ref) || deps.ledger.hasRef(userId, item.ref))) {
      duplicates.push(item.ref);
      continue;
    }
    if (item.ref) seen.add(item.ref);
    deps.ledger.add(deps.newId(), [item.entry], {
      userId,
      rawText: item.rawText,
      source: item.source,
      ref: item.ref || undefined,
    });
    saved++;
  }
  return { ok: true, data: { saved, duplicates } };
}

function fail(error: ApiError, message?: string): { ok: false; error: ApiError; message?: string } {
  return message ? { ok: false, error, message } : { ok: false, error };
}
