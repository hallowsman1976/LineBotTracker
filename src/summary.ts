// Pure summary: date ranges and the reply text for "สรุป..." commands and the month-end push.
import { formatBaht, formatEntry, formatThaiDate } from './format';
import { addDays, type Entry } from './parse';

export type Period = 'today' | 'thisMonth' | 'lastMonth';

export interface Range {
  from: string;
  to: string;
}

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const MAX_LISTED_ENTRIES = 20;

export function rangeFor(period: Period, today: string): Range {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (period === 'today') return { from: today, to: today };
  if (period === 'thisMonth') return { from: monthStart, to: today };
  const lastMonthEnd = addDays(monthStart, -1);
  return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
}

/** "2026-10" → 1st to last day of that month; null if the string isn't a valid month. */
export function monthRange(month: string): Range | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: addDays(`${nextMonth}-01`, -1) };
}

export function inRange(entry: Entry, range: Range): boolean {
  return entry.date >= range.from && entry.date <= range.to;
}

/** "ตุลาคม 2569" — Thai Buddhist year */
export function thaiMonthYear(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return `${THAI_MONTHS_FULL[m - 1]} ${y + 543}`;
}

export function formatSummary(period: Period, entries: Entry[], today: string): string {
  const range = rangeFor(period, today);
  const title =
    period === 'today'
      ? `📊 สรุปวันนี้ (${formatThaiDate(today)})`
      : `📊 สรุปเดือน${thaiMonthYear(range.from)}`;

  if (entries.length === 0) return `${title}\nยังไม่มีรายการในช่วงนี้`;

  const income = sum(entries.filter((e) => e.type === 'income'));
  const expense = sum(entries.filter((e) => e.type === 'expense'));
  const net = income - expense;
  const lines = [
    title,
    `รายรับ +${formatBaht(income)} บาท`,
    `รายจ่าย −${formatBaht(expense)} บาท`,
    `คงเหลือ ${net < 0 ? '−' : '+'}${formatBaht(Math.abs(net))} บาท`,
  ];

  if (period === 'today') {
    lines.push('', ...entries.slice(0, MAX_LISTED_ENTRIES).map((e) => formatEntry(e, today)));
    if (entries.length > MAX_LISTED_ENTRIES) lines.push(`…และอีก ${entries.length - MAX_LISTED_ENTRIES} รายการ`);
  } else {
    lines.push(...byCategory('รายจ่ายตามหมวด', entries.filter((e) => e.type === 'expense'), expense));
    lines.push(...byCategory('รายรับตามหมวด', entries.filter((e) => e.type === 'income'), income));
    lines.push('', `(${entries.length} รายการ)`);
  }
  return lines.join('\n');
}

function byCategory(heading: string, entries: Entry[], total: number): string[] {
  if (entries.length === 0) return [];
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  const rows = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => `• ${category} ${formatBaht(amount)} (${Math.round((amount / total) * 100)}%)`);
  return ['', heading, ...rows];
}

function sum(entries: Entry[]): number {
  return Math.round(entries.reduce((acc, e) => acc + e.amount, 0) * 100) / 100;
}
