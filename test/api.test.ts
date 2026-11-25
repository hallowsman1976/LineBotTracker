import { describe, expect, it } from 'vitest';
import { handleApi, InvalidTokenError, type ApiDeps } from '../src/api';
import { validateEntryInput, type Entry, type LedgerEntry } from '../src/parse';
import { monthRange } from '../src/summary';
import { memRecurring } from './memRecurring';

const TODAY = '2026-10-12';
const NOW = new Date('2026-10-12T05:00:00Z');
const ME = 'Ume';

function setup(overrides: Partial<ApiDeps> = {}) {
  const rows: (LedgerEntry & { userId: string; status: string; ref?: string; id?: string; rawText?: string })[] = [
    { entryId: 'e1', userId: ME, status: 'active', type: 'expense', amount: 60, category: 'อาหาร', note: 'ข้าว', date: '2026-10-05' },
    { entryId: 'e2', userId: ME, status: 'active', type: 'income', amount: 800, category: 'รายได้เสริม', note: '', date: '2026-09-30' },
    { entryId: 'e3', userId: 'Uother', status: 'active', type: 'expense', amount: 99, category: 'อาหาร', note: '', date: '2026-10-06' },
  ];
  const logs: string[] = [];
  const recurring = memRecurring();
  const own = (userId: string, entryId: string) =>
    rows.find((r) => r.entryId === entryId && r.userId === userId && r.status === 'active');

  const deps: ApiDeps = {
    verifyIdToken: (token) => {
      if (token === 'good') return ME;
      if (token === 'stranger') return 'Ustranger';
      throw new InvalidTokenError('expired');
    },
    isAllowedUser: (id) => id === ME || id === 'Uother',
    now: () => NOW,
    ledger: {
      list: (userId, from, to) =>
        rows
          .filter((r) => r.userId === userId && r.status === 'active' && r.date >= from && r.date <= to)
          .map(({ userId: _u, status: _s, ...e }) => e),
      update: (userId, entryId, entry: Entry) => {
        const row = own(userId, entryId);
        if (!row) return false;
        Object.assign(row, entry);
        return true;
      },
      remove: (userId, entryId) => {
        const row = own(userId, entryId);
        if (!row) return false;
        row.status = 'cancelled';
        return true;
      },
      add: (id, entries, meta) => {
        for (const e of entries) {
          rows.push({ ...e, id, entryId: `n${rows.length}`, userId: meta.userId, status: 'active', source: meta.source, ref: meta.ref, rawText: meta.rawText });
        }
      },
      hasRef: (userId, ref) => rows.some((r) => r.userId === userId && r.status === 'active' && r.ref === ref),
    },
    readSlip: () => ({ kind: 'other' }),
    recurring: recurring.store,
    newId: (() => {
      let n = 0;
      return () => `r${++n}`;
    })(),
    log: (_l, message) => logs.push(message),
    ...overrides,
  };
  const call = (body: unknown) => handleApi(typeof body === 'string' ? body : JSON.stringify(body), deps);
  return { call, rows, logs, recurring: recurring.rows };
}

const edit = { type: 'expense', amount: 75, category: 'อาหาร', note: 'ข้าวมันไก่', date: '2026-10-05' };

