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
