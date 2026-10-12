import { describe, expect, it } from 'vitest';
import { confirmCard } from '../src/flex';
import { buildImagePrompt, IMAGE_RESPONSE_SCHEMA } from '../src/gemini';
import { flipEntryType, normalizeImageResult } from '../src/parse';

const TODAY = '2026-10-12';
const slipRaw = {
  kind: 'slip',
  amount: 640,
  date: '2026-10-09',
  sender: 'นาย สมชาย ใ',
  receiver: 'การไฟฟ้าส่วนภูมิภาค',
  ref: '20261009-ABC 123',
  userIsReceiver: false,
  category: 'บิล/สาธารณูปโภค',
};

describe('normalizeImageResult', () => {
  it('reads an outgoing slip as an expense to the receiver', () => {
    expect(normalizeImageResult(slipRaw, TODAY)).toEqual({
      kind: 'transaction',
      source: 'slip',
      entry: { type: 'expense', amount: 640, category: 'บิล/สาธารณูปโภค', note: 'การไฟฟ้าส่วนภูมิภาค', date: '2026-10-09' },
      ref: '20261009ABC123',
      parties: { sender: 'นาย สมชาย ใ', receiver: 'การไฟฟ้าส่วนภูมิภาค' },
    });
  });

  it('reads a slip where the user is the receiver as income from the sender', () => {
    const r = normalizeImageResult({ ...slipRaw, userIsReceiver: true, category: 'รายได้เสริม' }, TODAY);
    expect(r).toMatchObject({ entry: { type: 'income', category: 'รายได้เสริม', note: 'นาย สมชาย ใ' } });
  });

  it('never makes a receipt income, even if the model says so', () => {
    const r = normalizeImageResult({ ...slipRaw, kind: 'receipt', userIsReceiver: true, sender: '' }, TODAY);
    expect(r).toMatchObject({ source: 'receipt', entry: { type: 'expense' } });
  });

  it('fixes a category that does not fit the type', () => {
    const r = normalizeImageResult({ ...slipRaw, userIsReceiver: true }, TODAY);
    expect(r).toMatchObject({ entry: { type: 'income', category: 'อื่นๆ' } });
  });

  it('uses today for a missing, future or very old date', () => {
    for (const date of ['', '2026-10-13', '2020-01-01', '09/10/2569']) {
      expect(normalizeImageResult({ ...slipRaw, date }, TODAY)).toMatchObject({ entry: { date: TODAY } });
    }
  });

  it('separates "not a slip" from "a slip without a readable amount"', () => {
    expect(normalizeImageResult({ ...slipRaw, kind: 'other' }, TODAY)).toEqual({ kind: 'other' });
    expect(normalizeImageResult(null, TODAY)).toEqual({ kind: 'other' });
    expect(normalizeImageResult({ ...slipRaw, amount: 0 }, TODAY)).toEqual({ kind: 'unreadable' });
  });

  it('falls back to whichever party name exists for the note', () => {
    const r = normalizeImageResult({ ...slipRaw, kind: 'receipt', receiver: '', sender: '' }, TODAY);
    expect(r).toMatchObject({ entry: { note: '' } });
  });
});

describe('flipEntryType', () => {
  const parties = { sender: 'นาย ก', receiver: 'ร้าน ข' };

  it('swaps the note between parties and resets an incompatible category', () => {
    const expense = { type: 'expense' as const, amount: 100, category: 'อาหาร', note: 'ร้าน ข', date: TODAY };
    const income = flipEntryType(expense, parties);
    expect(income).toEqual({ ...expense, type: 'income', category: 'อื่นๆ', note: 'นาย ก' });
    expect(flipEntryType(income, parties)).toEqual({ ...expense, category: 'อื่นๆ' });
  });

  it('keeps the note when there are no parties (voice/text)', () => {
    const e = { type: 'expense' as const, amount: 100, category: 'อื่นๆ', note: 'โน้ต', date: TODAY };
    expect(flipEntryType(e).note).toBe('โน้ต');
  });
});

describe('image prompt', () => {
  it("lists the user's account names, or says none were given", () => {
    expect(buildImagePrompt(TODAY, ['นาย สมชาย ใจดี', 'SOMCHAI J'])).toContain('"นาย สมชาย ใจดี", "SOMCHAI J"');
    expect(buildImagePrompt(TODAY, [])).toContain('(ไม่ได้ระบุ)');
  });

  it('requires every field so the model never omits the ref or the direction', () => {
    expect(IMAGE_RESPONSE_SCHEMA.required).toEqual(Object.keys(IMAGE_RESPONSE_SCHEMA.properties));
  });
});

describe('confirmCard', () => {
  const entry = { type: 'expense' as const, amount: 1234.5, category: 'อาหาร', note: '', date: TODAY };

  it('never emits an empty Flex text node', () => {
    const card = confirmCard({ id: 'p1', entries: [entry], rawText: '', source: 'receipt' }, TODAY);
    const texts: string[] = [];
    JSON.stringify(card, (k, v) => (k === 'text' && texts.push(v), v));
    expect(texts.every((t) => t.length > 0)).toBe(true);
    expect(texts).toContain('−1,234.50 บาท');
    expect(texts).toContain('12 ต.ค. (วันนี้)');
  });

  it('offers the flip button only for a single entry', () => {
    const data = (n: number) =>
      JSON.stringify(confirmCard({ id: 'p1', entries: Array(n).fill(entry), rawText: '', source: 'text' }, TODAY));
    expect(data(1)).toContain('a=toggle&id=p1');
    expect(data(2)).not.toContain('a=toggle');
    expect(data(7)).toContain('และอีก 2 รายการ');
  });

  it('keeps button labels within the LINE 20-character limit', () => {
    const card = JSON.stringify(confirmCard({ id: 'p1', entries: [entry], rawText: '', source: 'slip' }, TODAY));
    for (const [, label] of card.matchAll(/"label":"([^"]*)"/g)) expect(label.length).toBeLessThanOrEqual(20);
  });
});
