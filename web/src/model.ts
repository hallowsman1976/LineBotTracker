// Pure view-model helpers for the dashboard (tested in test/web-model.test.ts).
import { addDays, type LedgerEntry, type TxType } from '../../src/parse';

export interface Totals {
  income: number;
  expense: number;
  net: number;
}

export interface CategoryShare {
  category: string;
  amount: number;
  /** 0–1 share of the type's total */
  share: number;
}

export interface DayGroup {
  date: string;
  net: number;
  entries: LedgerEntry[];
}

export type TypeFilter = 'all' | TxType;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function totals(entries: LedgerEntry[]): Totals {
  let income = 0;
  let expense = 0;
  for (const e of entries) {
    if (e.type === 'income') income += e.amount;
    else expense += e.amount;
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

/** Largest first; ties keep category order stable by name. */
export function categoryBreakdown(entries: LedgerEntry[], type: TxType): CategoryShare[] {
  const sums = new Map<string, number>();
  for (const e of entries) if (e.type === type) sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount);
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount), share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

export function filterEntries(entries: LedgerEntry[], type: TypeFilter, category: string | null): LedgerEntry[] {
  return entries.filter((e) => (type === 'all' || e.type === type) && (!category || e.category === category));
}

/** Newest day first; within a day, the later-saved entry (later in the list) first. */
export function groupByDay(entries: LedgerEntry[]): DayGroup[] {
  const byDate = new Map<string, LedgerEntry[]>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, net: totals(list).net, entries: [...list].reverse() }));
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const THAI_WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

/** "วันนี้" / "เมื่อวาน" / "จ. 5 ต.ค." */
export function dayLabel(date: string, today: string, shortDate: (d: string) => string): string {
  if (date === today) return 'วันนี้';
  if (date === addDays(today, -1)) return 'เมื่อวาน';
  const weekday = THAI_WEEKDAYS_SHORT[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${weekday} ${shortDate(date)}`;
}

/** Applies an edited entry to the list (optimistic update) and returns the new list. */
export function replaceEntry(entries: LedgerEntry[], updated: LedgerEntry): LedgerEntry[] {
  return entries.map((e) => (e.entryId === updated.entryId ? updated : e));
}

export function withoutEntry(entries: LedgerEntry[], entryId: string): LedgerEntry[] {
  return entries.filter((e) => e.entryId !== entryId);
}
