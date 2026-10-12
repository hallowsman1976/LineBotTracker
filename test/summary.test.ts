import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/parse';
import { formatSummary, rangeFor, thaiMonthYear } from '../src/summary';

const TODAY = '2026-10-12';
const e = (type: Entry['type'], amount: number, category: string, date = TODAY, note = ''): Entry => ({
  type, amount, category, note, date,
});

describe('rangeFor', () => {
  it('computes today, this month and last month', () => {
    expect(rangeFor('today', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(rangeFor('thisMonth', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(rangeFor('lastMonth', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('handles January and leap-year February', () => {
    expect(rangeFor('lastMonth', '2027-01-05')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(rangeFor('lastMonth', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('formatSummary', () => {
  it('uses the Thai Buddhist year', () => {
    expect(thaiMonthYear('2026-10-01')).toBe('ตุลาคม 2569');
  });

  it('says when there is nothing to show', () => {
    expect(formatSummary('today', [], TODAY)).toBe('📊 สรุปวันนี้ (12 ต.ค.)\nยังไม่มีรายการในช่วงนี้');
  });

  it('lists entries for a day', () => {
    const text = formatSummary('today', [e('expense', 60, 'อาหาร', TODAY, 'ข้าว'), e('income', 800, 'รายได้เสริม')], TODAY);
    expect(text).toContain('รายรับ +800 บาท');
    expect(text).toContain('รายจ่าย −60 บาท');
    expect(text).toContain('คงเหลือ +740 บาท');
    expect(text).toContain('• อาหาร −60 บาท (ข้าว)');
  });

  it('groups a month by category, largest first, with shares', () => {
    const text = formatSummary(
      'thisMonth',
      [e('expense', 100, 'เดินทาง'), e('expense', 250, 'อาหาร'), e('expense', 50, 'อาหาร'), e('income', 25000, 'เงินเดือน')],
      TODAY,
    );
    expect(text).toContain('📊 สรุปเดือนตุลาคม 2569');
    expect(text).toContain('รายจ่ายตามหมวด\n• อาหาร 300 (75%)\n• เดินทาง 100 (25%)');
    expect(text).toContain('รายรับตามหมวด\n• เงินเดือน 25,000 (100%)');
    expect(text).toContain('(4 รายการ)');
  });

  it('shows a negative balance', () => {
    expect(formatSummary('thisMonth', [e('expense', 1500, 'บิล/สาธารณูปโภค')], TODAY)).toContain('คงเหลือ −1,500 บาท');
  });

  it('caps a long day list', () => {
    const many = Array.from({ length: 25 }, () => e('expense', 10, 'อาหาร'));
    expect(formatSummary('today', many, TODAY)).toContain('…และอีก 5 รายการ');
  });
});
