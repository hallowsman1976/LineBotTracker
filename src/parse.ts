// Pure parsing helpers: validate LLM output, rule-based fallback, Bangkok dates.

export type TxType = 'income' | 'expense';

export interface Entry {
  type: TxType;
  amount: number;
  category: string;
  note: string;
  /** YYYY-MM-DD in Bangkok time */
  date: string;
}

/** A saved entry; `entryId` identifies one sheet row (several can share a message `id`). */
export interface LedgerEntry extends Entry {
  entryId: string;
  /** How it was recorded: text, text-rule, voice, slip, receipt */
  source?: string;
}

export type ImageSource = 'slip' | 'receipt';

/** Both parties on a slip, so the note can follow when the user flips income/expense. */
export interface SlipParties {
  sender: string;
  receiver: string;
}

export type ImageResult =
  | { kind: 'transaction'; source: ImageSource; entry: Entry; ref: string; parties: SlipParties }
  | { kind: 'other' }
  | { kind: 'unreadable' };

export type ParseResult =
  | { kind: 'transactions'; entries: Entry[]; confident: boolean }
  | { kind: 'not_transaction' };

export const VOICE_INTENTS = [
  'record',
  'summary_today',
  'summary_this_month',
  'summary_last_month',
  'cancel',
  'help',
  'other',
] as const;

export type VoiceIntent = (typeof VOICE_INTENTS)[number];

export interface VoiceResult {
  transcript: string;
  intent: VoiceIntent;
  /** Only meaningful when intent is "record". */
  result: ParseResult;
}

export const CATEGORIES: Record<TxType, readonly string[]> = {
  expense: ['อาหาร', 'เดินทาง', 'ของใช้', 'บิล/สาธารณูปโภค', 'บันเทิง', 'สุขภาพ', 'อื่นๆ'],
  income: ['เงินเดือน', 'รายได้เสริม', 'อื่นๆ'],
};

export const OTHER = 'อื่นๆ';
const MAX_AMOUNT = 10_000_000;
const MAX_PAST_DAYS = 366;

// Thailand has no DST, so a fixed +7h offset is exact.
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export function bangkokDate(now: Date): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Validates the JSON the LLM returned. Anything suspicious lowers confidence instead of being trusted. */
export function normalizeLlmResult(raw: unknown, today: string): ParseResult {
  const obj = (raw ?? {}) as { isTransaction?: unknown; confidence?: unknown; items?: unknown };
  if (obj.isTransaction !== true || !Array.isArray(obj.items)) return { kind: 'not_transaction' };

  let confident = obj.confidence === 'high';
  const entries: Entry[] = [];
  const earliest = addDays(today, -MAX_PAST_DAYS);

  for (const item of obj.items as Record<string, unknown>[]) {
    const type = item?.type;
    const amount = Number(item?.amount);
    if ((type !== 'income' && type !== 'expense') || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      confident = false;
      continue;
    }

    let category = typeof item.category === 'string' ? item.category : OTHER;
    if (!CATEGORIES[type].includes(category)) category = OTHER;

    let date = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : '';
    if (!date || date > today || date < earliest) {
      date = today;
      confident = false;
    }

    const note = typeof item.note === 'string' ? item.note.trim().slice(0, 100) : '';
    entries.push({ type, amount: round2(amount), category, note, date });
  }

  if (entries.length === 0) return { kind: 'not_transaction' };
  return { kind: 'transactions', entries, confident };
}

/**
 * Validates an entry edited by hand in the dashboard. Unlike LLM output nothing is guessed:
 * any invalid field is an error for the user to fix. Returns the entry or a Thai error message.
 */
