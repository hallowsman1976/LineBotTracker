import { describe, expect, it } from 'vitest';
import { handleApi, InvalidTokenError, type ApiDeps } from '../src/api';
import { validateEntryInput, type Entry, type LedgerEntry } from '../src/parse';
import { monthRange } from '../src/summary';

const TODAY = '2026-10-12';
const NOW = new Date('2026-10-12T05:00:00Z');
const ME = 'Ume';

function setup(overrides: Partial<ApiDeps> = {}) {
  const rows: (LedgerEntry & { userId: string; status: string })[] = [
    { entryId: 'e1', userId: ME, status: 'active', type: 'expense', amount: 60, category: 'อาหาร', note: 'ข้าว', date: '2026-10-05' },
    { entryId: 'e2', userId: ME, status: 'active', type: 'income', amount: 800, category: 'รายได้เสริม', note: '', date: '2026-09-30' },
    { entryId: 'e3', userId: 'Uother', status: 'active', type: 'expense', amount: 99, category: 'อาหาร', note: '', date: '2026-10-06' },
  ];
  const logs: string[] = [];
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
    },
    log: (_l, message) => logs.push(message),
    ...overrides,
  };
  const call = (body: unknown) => handleApi(typeof body === 'string' ? body : JSON.stringify(body), deps);
  return { call, rows, logs };
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
