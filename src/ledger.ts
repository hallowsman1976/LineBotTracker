// Transactions sheet. Rows are mapped by header name so columns can be added later.
import { bangkokDate, type Entry, type TxType } from './parse';
import { openDb } from './store';

const TYPE_LABEL: Record<TxType, string> = { income: 'รายรับ', expense: 'รายจ่าย' };
const ACTIVE = 'active';
const CANCELLED = 'cancelled';

export interface SaveMeta {
  userId: string;
  rawText: string;
  source: string;
}

function withLock<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(10_000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function txSheet() {
  const sheet = openDb().getSheetByName('transactions');
  if (!sheet) throw new Error('sheet "transactions" not found; run setup()');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  return { sheet, headers };
}

/** Stops user text like "=IMPORTXML(...)" from being stored as a formula. */
function asText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** Saves all entries of one message under a shared id, so they are cancelled together. */
export function addEntries(id: string, entries: Entry[], meta: SaveMeta): void {
  withLock(() => {
    const { sheet, headers } = txSheet();
    const now = new Date();
    const rows = entries.map((e) => {
      const values: Record<string, unknown> = {
        id,
        date: new Date(`${e.date}T00:00:00+07:00`),
        type: TYPE_LABEL[e.type],
        amount: e.amount,
        category: e.category,
        note: asText(e.note),
        userId: meta.userId,
        source: meta.source,
        rawText: asText(meta.rawText),
        timestamp: now,
        status: ACTIVE,
      };
      return headers.map((h) => values[h] ?? '');
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  });
}

/** Cancels the entries with this id, or the user's most recent active ones when id is omitted. */
export function cancelEntries(userId: string, id?: string): Entry[] {
  return withLock(() => {
    const { sheet, headers } = txSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const col = (name: string) => headers.indexOf(name);
    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const isActive = (row: unknown[]) => row[col('userId')] === userId && row[col('status')] !== CANCELLED;

    let target = id;
    for (let i = data.length - 1; !target && i >= 0; i--) {
      if (isActive(data[i])) target = String(data[i][col('id')]);
    }
    if (!target) return [];

    const cancelled: Entry[] = [];
    data.forEach((row, i) => {
      if (!isActive(row) || String(row[col('id')]) !== target) return;
      sheet.getRange(i + 2, col('status') + 1).setValue(CANCELLED);
      cancelled.push(toEntry(row, col));
    });
    return cancelled;
  });
}

/** The user's active entries dated within [from, to] (YYYY-MM-DD), oldest first. */
export function listEntries(userId: string, from: string, to: string): Entry[] {
  const { sheet, headers } = txSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const col = (name: string) => headers.indexOf(name);
  return sheet
    .getRange(2, 1, lastRow - 1, headers.length)
    .getValues()
    .filter((row) => row[col('userId')] === userId && row[col('status')] !== CANCELLED)
    .map((row) => toEntry(row, col))
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function toEntry(row: unknown[], col: (name: string) => number): Entry {
  const date = row[col('date')];
  return {
    type: row[col('type')] === TYPE_LABEL.income ? 'income' : 'expense',
    amount: Number(row[col('amount')]),
    category: String(row[col('category')]),
    note: String(row[col('note')]),
    date: date instanceof Date ? bangkokDate(date) : String(date),
  };
}