export function validateEntryInput(raw: unknown, today: string): Entry | string {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const type = obj.type;
  if (type !== 'income' && type !== 'expense') return 'ประเภทไม่ถูกต้อง';

  const amount = Number(obj.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 'จำนวนเงินต้องมากกว่า 0';
  if (amount > MAX_AMOUNT) return 'จำนวนเงินมากเกินไป';

  const category = obj.category;
  if (typeof category !== 'string' || !CATEGORIES[type].includes(category)) return 'หมวดไม่ถูกต้อง';

  const date = obj.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return 'วันที่ไม่ถูกต้อง';
  }
  if (date > today) return 'วันที่ต้องไม่เกินวันนี้';

  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (note.length > 100) return 'โน้ตยาวเกิน 100 ตัวอักษร';

  return { type, amount: round2(amount), category, note, date };
}

/**
 * Validates what Gemini read from a slip or receipt image. A slip is income only when Gemini
 * matched the user as the receiver; everything else is an expense the user can flip later.
 */
export function normalizeImageResult(raw: unknown, today: string): ImageResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (obj.kind !== 'slip' && obj.kind !== 'receipt') return { kind: 'other' };

  const amount = Number(obj.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { kind: 'unreadable' };

  const text = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const parties = { sender: text(obj.sender), receiver: text(obj.receiver) };
  const type: TxType = obj.kind === 'slip' && obj.userIsReceiver === true ? 'income' : 'expense';

  const rawDate = text(obj.date, 10);
  const earliest = addDays(today, -MAX_PAST_DAYS);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today && rawDate >= earliest ? rawDate : today;

  return {
    kind: 'transaction',
    source: obj.kind,
    entry: {
      type,
      amount: round2(amount),
      category: categoryFor(type, obj.category),
      note: noteFor(type, parties),
      date,
    },
    // Reference numbers are letters and digits; anything else is OCR noise.
    ref: text(obj.ref, 60).replace(/[^0-9A-Za-z]/g, ''),
    parties,
  };
}

/** Flips an entry between income and expense, keeping category and note sensible for the new type. */
export function flipEntryType(entry: Entry, parties?: SlipParties): Entry {
  const type: TxType = entry.type === 'income' ? 'expense' : 'income';
  return {
    ...entry,
    type,
    category: categoryFor(type, entry.category),
    note: parties ? noteFor(type, parties) : entry.note,
  };
}

function categoryFor(type: TxType, category: unknown): string {
  return typeof category === 'string' && CATEGORIES[type].includes(category) ? category : OTHER;
}

/** The other party: who paid you for income, who you paid (or the shop) for an expense. */
function noteFor(type: TxType, parties: SlipParties): string {
  return (type === 'income' ? parties.sender : parties.receiver) || parties.receiver || parties.sender;
}

export function normalizeVoiceResult(raw: unknown, today: string): VoiceResult {
  const obj = (raw ?? {}) as { transcript?: unknown; intent?: unknown };
  const transcript = typeof obj.transcript === 'string' ? obj.transcript.trim().slice(0, 500) : '';
  const intent = VOICE_INTENTS.includes(obj.intent as VoiceIntent) ? (obj.intent as VoiceIntent) : 'other';
  const result: ParseResult = intent === 'record' ? normalizeLlmResult(raw, today) : { kind: 'not_transaction' };
  return { transcript, intent, result };
}

const INCOME_HINT = /เงินเดือน|รายได้|ได้เงิน|รับเงิน|โบนัส|ค่าจ้าง|ค่าแรง|ขายของ|ขายได้/;

/** Fallback when the LLM is unavailable: only the plain "<what> <amount>" shape is accepted. */
export function parseByRule(text: string, today: string): Entry | null {
  const m = text.trim().match(/^(.+?)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:บาท|บ\.?)?$/);
  if (!m) return null;
  const note = m[1].trim();
  const amount = Number(m[2].replace(/,/g, ''));
  // A digit in the description means several amounts ("ข้าว 60 กาแฟ 45"); too ambiguous without the LLM.
  if (!note || /\d/.test(note) || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;

  const type: TxType = INCOME_HINT.test(note) ? 'income' : 'expense';
  const category = type === 'income' && note.includes('เงินเดือน') ? 'เงินเดือน' : OTHER;
  return { type, amount: round2(amount), category, note: note.slice(0, 100), date: today };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
