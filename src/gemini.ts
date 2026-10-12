import { DEFAULT_GEMINI_FALLBACK_MODEL, DEFAULT_GEMINI_MODEL, getProp, OPTIONAL_PROP, PROP } from './config';
import {
  addDays,
  CATEGORIES,
  normalizeImageResult,
  normalizeLlmResult,
  normalizeVoiceResult,
  type ImageResult,
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

export const IMAGE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['slip', 'receipt', 'other'] },
    amount: { type: 'NUMBER' },
    date: { type: 'STRING' },
    sender: { type: 'STRING' },
    receiver: { type: 'STRING' },
    ref: { type: 'STRING' },
    userIsReceiver: { type: 'BOOLEAN' },
    category: { type: 'STRING', enum: ALL_CATEGORIES },
  },
  required: ['kind', 'amount', 'date', 'sender', 'receiver', 'ref', 'userIsReceiver', 'category'],
};

export function buildImagePrompt(today: string, accountNames: string[]): string {
  const names = accountNames.length ? accountNames.map((n) => `"${n}"`).join(', ') : '(ไม่ได้ระบุ)';
  return [
    'คุณอ่านรูปสลิปโอนเงินหรือใบเสร็จภาษาไทยแล้วตอบเป็น JSON ตาม schema',
    `วันนี้คือ ${today} เขตเวลาประเทศไทย`,
    'kind: slip = สลิปโอนเงิน/พร้อมเพย์/จ่ายบิลจากแอปธนาคารหรือ e-wallet, receipt = ใบเสร็จ/บิลร้านค้า, other = รูปอื่น',
    'กติกา:',
    '- amount = ยอดเงินที่โอนหรือยอดรวมสุทธิที่จ่าย (บาท) ถ้าอ่านไม่ออกให้เป็น 0',
    '- date = วันที่ทำรายการ YYYY-MM-DD แปลงปี พ.ศ. เป็น ค.ศ. (ลบ 543) และเดือนย่อภาษาไทยให้ถูก',
    '- sender = ชื่อผู้โอน, receiver = ชื่อผู้รับหรือชื่อร้าน (ใบเสร็จให้ sender เป็นค่าว่าง)',
    '- ref = เลขที่อ้างอิงรายการ (Ref No. / รหัสอ้างอิง / เลขที่รายการ) ถ้าไม่มีให้เป็นค่าว่าง',
    '- ห้ามใส่เลขบัญชีในช่องใดๆ',
    `- ชื่อบัญชีของผู้ใช้: ${names} — userIsReceiver = true เฉพาะเมื่อผู้รับในสลิปเป็นผู้ใช้`,
    '  (ธนาคารอาจตัดนามสกุล ย่อ หรือแสดงเป็นภาษาอังกฤษ ให้เทียบแบบยืดหยุ่น) ใบเสร็จให้เป็น false',
    `- category รายจ่ายเลือกจาก: ${CATEGORIES.expense.join(', ')} (เดาจากชื่อร้าน/ผู้รับ/บันทึกช่วยจำ)`,
    `- ถ้าผู้ใช้เป็นผู้รับ category เลือกจาก: ${CATEGORIES.income.join(', ')}`,
  ].join('\n');
}

/** Reads a slip or receipt photo (JPEG from LINE). Throws on API failure. */
export function parseImageWithGemini(imageBase64: string, today: string, accountNames: string[]): ImageResult {
  const raw = callGemini(
    buildImagePrompt(today, accountNames),
    [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }],
    IMAGE_RESPONSE_SCHEMA,
  );
  return normalizeImageResult(raw, today);
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
  const models = [
    getProp(OPTIONAL_PROP.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL,
    getProp(OPTIONAL_PROP.GEMINI_FALLBACK_MODEL) || DEFAULT_GEMINI_FALLBACK_MODEL,
  ];
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  });
  const body = fetchWithFallback(
    models,
    (model) => {
      const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': getProp(PROP.GEMINI_API_KEY) },
        payload,
        muteHttpExceptions: true,
      });
      return { status: res.getResponseCode(), body: res.getContentText() };
    },
    (ms) => Utilities.sleep(ms),
  );
  return JSON.parse(extractText(JSON.parse(body)));
}

// Overloaded / rate-limited / transient server errors; worth retrying or switching model.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
// Short on purpose: a LINE reply has to go out while the user is waiting.
const RETRY_DELAYS_MS = [800];

/**
 * Tries each model in order, retrying transient errors briefly before moving to the next.
 * Non-retryable errors (bad key, bad request) fail immediately since another model won't help.
 */
export function fetchWithFallback(
  models: string[],
  request: (model: string) => { status: number; body: string },
  sleep: (ms: number) => void,
): string {
  let lastError = '';
  for (const model of [...new Set(models.filter(Boolean))]) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) sleep(RETRY_DELAYS_MS[attempt - 1]);
      const { status, body } = request(model);
      if (status === 200) return body;
      lastError = `Gemini ${status} (${model}): ${body.slice(0, 500)}`;
      if (status === 404) break; // unknown model name: try the next model
      if (!RETRYABLE.has(status)) throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

export function extractText(response: unknown): string {
  const parts = (response as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })
    ?.candidates?.[0]?.content?.parts;
  const text = parts?.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(response).slice(0, 500)}`);
  return text;
}
