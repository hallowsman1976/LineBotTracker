import { describe, expect, it } from 'vitest';
import { isLastDayOfMonth, runMonthlySummary, type MonthlyDeps } from '../src/monthly';
import type { Entry } from '../src/parse';
import type { LineMessage } from '../src/webhook';

// 20:00 Bangkok = 13:00 UTC
const at = (date: string) => new Date(`${date}T13:00:00Z`);

function setup(now: Date, overrides: Partial<MonthlyDeps> = {}) {
  const pushes: { to: string; messages: LineMessage[] }[] = [];
  const logs: string[] = [];
  let lastSent = '';
  const entries: Record<string, Entry[]> = {
    Ua: [{ type: 'expense', amount: 120, category: 'อาหาร', note: '', date: '2026-10-05' }],
    Ub: [],
  };
  const deps: MonthlyDeps = {
    now: () => now,
    activeUserIds: () => ['Ua', 'Ub'],
    list: (userId, from, to) => (entries[userId] ?? []).filter((e) => e.date >= from && e.date <= to),
    push: (to, messages) => pushes.push({ to, messages }),
    getLastSentMonth: () => lastSent,
    setLastSentMonth: (m) => { lastSent = m; },
    log: (_l, message) => logs.push(message),
    ...overrides,
  };
  return { deps, pushes, logs, lastSent: () => lastSent };
}

describe('isLastDayOfMonth', () => {
  it('handles 30/31-day months and February', () => {
    expect(isLastDayOfMonth('2026-10-31')).toBe(true);
    expect(isLastDayOfMonth('2026-10-30')).toBe(false);
    expect(isLastDayOfMonth('2026-09-30')).toBe(true);
    expect(isLastDayOfMonth('2026-02-28')).toBe(true);
    expect(isLastDayOfMonth('2028-02-28')).toBe(false);
    expect(isLastDayOfMonth('2028-02-29')).toBe(true);
  });
});

describe('runMonthlySummary', () => {
  it('does nothing on other days', () => {
    const { deps, pushes } = setup(at('2026-10-30'));
    expect(runMonthlySummary(deps)).toBe(0);
    expect(pushes).toHaveLength(0);
  });

  it('pushes the whole month to every active user on the last day', () => {
    const { deps, pushes, lastSent } = setup(at('2026-10-31'));
    expect(runMonthlySummary(deps)).toBe(2);
    expect(pushes.map((p) => p.to)).toEqual(['Ua', 'Ub']);
    expect(pushes[0].messages[0].text).toContain('🗓️ สรุปสิ้นเดือน\n📊 สรุปเดือนตุลาคม 2569');
    expect(pushes[0].messages[0].text).toContain('รายจ่าย −120 บาท');
    expect(pushes[1].messages[0].text).toContain('ยังไม่มีรายการ');
    expect(lastSent()).toBe('2026-10');
  });

  it('uses the Bangkok date, not UTC', () => {
    // 2026-10-31 01:00 Bangkok is still 2026-10-30 in UTC
    const { deps } = setup(new Date('2026-10-30T18:00:00Z'));
    expect(runMonthlySummary(deps)).toBe(2);
  });

  it('does not send twice in the same month', () => {
    const { deps, pushes } = setup(at('2026-10-31'));
    runMonthlySummary(deps);
    runMonthlySummary(deps);
    expect(pushes).toHaveLength(2);
  });

  it('keeps going when one push fails', () => {
    const { deps, logs } = setup(at('2026-10-31'), {
      push: (to) => { if (to === 'Ua') throw new Error('LINE 400'); },
    });
    expect(runMonthlySummary(deps)).toBe(1);
    expect(logs).toContain('monthly summary push failed');
  });

  it('force sends any day and does not mark the month as sent', () => {
    const { deps, pushes, lastSent } = setup(at('2026-10-12'));
    expect(runMonthlySummary(deps, true)).toBe(2);
    expect(pushes).toHaveLength(2);
    expect(lastSent()).toBe('');
  });
});
