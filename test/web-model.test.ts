import { describe, expect, it } from 'vitest';
import { formatThaiDate } from '../src/format';
import type { LedgerEntry } from '../src/parse';
import {
  groupSlips,
  categoryBreakdown,
  dayLabel,
  filterEntries,
  groupByDay,
  replaceEntry,
  shiftMonth,
  totals,
  withoutEntry,
} from '../web/src/model';

const e = (entryId: string, type: LedgerEntry['type'], amount: number, category: string, date: string): LedgerEntry => ({
  entryId, type, amount, category, note: '', date,
});

const list = [
  e('a', 'expense', 60, 'อาหาร', '2026-10-11'),
  e('b', 'income', 800, 'รายได้เสริม', '2026-10-11'),
  e('c', 'expense', 0.1, 'อาหาร', '2026-10-12'),
  e('d', 'expense', 0.2, 'เดินทาง', '2026-10-12'),
];

describe('dashboard model', () => {
  it('totals without floating point noise', () => {
    expect(totals(list)).toEqual({ income: 800, expense: 60.3, net: 739.7 });
  });

  it('breaks down one type by category, largest first', () => {
    const rows = categoryBreakdown(list, 'expense');
    expect(rows.map((r) => r.category)).toEqual(['อาหาร', 'เดินทาง']);
    expect(rows[0].amount).toBe(60.1);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
    expect(categoryBreakdown([], 'income')).toEqual([]);
  });

  it('filters by type and category', () => {
    expect(filterEntries(list, 'income', null).map((x) => x.entryId)).toEqual(['b']);
    expect(filterEntries(list, 'all', 'อาหาร').map((x) => x.entryId)).toEqual(['a', 'c']);
  });

  it('groups newest day first with the latest entry on top', () => {
    const groups = groupByDay(list);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-12', '2026-10-11']);
    expect(groups[0].entries.map((x) => x.entryId)).toEqual(['d', 'c']);
    expect(groups[1].net).toBe(740);
  });

  it('shifts months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });

  it('labels days relative to today', () => {
    expect(dayLabel('2026-10-12', '2026-10-12', formatThaiDate)).toBe('วันนี้');
    expect(dayLabel('2026-10-11', '2026-10-12', formatThaiDate)).toBe('เมื่อวาน');
    expect(dayLabel('2026-10-05', '2026-10-12', formatThaiDate)).toBe('จ. 5 ต.ค.');
  });

  it('replaces and removes entries immutably', () => {
    const edited = { ...list[0], amount: 75 };
    expect(replaceEntry(list, edited)[0].amount).toBe(75);
    expect(list[0].amount).toBe(60);
    expect(withoutEntry(list, 'a')).toHaveLength(3);
  });
});

describe('groupSlips', () => {
  const slip = (type: 'income' | 'expense', category: string, amount: number, selected = true) => ({
    entry: { type, category, amount, note: '', date: '2026-10-01' },
    selected,
  });

  it('groups by type and category, expenses first, biggest first, totals only ticked slips', () => {
    const a = slip('expense', 'อาหาร', 60);
    const b = slip('income', 'รายได้เสริม', 1500);
    const c = slip('expense', 'บิล/สาธารณูปโภค', 640);
    const d = slip('expense', 'อาหาร', 120.5, false);
    const e = slip('income', 'อื่นๆ', 100);
    const groups = groupSlips([a, b, c, d, e]);
    expect(groups.map((g) => [g.type, g.category, g.total, g.selectedCount, g.items.length])).toEqual([
      ['expense', 'บิล/สาธารณูปโภค', 640, 1, 1],
      ['expense', 'อาหาร', 60, 1, 2],
      ['income', 'รายได้เสริม', 1500, 1, 1],
      ['income', 'อื่นๆ', 100, 1, 1],
    ]);
    expect(groups[1].items).toEqual([a, d]);
  });

  it('keeps the same category apart when the type differs', () => {
    expect(groupSlips([slip('expense', 'อื่นๆ', 10), slip('income', 'อื่นๆ', 20)])).toHaveLength(2);
  });
});
