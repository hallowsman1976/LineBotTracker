// Recurring income (salary etc.): rules, validation, and the daily job that records them.
// Pure like webhook.ts; side effects come in through RecurringStore / RecurringDeps.
import { formatBaht, formatThaiDate } from './format';
import type { LineMessage, QuickReplyItem } from './lineTypes';
import { bangkokDate, CATEGORIES, type Entry } from './parse';
import { monthRange } from './summary';

export interface RecurringInput {
  amount: number;
  category: string;
  note: string;
  /** Day of month 1–31; a shorter month uses its last day, so 31 means "month end". */
  day: number;
}

export interface RecurringIncome extends RecurringInput {
  id: string;
  /** "YYYY-MM" of the last month already recorded or skipped; '' = none yet. */
  lastPosted: string;
}

export interface RecurringStore {
  list(userId: string): RecurringIncome[];
  add(userId: string, rule: RecurringIncome): void;
  /** Returns false when the user has no such rule. */
  update(userId: string, rule: RecurringIncome): boolean;
  remove(userId: string, id: string): boolean;
}

const MAX_AMOUNT = 10_000_000;

/** Validates a rule entered by the user. Returns the input or a Thai error message. */
export function validateRecurringInput(raw: unknown): RecurringInput | string {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const amount = Number(obj.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 'จำนวนเงินต้องมากกว่า 0';
  if (amount > MAX_AMOUNT) return 'จำนวนเงินมากเกินไป';

  const category = obj.category;
  if (typeof category !== 'string' || !CATEGORIES.income.includes(category)) return 'หมวดไม่ถูกต้อง';

  const day = Number(obj.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'วันที่ต้องเป็น 1–31';

  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (note.length > 100) return 'โน้ตยาวเกิน 100 ตัวอักษร';

  return { amount: Math.round(amount * 100) / 100, category, note, day };
}

/** The rule's date in a month ("YYYY-MM"), clamped to the month's last day. */
export function dueDate(month: string, day: number): string {
  const last = monthRange(month)!.to;
  return Number(last.slice(8)) < day ? last : `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * A new or edited rule never back-fills: if this month's date has already passed, this month
 * counts as done and recording starts next month. Today's date still records today.
 */
export function settleLastPosted(lastPosted: string, day: number, today: string): string {
  const month = today.slice(0, 7);
  return lastPosted < month && today > dueDate(month, day) ? month : lastPosted;
}

export function isDue(rule: RecurringIncome, today: string): boolean {
  const month = today.slice(0, 7);
  return rule.lastPosted < month && today >= dueDate(month, rule.day);
}

/** When the rule will next be recorded (today or later). */
export function nextDueDate(rule: RecurringIncome, today: string): string {
  const month = today.slice(0, 7);
  if (rule.lastPosted < month) return dueDate(month, rule.day);
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return dueDate(next, rule.day);
}

export function dayText(day: number): string {
  return day === 31 ? 'ทุกสิ้นเดือน' : `ทุกวันที่ ${day}`;
}

/** "• เงินเดือน +30,000 บาท · ทุกวันที่ 25 (ครั้งถัดไป 25 พ.ย.)" */
export function formatRule(rule: RecurringIncome, today: string): string {
  const note = rule.note && rule.note !== rule.category ? ` (${rule.note})` : '';
  return `• ${rule.category} +${formatBaht(rule.amount)} บาท${note} · ${dayText(rule.day)} (ครั้งถัดไป ${formatThaiDate(nextDueDate(rule, today))})`;
}

/** Creates (no id) or edits a rule. Returns the saved rule, the validation message, or null when id is unknown. */
export function saveRule(
  store: RecurringStore,
  userId: string,
  id: string | undefined,
  raw: unknown,
  today: string,
  newId: () => string,
): RecurringIncome | string | null {
  const input = validateRecurringInput(raw);
  if (typeof input === 'string') return input;

  if (!id) {
    const rule = { ...input, id: newId(), lastPosted: settleLastPosted('', input.day, today) };
    store.add(userId, rule);
    return rule;
  }
  const existing = store.list(userId).find((r) => r.id === id);
  if (!existing) return null;
  const rule = { ...input, id, lastPosted: settleLastPosted(existing.lastPosted, input.day, today) };
  return store.update(userId, rule) ? rule : null;
}

export interface RecurringDeps {
  now(): Date;
  newId(): string;
  activeUserIds(): string[];
  store: RecurringStore;
  ledger: {
    add(id: string, entries: Entry[], meta: { userId: string; rawText: string; source: string; ref?: string }): void;
    hasRef(userId: string, ref: string): boolean;
  };
  push(userId: string, messages: LineMessage[]): void;
  log(level: 'INFO' | 'WARN' | 'ERROR', message: string, detail?: string): void;
}

/**
 * Called daily by a trigger. Records every rule whose date has come this month and tells the user.
 * A missed day catches up on the next run; the ref guards against recording a month twice.
 * Returns how many entries were recorded.
 */
export function runRecurringIncome(deps: RecurringDeps): number {
  const today = bangkokDate(deps.now());
  const month = today.slice(0, 7);
  let recorded = 0;

  for (const userId of deps.activeUserIds()) {
    try {
      const done: { id: string; rule: RecurringIncome }[] = [];
      for (const rule of deps.store.list(userId).filter((r) => isDue(r, today))) {
        const ref = `R${rule.id}${month.replace('-', '')}`;
        if (!deps.ledger.hasRef(userId, ref)) {
          const id = deps.newId();
          const entry: Entry = {
            type: 'income',
            amount: rule.amount,
            category: rule.category,
            note: rule.note || rule.category,
            date: dueDate(month, rule.day),
          };
          deps.ledger.add(id, [entry], { userId, rawText: `รายรับประจำ ${dayText(rule.day)}`, source: 'recurring', ref });
          done.push({ id, rule });
        }
        deps.store.update(userId, { ...rule, lastPosted: month });
      }
      if (done.length) deps.push(userId, [postedMessage(done)]);
      recorded += done.length;
    } catch (err) {
      deps.log('ERROR', 'recurring income failed', `${userId}: ${String((err as Error)?.message ?? err)}`);
    }
  }
  if (recorded) deps.log('INFO', `recurring income recorded ${recorded} entr${recorded === 1 ? 'y' : 'ies'}`, month);
  return recorded;
}

function postedMessage(done: { id: string; rule: RecurringIncome }[]): LineMessage {
  const lines = done.map(({ rule }) => {
    const note = rule.note && rule.note !== rule.category ? ` (${rule.note})` : '';
    return `• ${rule.category} +${formatBaht(rule.amount)} บาท${note}`;
  });
  const items: QuickReplyItem[] = done.slice(0, 13).map(({ id, rule }) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: `↩️ ยกเลิก ${rule.note || rule.category}`.slice(0, 20),
      data: `a=cancel&id=${id}`,
      displayText: 'ยกเลิกรายการนี้',
    },
  }));
  return { type: 'text', text: `💰 บันทึกรายรับประจำแล้ว\n${lines.join('\n')}`, quickReply: { items } };
}
