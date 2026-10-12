import { DEFAULT_GEMINI_MODEL, getProp, OPTIONAL_PROP, PROP } from './config';
import {
  addDays,
  CATEGORIES,
  normalizeLlmResult,
  normalizeVoiceResult,
  type ParseResult,
  type VoiceResult,
  VOICE_INTENTS,
} from './parse';

const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export function buildSystemPrompt(today: string): string {
  const weekday = THAI_WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
  return [
    'คุณแปลงข้อความภาษาไทยเกี่ยวกับรายรับรายจ่ายส่วนตัวเป็น JSON ตาม schema',
    `วันนี้คือ ${today} (วัน${weekday}) เขตเวลาประเทศไทย เมื่อวานคือ ${addDays(today, -1)}`,
    'กติกา:',
    '- amount เป็นตัวเลขบาท ไม่ติดลบ แปลงตัวเลขที่เขียนเป็นคำด้วย เช่น "สองร้อยห้าสิบ" = 250, "2 พัน" = 2000, "หนึ่งหมื่น" = 10000',
    '- type: expense = จ่ายออก, income = ได้รับเข้า',
    `- category รายจ่ายเลือกจาก: ${CATEGORIES.expense.join(', ')}`,
    `- category รายรับเลือกจาก: ${CATEGORIES.income.join(', ')}`,
    '- date เป็น YYYY-MM-DD ตามที่ผู้ใช้พูด ถ้าไม่ระบุใช้วันนี้',
    '- note สั้นๆ ว่าซื้อ/ได้อะไร ไม่ต้องใส่จำนวนเงิน',
    '- ข้อความเดียวมีหลายรายการได้ ให้แยกเป็นหลาย items',
    '- ถ้าไม่ใช่รายการเงิน หรือไม่มีจำนวนเงิน ให้ isTransaction=false และ items=[]',
    '- confidence=low ถ้าไม่แน่ใจจำนวนเงิน ประเภท หรือวันที่',
  ].join('\n');
}

const ALL_CATEGORIES = [...new Set([...CATEGORIES.expense, ...CATEGORIES.income])];

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isTransaction: { type: 'BOOLEAN' },
    confidence: { type: 'STRING', enum: ['high', 'low'] },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['income', 'expense'] },
          amount: { type: 'NUMBER' },
          category: { type: 'STRING', enum: ALL_CATEGORIES },
          note: { type: 'STRING' },
          date: { type: 'STRING' },
        },
        required: ['type', 'amount', 'category', 'note', 'date'],
      },
    },
  },
  required: ['isTransaction', 'confidence', 'items'],
};

export const VOICE_RESPONSE_SCHEMA = {
  ...RESPONSE_SCHEMA,
  properties: {
    transcript: { type: 'STRING' },
    intent: { type: 'STRING', enum: [...VOICE_INTENTS] },
    ...RESPONSE_SCHEMA.properties,
  },
  required: ['transcript', 'intent', ...RESPONSE_SCHEMA.required],
};

export function buildVoicePrompt(today: string): string {
  return [
    buildSystemPrompt(today),
    '',
    'ข้อมูลที่ได้รับเป็นไฟล์เสียงภาษาไทย:',
    '- transcript = ถอดเสียงตามที่พูดจริง',
    '- intent: record = จดรายการเงิน, summary_today = ขอสรุปวันนี้, summary_this_month = ขอสรุปเดือนนี้,',
    '  summary_last_month = ขอสรุปเดือนที่แล้ว, cancel = ขอยกเลิก/ลบรายการล่าสุด, help = ถามวิธีใช้, other = อย่างอื่น',
    '- ถ้า intent ไม่ใช่ record ให้ isTransaction=false และ items=[]',
    '- เสียงไม่ชัดหรือได้ยินตัวเลขไม่แน่ใจ ให้ confidence=low',
  ].join('\n');
}

/** Parses one text message with Gemini. Throws on any API or format failure so the caller can fall back. */
export function parseWithGemini(text: string, today: string): ParseResult {
  const raw = callGemini(buildSystemPrompt(today), [{ text }], RESPONSE_SCHEMA);
  return normalizeLlmResult(raw, today);
}

/** Transcribes and interprets a voice message (m4a from LINE) in one call. Throws on failure. */
export function parseVoiceWithGemini(audioBase64: string, today: string): VoiceResult {
  const raw = callGemini(
    buildVoicePrompt(today),
    [{ inlineData: { mimeType: 'audio/m4a', data: audioBase64 } }],
    VOICE_RESPONSE_SCHEMA,
  );
  return normalizeVoiceResult(raw, today);
}

function callGemini(systemPrompt: string, parts: unknown[], schema: unknown): unknown {
  const model = getProp(OPTIONAL_PROP.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
  const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': getProp(PROP.GEMINI_API_KEY) },
    payload: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error(`Gemini ${res.getResponseCode()}: ${res.getContentText().slice(0, 500)}`);
  }
  return JSON.parse(extractText(JSON.parse(res.getContentText())));
}

export function extractText(response: unknown): string {
  const parts = (response as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })
    ?.candidates?.[0]?.content?.parts;
  const text = parts?.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(response).slice(0, 500)}`);
  return text;
}
