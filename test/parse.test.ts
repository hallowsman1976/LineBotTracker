import { describe, expect, it } from 'vitest';
import { formatBaht, formatEntry } from '../src/format';
import {
  buildSystemPrompt,
  extractText,
  fetchWithFallback,
  RESPONSE_SCHEMA,
  VOICE_RESPONSE_SCHEMA,
} from '../src/gemini';
import { addDays, bangkokDate, normalizeLlmResult, normalizeVoiceResult, parseByRule } from '../src/parse';

const TODAY = '2026-10-12';

describe('bangkok dates', () => {
  it('rolls over at midnight Bangkok, not UTC', () => {
    expect(bangkokDate(new Date('2026-10-11T16:59:00Z'))).toBe('2026-10-11');
    expect(bangkokDate(new Date('2026-10-11T17:00:00Z'))).toBe('2026-10-12');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('normalizeLlmResult', () => {
  const item = { type: 'expense', amount: 60, category: 'อาหาร', note: 'ข้าวมันไก่', date: TODAY };

  it('accepts a well-formed confident result', () => {
    expect(normalizeLlmResult({ isTransaction: true, confidence: 'high', items: [item] }, TODAY)).toEqual({
      kind: 'transactions',
      entries: [item],
      confident: true,
    });
  });

  it('treats isTransaction=false or no valid items as not a transaction', () => {
    expect(normalizeLlmResult({ isTransaction: false, confidence: 'high', items: [] }, TODAY).kind).toBe('not_transaction');
    expect(normalizeLlmResult({ isTransaction: true, confidence: 'high', items: [{ ...item, amount: 0 }] }, TODAY).kind).toBe(
      'not_transaction',
    );
    expect(normalizeLlmResult(null, TODAY).kind).toBe('not_transaction');
  });

  it('drops invalid items and lowers confidence', () => {
    const result = normalizeLlmResult(
      { isTransaction: true, confidence: 'high', items: [item, { ...item, amount: 'lots' }] },
      TODAY,
    );
    expect(result).toMatchObject({ kind: 'transactions', confident: false });
    if (result.kind === 'transactions') expect(result.entries).toHaveLength(1);
  });

  it('maps an unknown or wrong-type category to อื่นๆ', () => {
    const result = normalizeLlmResult(
      { isTransaction: true, confidence: 'high', items: [{ ...item, type: 'income', category: 'อาหาร' }] },
      TODAY,
    );
    expect(result.kind === 'transactions' && result.entries[0].category).toBe('อื่นๆ');
  });

  it('replaces a future or malformed date with today and lowers confidence', () => {
    for (const date of ['2026-10-13', 'yesterday', '2020-01-01']) {
      const result = normalizeLlmResult({ isTransaction: true, confidence: 'high', items: [{ ...item, date }] }, TODAY);
      expect(result).toMatchObject({ kind: 'transactions', confident: false });
      expect(result.kind === 'transactions' && result.entries[0].date).toBe(TODAY);
    }
  });

  it('keeps a past date such as yesterday', () => {
    const result = normalizeLlmResult(
      { isTransaction: true, confidence: 'high', items: [{ ...item, date: '2026-10-11' }] },
      TODAY,
    );
    expect(result).toMatchObject({ confident: true, entries: [{ date: '2026-10-11' }] });
  });
});

describe('normalizeVoiceResult', () => {
  const item = { type: 'expense', amount: 500, category: 'เดินทาง', note: 'น้ำมัน', date: '2026-10-11' };

  it('keeps transcript and parses items for a record intent', () => {
    const v = normalizeVoiceResult(
      { transcript: ' เมื่อวานเติมน้ำมันห้าร้อย ', intent: 'record', isTransaction: true, confidence: 'high', items: [item] },
      TODAY,
    );
    expect(v.transcript).toBe('เมื่อวานเติมน้ำมันห้าร้อย');
    expect(v.result).toEqual({ kind: 'transactions', entries: [item], confident: true });
  });

  it('ignores items unless the intent is record', () => {
    const v = normalizeVoiceResult(
      { transcript: 'สรุปวันนี้', intent: 'summary_today', isTransaction: true, confidence: 'high', items: [item] },
      TODAY,
    );
    expect(v).toEqual({ transcript: 'สรุปวันนี้', intent: 'summary_today', result: { kind: 'not_transaction' } });
  });

  it('maps an unknown intent to other', () => {
    expect(normalizeVoiceResult({ transcript: 'x', intent: 'delete_everything' }, TODAY).intent).toBe('other');
    expect(normalizeVoiceResult(null, TODAY)).toEqual({ transcript: '', intent: 'other', result: { kind: 'not_transaction' } });
  });
});

describe('parseByRule', () => {
  it('reads "<what> <amount>" as an expense', () => {
    expect(parseByRule('ข้าวมันไก่ 60', TODAY)).toEqual({
      type: 'expense', amount: 60, category: 'อื่นๆ', note: 'ข้าวมันไก่', date: TODAY,
    });
  });

  it('handles commas, decimals, "บาท" and no space', () => {
    expect(parseByRule('ค่าเช่า 5,500 บาท', TODAY)?.amount).toBe(5500);
    expect(parseByRule('กาแฟ45.50', TODAY)?.amount).toBe(45.5);
  });

  it('detects income keywords', () => {
    expect(parseByRule('เงินเดือน 25000', TODAY)).toMatchObject({ type: 'income', category: 'เงินเดือน' });
    expect(parseByRule('ได้เงินค่าแรง 800', TODAY)).toMatchObject({ type: 'income', category: 'อื่นๆ' });
  });

  it('rejects text it cannot read safely', () => {
    expect(parseByRule('สวัสดี', TODAY)).toBeNull();
    expect(parseByRule('60', TODAY)).toBeNull();
    expect(parseByRule('ข้าว 0', TODAY)).toBeNull();
    expect(parseByRule('ข้าว 60 กาแฟ 45', TODAY)).toBeNull();
  });
});

describe('format', () => {
  it('groups thousands and hides .00', () => {
    expect(formatBaht(25000)).toBe('25,000');
    expect(formatBaht(1234567.5)).toBe('1,234,567.50');
  });

  it('shows the date only when it is not today', () => {
    const e = { type: 'income' as const, amount: 800, category: 'รายได้เสริม', note: 'ค่าแรง', date: TODAY };
    expect(formatEntry(e, TODAY)).toBe('• รายได้เสริม +800 บาท (ค่าแรง)');
    expect(formatEntry({ ...e, date: '2026-10-11' }, TODAY)).toBe('• รายได้เสริม +800 บาท (ค่าแรง) · 11 ต.ค.');
  });
});

describe('fetchWithFallback', () => {
  function run(responses: Record<string, number[]>) {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const left = Object.fromEntries(Object.entries(responses).map(([m, s]) => [m, [...s]]));
    const call = () =>
      fetchWithFallback(
        Object.keys(responses),
        (model) => {
          calls.push(model);
          const status = left[model].shift() ?? 503;
          return { status, body: status === 200 ? `ok:${model}` : `{"error":${status}}` };
        },
        (ms) => sleeps.push(ms),
      );
    return { call, calls, sleeps };
  }

  it('returns the first success without retrying', () => {
    const { call, calls, sleeps } = run({ main: [200], lite: [200] });
    expect(call()).toBe('ok:main');
    expect(calls).toEqual(['main']);
    expect(sleeps).toEqual([]);
  });

  it('retries a 503 once on the same model', () => {
    const { call, calls, sleeps } = run({ main: [503, 200], lite: [200] });
    expect(call()).toBe('ok:main');
    expect(calls).toEqual(['main', 'main']);
    expect(sleeps).toEqual([800]);
  });

  it('switches to the fallback model when the main one stays overloaded', () => {
    const { call, calls } = run({ main: [503, 503], lite: [200] });
    expect(call()).toBe('ok:lite');
    expect(calls).toEqual(['main', 'main', 'lite']);
  });

  it('moves on immediately from an unknown model (404)', () => {
    const { call, calls } = run({ main: [404], lite: [200] });
    expect(call()).toBe('ok:lite');
    expect(calls).toEqual(['main', 'lite']);
  });

  it('fails fast on a non-retryable error such as a bad key', () => {
    const { call, calls } = run({ main: [403], lite: [200] });
    expect(call).toThrow('Gemini 403 (main)');
    expect(calls).toEqual(['main']);
  });

  it('reports the last error when every model fails', () => {
    const { call, calls } = run({ main: [503, 503], lite: [503, 503] });
    expect(call).toThrow('Gemini 503 (lite)');
    expect(calls).toHaveLength(4);
  });
});

describe('gemini helpers', () => {
  it('puts today and yesterday into the prompt', () => {
    const prompt = buildSystemPrompt(TODAY);
    expect(prompt).toContain('2026-10-12 (วันจันทร์)');
    expect(prompt).toContain('เมื่อวานคือ 2026-10-11');
  });

  it('voice schema adds transcript and intent on top of the text schema', () => {
    expect(VOICE_RESPONSE_SCHEMA.required).toEqual(['transcript', 'intent', 'isTransaction', 'confidence', 'items']);
    expect(VOICE_RESPONSE_SCHEMA.properties.items).toBe(RESPONSE_SCHEMA.properties.items);
  });

  it('extracts non-thought text and throws when there is none', () => {
    const res = { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"a":1}' }] } }] };
    expect(extractText(res)).toBe('{"a":1}');
    expect(() => extractText({ candidates: [] })).toThrow();
  });
});