describe('handleApi auth', () => {
  it('rejects bad JSON and missing tokens', () => {
    const { call } = setup();
    expect(call('nope')).toMatchObject({ ok: false, error: 'bad_request' });
    expect(call({ action: 'month', month: '2026-10' })).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('maps an invalid token to unauthorized', () => {
    const { call } = setup();
    expect(call({ action: 'month', month: '2026-10', idToken: 'expired' })).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('tells a valid but non-whitelisted user their id', () => {
    const { call } = setup();
    expect(call({ action: 'month', month: '2026-10', idToken: 'stranger' })).toEqual({
      ok: false, error: 'forbidden', userId: 'Ustranger',
    });
  });

  it('turns unexpected failures into server_error and logs them', () => {
    const { call, logs } = setup({ verifyIdToken: () => { throw new Error('UrlFetch quota'); } });
    expect(call({ action: 'month', month: '2026-10', idToken: 'good' })).toEqual({ ok: false, error: 'server_error' });
    expect(logs).toEqual(['api month failed']);
  });
});

describe('handleApi actions', () => {
  it('returns only my entries for the requested month', () => {
    const { call } = setup();
    const res = call({ action: 'month', month: '2026-10', idToken: 'good' });
    expect(res).toMatchObject({ ok: true, data: { month: '2026-10' } });
    expect(res.ok && (res.data as { entries: LedgerEntry[] }).entries.map((e) => e.entryId)).toEqual(['e1']);
  });

  it('validates the month', () => {
    const { call } = setup();
    expect(call({ action: 'month', month: '2026-13', idToken: 'good' })).toMatchObject({ error: 'bad_request' });
  });

  it('updates my entry', () => {
    const { call, rows } = setup();
    expect(call({ action: 'update', idToken: 'good', entryId: 'e1', entry: edit })).toEqual({
      ok: true, data: { ...edit, entryId: 'e1' },
    });
    expect(rows[0]).toMatchObject({ amount: 75, note: 'ข้าวมันไก่' });
  });

  it("cannot touch someone else's entry", () => {
    const { call, rows } = setup();
    expect(call({ action: 'update', idToken: 'good', entryId: 'e3', entry: edit })).toEqual({ ok: false, error: 'not_found' });
    expect(call({ action: 'delete', idToken: 'good', entryId: 'e3' })).toEqual({ ok: false, error: 'not_found' });
    expect(rows[2]).toMatchObject({ amount: 99, status: 'active' });
  });

  it('returns the validation message for a bad edit', () => {
    const { call } = setup();
    expect(call({ action: 'update', idToken: 'good', entryId: 'e1', entry: { ...edit, amount: -5 } })).toEqual({
      ok: false, error: 'bad_request', message: 'จำนวนเงินต้องมากกว่า 0',
    });
  });

  it('deletes my entry once', () => {
    const { call } = setup();
    expect(call({ action: 'delete', idToken: 'good', entryId: 'e1' })).toEqual({ ok: true, data: { entryId: 'e1' } });
    expect(call({ action: 'delete', idToken: 'good', entryId: 'e1' })).toEqual({ ok: false, error: 'not_found' });
  });

  it('rejects unknown actions', () => {
    const { call } = setup();
    expect(call({ action: 'drop_table', idToken: 'good' })).toMatchObject({ error: 'bad_request' });
  });
});

describe('validateEntryInput', () => {
  it('accepts a valid entry and rounds the amount', () => {
    expect(validateEntryInput({ ...edit, amount: '75.555', note: '  ข้าว  ' }, TODAY)).toEqual({
      ...edit, amount: 75.56, note: 'ข้าว',
    });
  });

  it.each([
    [{ type: 'gift' }, 'ประเภทไม่ถูกต้อง'],
    [{ amount: 0 }, 'จำนวนเงินต้องมากกว่า 0'],
    [{ amount: 'abc' }, 'จำนวนเงินต้องมากกว่า 0'],
    [{ amount: 1e9 }, 'จำนวนเงินมากเกินไป'],
    [{ category: 'เงินเดือน' }, 'หมวดไม่ถูกต้อง'],
    [{ date: '12/10/2026' }, 'วันที่ไม่ถูกต้อง'],
    [{ date: '2026-10-13' }, 'วันที่ต้องไม่เกินวันนี้'],
    [{ note: 'x'.repeat(101) }, 'โน้ตยาวเกิน 100 ตัวอักษร'],
  ])('rejects %j', (patch, message) => {
    expect(validateEntryInput({ ...edit, ...patch }, TODAY)).toBe(message);
  });
});

describe('monthRange', () => {
  it('covers whole months including leap February and December', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('rejects malformed months', () => {
    for (const m of ['2026-1', '2026-00', '2026-13', 'oct', '']) expect(monthRange(m)).toBeNull();
  });
});

describe('handleApi recurring income', () => {
  const rule = { amount: 30000, category: 'เงินเดือน', note: 'บริษัท', day: 25 };

  it('creates, lists, edits and deletes my rule', () => {
    const { call, recurring } = setup();
    expect(call({ action: 'recurringSave', idToken: 'good', rule })).toEqual({
      ok: true, data: { ...rule, id: 'r1', lastPosted: '' },
    });
    expect(call({ action: 'recurring', idToken: 'good' })).toEqual({
      ok: true, data: { rules: [{ ...rule, id: 'r1', lastPosted: '' }] },
    });
    // Moving the day before today marks this month as done instead of recording it late.
    expect(call({ action: 'recurringSave', idToken: 'good', id: 'r1', rule: { ...rule, day: 5 } })).toMatchObject({
      ok: true, data: { day: 5, lastPosted: '2026-10' },
    });
    expect(call({ action: 'recurringDelete', idToken: 'good', id: 'r1' })).toEqual({ ok: true, data: { id: 'r1' } });
    expect(recurring).toHaveLength(0);
  });

  it('validates and scopes rules to the user', () => {
    const { call } = setup();
    expect(call({ action: 'recurringSave', idToken: 'good', rule: { ...rule, day: 32 } })).toEqual({
      ok: false, error: 'bad_request', message: 'วันที่ต้องเป็น 1–31',
    });
    expect(call({ action: 'recurringSave', idToken: 'good', id: 'nope', rule })).toEqual({ ok: false, error: 'not_found' });
    expect(call({ action: 'recurringDelete', idToken: 'good', id: 'nope' })).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('handleApi slips from the gallery', () => {
  const slip = {
    kind: 'transaction' as const,
    source: 'slip' as const,
    entry: { type: 'expense' as const, amount: 640, category: 'บิล/สาธารณูปโภค', note: 'การไฟฟ้า', date: '2026-10-10' },
    ref: 'ABC123',
    parties: { sender: 'ฉัน', receiver: 'การไฟฟ้า' },
  };

  it('reads a photo and flags a slip that is already saved', () => {
    const seen: string[] = [];
    const { call, rows } = setup({
      readSlip: (image, userId, today) => {
        seen.push(`${image}|${userId}|${today}`);
        return slip;
      },
    });
    expect(call({ action: 'slipRead', idToken: 'good', image: 'aGVsbG8=' })).toEqual({
      ok: true,
      data: { status: 'ok', source: 'slip', entry: slip.entry, ref: 'ABC123', parties: slip.parties, duplicate: false },
    });
    expect(seen).toEqual([`aGVsbG8=|${ME}|${TODAY}`]);

    rows.push({ entryId: 'old', userId: ME, status: 'active', ref: 'ABC123', ...slip.entry });
    expect(call({ action: 'slipRead', idToken: 'good', image: 'aGVsbG8=' })).toMatchObject({ ok: true, data: { duplicate: true } });
  });

  it('passes through photos that are not slips and reports Gemini failures', () => {
    expect(setup().call({ action: 'slipRead', idToken: 'good', image: 'aGVsbG8=' })).toEqual({ ok: true, data: { status: 'other' } });
    const { call, logs } = setup({
      readSlip: () => {
        throw new Error('Gemini 503');
      },
    });
    expect(call({ action: 'slipRead', idToken: 'good', image: 'aGVsbG8=' })).toMatchObject({ ok: false, error: 'server_error' });
    expect(logs).toContain('dashboard slip read failed');
    expect(call({ action: 'slipRead', idToken: 'good', image: 'not base64!' })).toMatchObject({ ok: false, error: 'bad_request' });
  });

  it('saves reviewed slips with the chosen category, each under its own id, skipping duplicates', () => {
    const { call, rows } = setup();
    rows.push({ entryId: 'old', userId: ME, status: 'active', ref: 'OLD1', ...slip.entry });
    const items = [
      { entry: { ...slip.entry, category: 'ของใช้' }, source: 'slip', ref: 'NEW1', parties: slip.parties },
      { entry: { ...slip.entry, type: 'income', category: 'รายได้เสริม' }, source: 'slip', ref: 'NEW2' },
      { entry: slip.entry, source: 'receipt', ref: 'NEW1' }, // same slip picked twice
      { entry: slip.entry, source: 'slip', ref: 'OLD1' },
      { entry: slip.entry, source: 'receipt' }, // no ref: never treated as a duplicate
    ];
    expect(call({ action: 'slipSave', idToken: 'good', items })).toEqual({
      ok: true, data: { saved: 3, duplicates: ['NEW1', 'OLD1'] },
    });
    const added = rows.filter((r) => r.entryId.startsWith('n'));
    expect(added.map((r) => [r.category, r.type, r.ref, r.source])).toEqual([
      ['ของใช้', 'expense', 'NEW1', 'slip'],
      ['รายได้เสริม', 'income', 'NEW2', 'slip'],
      ['บิล/สาธารณูปโภค', 'expense', undefined, 'receipt'],
    ]);
    expect(new Set(added.map((r) => r.id)).size).toBe(3);
    expect(added[0].rawText).toBe('ฉัน → การไฟฟ้า');
  });

  it('rejects the whole batch when any item is invalid', () => {
    const { call, rows } = setup();
    const before = rows.length;
    const items = [
      { entry: slip.entry, source: 'slip', ref: 'A1' },
      { entry: { ...slip.entry, category: 'เงินเดือน' }, source: 'slip', ref: 'A2' },
    ];
    expect(call({ action: 'slipSave', idToken: 'good', items })).toEqual({ ok: false, error: 'bad_request', message: 'หมวดไม่ถูกต้อง' });
    expect(call({ action: 'slipSave', idToken: 'good', items: [{ entry: slip.entry, source: 'text' }] })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(call({ action: 'slipSave', idToken: 'good', items: [] })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(rows.length).toBe(before);
  });
});
