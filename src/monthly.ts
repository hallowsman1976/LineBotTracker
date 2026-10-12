// Month-end summary push. Pure: Apps Script specifics come in through MonthlyDeps.
import { addDays, bangkokDate, type Entry } from './parse';
import { formatSummary, rangeFor } from './summary';
import type { LineMessage } from './webhook';

export interface MonthlyDeps {
  now(): Date;
  activeUserIds(): string[];
  list(userId: string, from: string, to: string): Entry[];
  push(userId: string, messages: LineMessage[]): void;
  /** "YYYY-MM" of the last month already sent, so a re-run on the same day sends nothing. */
  getLastSentMonth(): string;
  setLastSentMonth(month: string): void;
  log(level: 'INFO' | 'WARN' | 'ERROR', message: string, detail?: string): void;
}

export function isLastDayOfMonth(date: string): boolean {
  return addDays(date, 1).endsWith('-01');
}

/**
 * Called daily by the 20:00 trigger; only acts on the last day of the month.
 * `force` sends regardless (for testing) and leaves the "already sent" marker alone.
 * Returns how many users were sent a summary.
 */
export function runMonthlySummary(deps: MonthlyDeps, force = false): number {
  const today = bangkokDate(deps.now());
  const month = today.slice(0, 7);
  if (!force && (!isLastDayOfMonth(today) || deps.getLastSentMonth() === month)) return 0;

  const { from, to } = rangeFor('thisMonth', today);
  let sent = 0;
  for (const userId of deps.activeUserIds()) {
    try {
      const summary = formatSummary('thisMonth', deps.list(userId, from, to), today);
      deps.push(userId, [{ type: 'text', text: `🗓️ สรุปสิ้นเดือน\n${summary}` }]);
      sent++;
    } catch (err) {
      deps.log('ERROR', 'monthly summary push failed', `${userId}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  if (!force) deps.setLastSentMonth(month);
  deps.log('INFO', `monthly summary sent to ${sent} user(s)`, force ? 'forced' : month);
  return sent;
}
