// Talks to the Apps Script API, or to an in-memory demo backend when no LIFF app is configured.
import type { ApiError, ApiResponse, MonthData, RecurringData, SlipReadData, SlipSaveData, SlipSaveItem } from '../../src/api';
import type { Entry, LedgerEntry, SlipParties } from '../../src/parse';
import { settleLastPosted, type RecurringIncome, type RecurringInput } from '../../src/recurring';

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
  recurring(): Promise<RecurringIncome[]>;
  /** Creates a rule when id is omitted. */
  saveRecurring(id: string | undefined, rule: RecurringInput): Promise<RecurringIncome>;
  removeRecurring(id: string): Promise<void>;
  /** Reads one slip/receipt photo (base64 JPEG). */
  readSlip(imageBase64: string): Promise<SlipReadData>;
  saveSlips(items: SlipSaveItem[]): Promise<SlipSaveData>;
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

  async recurring() {
    return (await this.call<RecurringData>({ action: 'recurring' })).rules;
  }

  saveRecurring(id: string | undefined, rule: RecurringInput) {
    return this.call<RecurringIncome>({ action: 'recurringSave', id, rule });
  }

  async removeRecurring(id: string) {
    await this.call({ action: 'recurringDelete', id });
  }

  readSlip(image: string) {
    return this.call<SlipReadData>({ action: 'slipRead', image });
  }

  saveSlips(items: SlipSaveItem[]) {
    return this.call<SlipSaveData>({ action: 'slipSave', items });
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
  private rules: RecurringIncome[];
  private ids = 0;
  private reads = 0;
  private refs = new Set<string>();

  constructor(private readonly today: string) {
    this.entries = demoEntries(today);
    this.rules = [{ id: 'demo-r1', amount: 25000, category: 'เงินเดือน', note: '', day: 1, lastPosted: today.slice(0, 7) }];
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

  async recurring() {
    await delay(250);
    return this.rules;
  }

  async saveRecurring(id: string | undefined, rule: RecurringInput) {
    await delay(250);
    const existing = this.rules.find((r) => r.id === id);
    const saved = { ...rule, id: id ?? `demo-new${++this.ids}`, lastPosted: settleLastPosted(existing?.lastPosted ?? '', rule.day, this.today) };
    this.rules = existing ? this.rules.map((r) => (r.id === id ? saved : r)) : [...this.rules, saved];
    return saved;
  }

  async removeRecurring(id: string) {
    await delay(250);
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  async readSlip(): Promise<SlipReadData> {
    await delay(900 + Math.random() * 900);
    const n = this.reads++;
    const sample = DEMO_SLIPS[n % DEMO_SLIPS.length];
    if (!sample) return { status: 'other' };
    const ref = `DEMO${n % DEMO_SLIPS.length}`;
    return {
      status: 'ok',
      source: sample.source,
      entry: { ...sample.entry, date: this.today },
      ref,
      parties: sample.parties,
      duplicate: this.refs.has(ref),
    };
  }

  async saveSlips(items: SlipSaveItem[]): Promise<SlipSaveData> {
    await delay(400);
    const duplicates: string[] = [];
    let saved = 0;
    for (const item of items) {
      if (item.ref && this.refs.has(item.ref)) {
        duplicates.push(item.ref);
        continue;
      }
      if (item.ref) this.refs.add(item.ref);
      this.entries.push({ ...item.entry, entryId: `demo-slip${++this.ids}`, source: item.source });
      saved++;
    }
    return { saved, duplicates };
  }
}

type DemoSlip = Pick<SlipSaveItem, 'source'> & { parties: SlipParties; entry: Omit<Entry, 'date'> };

/** null = a photo that isn't a slip. */
const DEMO_SLIPS: (DemoSlip | null)[] = [
  {
    source: 'slip',
    entry: { type: 'expense', amount: 640, category: 'บิล/สาธารณูปโภค', note: 'การไฟฟ้าส่วนภูมิภาค' },
    parties: { sender: 'นาย สมชาย ใ', receiver: 'การไฟฟ้าส่วนภูมิภาค' },
  },
  {
    source: 'receipt',
    entry: { type: 'expense', amount: 389, category: 'ของใช้', note: 'Lotus' },
    parties: { sender: '', receiver: 'Lotus' },
  },
  {
    source: 'slip',
    entry: { type: 'expense', amount: 120, category: 'อาหาร', note: 'ร้านก๋วยเตี๋ยวเรือ' },
    parties: { sender: 'นาย สมชาย ใ', receiver: 'ร้านก๋วยเตี๋ยวเรือ' },
  },
  null,
  {
    source: 'slip',
    entry: { type: 'income', amount: 1500, category: 'รายได้เสริม', note: 'บริษัท เอบีซี' },
    parties: { sender: 'บริษัท เอบีซี', receiver: 'นาย สมชาย ใจดี' },
  },
];

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
    { type: 'expense', amount: 389, category: 'ของใช้', note: 'Lotus', date: day(4), source: 'receipt' },
    { type: 'expense', amount: 450, category: 'อาหาร', note: 'หมูกระทะ', date: day(5) },
    { type: 'income', amount: 800, category: 'รายได้เสริม', note: 'ค่าแรง', date: day(6) },
    { type: 'expense', amount: 220, category: 'บันเทิง', note: 'ดูหนัง', date: day(8) },
    { type: 'expense', amount: 640, category: 'บิล/สาธารณูปโภค', note: 'การไฟฟ้าส่วนภูมิภาค', date: day(9), source: 'slip' },
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
