// Talks to the Apps Script API, or to an in-memory demo backend when no LIFF app is configured.
import type { ApiError, ApiResponse, MonthData } from '../../src/api';
import type { Entry, LedgerEntry } from '../../src/parse';

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiError | 'network',
    message?: string,
    readonly userId?: string,
  ) {
    super(message ?? code);
  }
}

export interface Backend {
  month(month: string): Promise<LedgerEntry[]>;
  update(entryId: string, entry: Entry): Promise<LedgerEntry>;
  remove(entryId: string): Promise<void>;
}

export class ApiBackend implements Backend {
  constructor(
    private readonly url: string,
    private readonly idToken: () => string | null,
  ) {}

  async month(month: string) {
    return (await this.call<MonthData>({ action: 'month', month })).entries;
  }

  update(entryId: string, entry: Entry) {
    return this.call<LedgerEntry>({ action: 'update', entryId, entry });
  }

  async remove(entryId: string) {
    await this.call({ action: 'delete', entryId });
  }

  private async call<T>(body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      // No Content-Type header: a text/plain "simple request" avoids a CORS preflight,
      // which Apps Script web apps can't answer.
      res = await fetch(this.url, { method: 'POST', body: JSON.stringify({ ...body, idToken: this.idToken() }) });
    } catch {
      throw new ApiFailure('network');
    }
    let json: ApiResponse<T>;
    try {
      json = await res.json();
    } catch {
      throw new ApiFailure('server_error', `HTTP ${res.status}`);
    }
    if (!json.ok) throw new ApiFailure(json.error, json.message, json.userId);
    return json.data;
  }
}

/** Fake data so the UI can be previewed without LINE (?demo=1, or before LIFF_ID is set). */
export class DemoBackend implements Backend {
  private entries: LedgerEntry[];

  constructor(today: string) {
    this.entries = demoEntries(today);
  }

  async month(month: string) {
    await delay(350);
    return this.entries.filter((e) => e.date.startsWith(month));
  }

  async update(entryId: string, entry: Entry) {
    await delay(250);
    const updated = { ...entry, entryId };
    this.entries = this.entries.map((e) => (e.entryId === entryId ? updated : e));
    return updated;
  }

  async remove(entryId: string) {
    await delay(250);
    this.entries = this.entries.filter((e) => e.entryId !== entryId);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function demoEntries(today: string): LedgerEntry[] {
  const [y, m, d] = today.split('-').map(Number);
  const day = (n: number) => `${y}-${String(m).padStart(2, '0')}-${String(Math.max(1, Math.min(d, n))).padStart(2, '0')}`;
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const rows: Omit<LedgerEntry, 'entryId'>[] = [
    { type: 'income', amount: 25000, category: 'เงินเดือน', note: 'เงินเดือน', date: day(1) },
    { type: 'expense', amount: 5500, category: 'บิล/สาธารณูปโภค', note: 'ค่าเช่าห้อง', date: day(1) },
    { type: 'expense', amount: 45, category: 'อาหาร', note: 'กาแฟ', date: day(2) },
    { type: 'expense', amount: 500, category: 'เดินทาง', note: 'เติมน้ำมัน', date: day(3) },
    { type: 'expense', amount: 389, category: 'ของใช้', note: 'ของใช้ในบ้าน', date: day(4) },
    { type: 'expense', amount: 450, category: 'อาหาร', note: 'หมูกระทะ', date: day(5) },
    { type: 'income', amount: 800, category: 'รายได้เสริม', note: 'ค่าแรง', date: day(6) },
    { type: 'expense', amount: 220, category: 'บันเทิง', note: 'ดูหนัง', date: day(8) },
    { type: 'expense', amount: 640, category: 'บิล/สาธารณูปโภค', note: 'ค่าไฟ', date: day(9) },
    { type: 'expense', amount: 350, category: 'สุขภาพ', note: 'ยา', date: day(10) },
    { type: 'expense', amount: 60, category: 'อาหาร', note: 'ข้าวมันไก่', date: day(d - 1) },
    { type: 'expense', amount: 45, category: 'อาหาร', note: 'กาแฟ', date: day(d) },
    { type: 'expense', amount: 60, category: 'อาหาร', note: 'ข้าวมันไก่', date: day(d) },
    { type: 'income', amount: 25000, category: 'เงินเดือน', note: 'เงินเดือน', date: `${prev}-01` },
    { type: 'expense', amount: 5500, category: 'บิล/สาธารณูปโภค', note: 'ค่าเช่าห้อง', date: `${prev}-01` },
    { type: 'expense', amount: 1200, category: 'อาหาร', note: '', date: `${prev}-15` },
  ];
  return rows.map((r, i) => ({ ...r, entryId: `demo${i}` }));
}
