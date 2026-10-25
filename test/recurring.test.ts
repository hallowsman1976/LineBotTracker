import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/parse';
import {
  dueDate,
  nextDueDate,
  runRecurringIncome,
  saveRule,
  settleLastPosted,
  validateRecurringInput,
  type RecurringDeps,
  type RecurringIncome,
} from '../src/recurring';
import type { LineMessage } from '../src/webhook';
import { memRecurring } from './memRecurring';

// 07:00 Bangkok = 00:00 UTC
const at = (date: string) => new Date(`${date}T00:00:00Z`);
const salary: RecurringIncome = { id: 'r1', amount: 30000, category: 'เงินเดือน', note: '', day: 25, lastPosted: '2026-09' };

function setup(now: Date, rules: (RecurringIncome & { userId: string })[] = [{ ...salary, userId: 'Ua' }]) {
  const recurring = memRecurring(rules);
  const saved: { id: string; entries: Entry[]; userId: string; source: string; rawText?: string; ref?: string }[] = [];
  const pushes: { to: string; messages: LineMessage[] }[] = [];
  let ids = 0;
  const deps: RecurringDeps = {
    now: () => now,
    newId: () => `e${++ids}`,
    activeUserIds: () => ['Ua', 'Ub'],
    store: recurring.store,
    ledger: {
      add: (id, entries, meta) => void saved.push({ id, entries, ...meta }),
      hasRef: (userId, ref) => saved.some((s) => s.userId === userId && s.ref === ref),
    },
    push: (to, messages) => void pushes.push({ to, messages }),
    log: () => {},
  };
  return { deps, saved, pushes, rows: recurring.rows };
}

describe('dates', () => {
  it('clamps the day to the end of shorter months', () => {
    expect(dueDate('2026-10', 25)).toBe('2026-10-25');
    expect(dueDate('2026-11', 31)).toBe('2026-11-30');
    expect(dueDate('2026-02', 30)).toBe('2026-02-28');
    expect(dueDate('2028-02', 31)).toBe('2028-02-29');
  });

  it('does not back-fill a date that already passed this month', () => {
    expect(settleLastPosted('', 25, '2026-10-24')).toBe('');
    expect(settleLastPosted('', 25, '2026-10-25')).toBe('');
    expect(settleLastPosted('', 25, '2026-10-26')).toBe('2026-10');
    expect(settleLastPosted('2026-10', 1, '2026-10-26')).toBe('2026-10');
  });

  it('finds the next date, rolling over December', () => {
    expect(nextDueDate({ ...salary, lastPosted: '2026-09' }, '2026-10-12')).toBe('2026-10-25');
    expect(nextDueDate({ ...salary, lastPosted: '2026-10' }, '2026-10-26')).toBe('2026-11-25');
    expect(nextDueDate({ ...salary, day: 31, lastPosted: '2026-12' }, '2026-12-31')).toBe('2027-01-31');
  });
});

describe('validateRecurringInput', () => {
  it.each([
    [{ amount: 0 }, 'จำนวนเงินต้องมากกว่า 0'],
    [{ amount: 1e9 }, 'จำนวนเงินมากเกินไป'],
    [{ category: 'อาหาร' }, 'หมวดไม่ถูกต้อง'],
    [{ day: 0 }, 'วันที่ต้องเป็น 1–31'],
    [{ day: 2.5 }, 'วันที่ต้องเป็น 1–31'],
    [{ note: 'x'.repeat(101) }, 'โน้ตยาวเกิน 100 ตัวอักษร'],
  ])('rejects %j', (patch, message) => {
    expect(validateRecurringInput({ amount: 100, category: 'เงินเดือน', note: '', day: 1, ...patch })).toBe(message);
  });
});

describe('saveRule', () => {
  it("returns null for a rule that isn't the user's", () => {
    const { store } = memRecurring([{ ...salary, userId: 'Ua' }]);
    expect(saveRule(store, 'Ub', 'r1', { amount: 1, category: 'อื่นๆ', day: 1 }, '2026-10-12', () => 'x')).toBeNull();
  });
});

describe('runRecurringIncome', () => {
  it('does nothing before the day', () => {
    const { deps, saved, pushes } = setup(at('2026-10-24'));
    expect(runRecurringIncome(deps)).toBe(0);
    expect(saved).toHaveLength(0);
    expect(pushes).toHaveLength(0);
  });

  it('records on the day, tells the user with a cancel button, and only once', () => {
    const { deps, saved, pushes, rows } = setup(at('2026-10-25'));
    expect(runRecurringIncome(deps)).toBe(1);
    expect(saved).toEqual([
      {
        id: 'e1',
        userId: 'Ua',
        source: 'recurring',
        rawText: 'รายรับประจำ ทุกวันที่ 25',
        ref: 'Rr1202610',
        entries: [{ type: 'income', amount: 30000, category: 'เงินเดือน', note: 'เงินเดือน', date: '2026-10-25' }],
      },
    ]);
    expect(rows[0].lastPosted).toBe('2026-10');
    const message = pushes[0].messages[0];
    expect(pushes[0].to).toBe('Ua');
    expect(message.type === 'text' && message.text).toContain('+30,000 บาท');
    expect(message.type === 'text' && message.quickReply?.items[0].action.data).toBe('a=cancel&id=e1');

    expect(runRecurringIncome(deps)).toBe(0);
    expect(saved).toHaveLength(1);
  });

  it("catches up on a later day when a run was missed, dated on the rule's day", () => {
    const { deps, saved } = setup(at('2026-10-27'));
    runRecurringIncome(deps);
    expect(saved[0].entries[0].date).toBe('2026-10-25');
  });

  it('does not record again when the entry exists but lastPosted was not saved', () => {
    const { deps, saved, pushes, rows } = setup(at('2026-10-25'));
    saved.push({ id: 'old', userId: 'Ua', source: 'recurring', ref: 'Rr1202610', entries: [] });
    expect(runRecurringIncome(deps)).toBe(0);
    expect(pushes).toHaveLength(0);
    expect(rows[0].lastPosted).toBe('2026-10');
  });
});
