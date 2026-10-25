// `recurring` sheet: one row per recurring-income rule, mapped by header name like transactions.
import { withLock } from './ledger';
import { bangkokDate } from './parse';
import type { RecurringIncome, RecurringStore } from './recurring';
import { openDb } from './store';

const ACTIVE = 'active';
const DELETED = 'deleted';

function sheetWithHeaders() {
  const sheet = openDb().getSheetByName('recurring');
  if (!sheet) throw new Error('sheet "recurring" not found; run setup()');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  return { sheet, headers, col: (name: string) => headers.indexOf(name) };
}

function ruleCells(rule: RecurringIncome): Record<string, unknown> {
  return {
    amount: rule.amount,
    category: rule.category,
    note: /^[=+\-@]/.test(rule.note) ? `'${rule.note}` : rule.note,
    day: rule.day,
    // Forced text, or Sheets turns "2026-10" into a date.
    lastPosted: rule.lastPosted ? `'${rule.lastPosted}` : '',
  };
}

function toRule(row: unknown[], col: (name: string) => number): RecurringIncome {
  const lastPosted = row[col('lastPosted')];
  return {
    id: String(row[col('id')]),
    amount: Number(row[col('amount')]),
    category: String(row[col('category')]),
    note: String(row[col('note')] ?? ''),
    day: Number(row[col('day')]),
    lastPosted: lastPosted instanceof Date ? bangkokDate(lastPosted).slice(0, 7) : String(lastPosted ?? ''),
  };
}

function list(userId: string): RecurringIncome[] {
  const { sheet, headers, col } = sheetWithHeaders();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, headers.length)
    .getValues()
    .filter((row) => row[col('userId')] === userId && row[col('status')] !== DELETED)
    .map((row) => toRule(row, col));
}

function add(userId: string, rule: RecurringIncome): void {
  withLock(() => {
    const { sheet, headers } = sheetWithHeaders();
    const values: Record<string, unknown> = { id: rule.id, userId, ...ruleCells(rule), status: ACTIVE, createdAt: new Date() };
    sheet.appendRow(headers.map((h) => values[h] ?? ''));
  });
}

/** Runs fn on the user's live row with this id; false when there is none. */
function withOwnRow(userId: string, id: string, fn: (set: (name: string, v: unknown) => void) => void) {
  return withLock(() => {
    const { sheet, headers, col } = sheetWithHeaders();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return false;
    const index = sheet
      .getRange(2, 1, lastRow - 1, headers.length)
      .getValues()
      .findIndex((row) => String(row[col('id')]) === id && row[col('userId')] === userId && row[col('status')] !== DELETED);
    if (index < 0) return false;
    fn((name, v) => sheet.getRange(index + 2, col(name) + 1).setValue(v));
    return true;
  });
}

export const recurringStore: RecurringStore = {
  list,
  add,
  update: (userId, rule) =>
    withOwnRow(userId, rule.id, (set) => {
      for (const [name, value] of Object.entries(ruleCells(rule))) set(name, value);
    }),
  remove: (userId, id) => withOwnRow(userId, id, (set) => set('status', DELETED)),
};
