// Pure webhook handling: no Apps Script globals here, so it runs under vitest.
// Everything with side effects comes in through `WebhookDeps`.
import { formatEntries, HELP_TEXT, NOT_UNDERSTOOD_TEXT, SYSTEM_ERROR_TEXT } from './format';
import {
  bangkokDate,
  parseByRule,
  type Entry,
  type ParseResult,
  type VoiceIntent,
  type VoiceResult,
} from './parse';
import { formatSummary, rangeFor, type Period } from './summary';

type QuickReplyItem = {
  type: 'action';
  action: { type: 'postback'; label: string; data: string; displayText: string };
};

export type LineMessage = { type: 'text'; text: string; quickReply?: { items: QuickReplyItem[] } };

export interface LineEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { id: string; type: string; text?: string; duration?: number };
  postback?: { data: string };
}

export interface Pending {
  id: string;
  entries: Entry[];
  rawText: string;
  source: string;
}

export interface WebhookDeps {
  webhookToken: string;
  isAllowedUser(userId: string): boolean;
  /** Returns false when this event id was already handled (LINE redelivery). */
  markProcessed(eventId: string): boolean;
  reply(replyToken: string, messages: LineMessage[]): void;
  log(level: 'INFO' | 'WARN' | 'ERROR', message: string, detail?: string): void;
  now(): Date;
  newId(): string;
  /** LLM parse; throws when the LLM is unavailable. */
  parse(text: string, today: string): ParseResult;
  /** Downloads and interprets a voice message; throws when that fails. */
  parseVoice(messageId: string, today: string): VoiceResult;
  ledger: {
    add(id: string, entries: Entry[], meta: { userId: string; rawText: string; source: string }): void;
    cancel(userId: string, id?: string): Entry[];
    list(userId: string, from: string, to: string): Entry[];
  };
  pending: {
    put(userId: string, pending: Pending): void;
    take(userId: string, id: string): Pending | null;
  };
}

export type WebhookResult = 'ok' | 'forbidden' | 'bad_request';

export function handleWebhook(rawBody: string, key: string | undefined, deps: WebhookDeps): WebhookResult {
  if (!deps.webhookToken || !safeEqual(key ?? '', deps.webhookToken)) {
    // Lengths only, never the values: enough to tell "no ?key=", "wrong key" and "token not set" apart.
    const got = key ? `got ${key.length} chars` : 'no ?key= in URL';
    const expected = deps.webhookToken ? `expected ${deps.webhookToken.length} chars` : 'WEBHOOK_TOKEN not set (run setup)';
    deps.log('WARN', 'webhook rejected: bad key', `${got}; ${expected}`);
    return 'forbidden';
  }

  let events: LineEvent[];
  try {
    events = JSON.parse(rawBody).events ?? [];
  } catch {
    deps.log('WARN', 'webhook rejected: invalid JSON');
    return 'bad_request';
  }

  // LINE's "Verify" button sends an empty events array; answering ok is all it needs.
  for (const event of events) {
    try {
      handleEvent(event, deps);
    } catch (err) {
      deps.log('ERROR', 'event failed', String((err as Error)?.stack ?? err));
      tryReply(deps, event.replyToken, SYSTEM_ERROR_TEXT);
    }
  }
  return 'ok';
}

function handleEvent(event: LineEvent, deps: WebhookDeps): void {
  if (event.webhookEventId && !deps.markProcessed(event.webhookEventId)) return;

  // Personal ledger: 1:1 chats only, groups and rooms are ignored.
  const userId = event.source?.type === 'user' ? event.source.userId : undefined;
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;
  if (event.type !== 'message' && event.type !== 'follow' && event.type !== 'postback') return;

  if (!deps.isAllowedUser(userId)) {
    deps.log('INFO', 'message from user not in whitelist', userId);
    deps.reply(replyToken, [text(notAllowedText(userId))]);
    return;
  }

  const ctx: Ctx = { deps, userId, replyToken };
  if (event.type === 'follow') return say(ctx, `สวัสดี 👋\n${HELP_TEXT}`);
  if (event.type === 'postback') return handlePostback(ctx, event.postback?.data ?? '');

  const message = event.message;
  if (message?.type === 'text') return handleText(ctx, message.text ?? '');
  if (message?.type === 'audio') return handleVoice(ctx, message.id, message.duration ?? 0);
  say(ctx, 'ตอนนี้รองรับเฉพาะข้อความและเสียงนะ');
}

// Keeps Gemini cost and Apps Script run time bounded; a ledger entry never needs a long clip.
const MAX_VOICE_MS = 60_000;

const VOICE_SUMMARY: Partial<Record<VoiceIntent, Period>> = {
  summary_today: 'today',
  summary_this_month: 'thisMonth',
  summary_last_month: 'lastMonth',
};

function handleVoice(ctx: Ctx, messageId: string, durationMs: number): void {
  if (durationMs > MAX_VOICE_MS) return say(ctx, '🎤 ข้อความเสียงยาวเกินไป ขอไม่เกิน 1 นาทีนะ');

  const today = bangkokDate(ctx.deps.now());
  let voice: VoiceResult;
  try {
    voice = ctx.deps.parseVoice(messageId, today);
  } catch (err) {
    ctx.deps.log('ERROR', 'voice parse failed', String((err as Error)?.message ?? err));
    return say(ctx, '🎤 ฟังเสียงไม่สำเร็จ ยังไม่ได้บันทึกนะ ลองใหม่หรือพิมพ์แทนได้เลย');
  }

  const heard = `🎤 "${voice.transcript}"`;
  const period = VOICE_SUMMARY[voice.intent];
  if (period) return summarize(ctx, period, today);
  if (voice.intent === 'help') return say(ctx, HELP_TEXT);
  // A misheard "cancel" shouldn't silently remove data, so voice only offers the button.
  if (voice.intent === 'cancel') {
    return ctx.deps.reply(ctx.replyToken, [
      text(`${heard}\nต้องการยกเลิกรายการล่าสุดใช่ไหม?`, [
        postback('↩️ ยกเลิกล่าสุด', 'a=cancel', 'ยกเลิกรายการล่าสุด'),
      ]),
    ]);
  }
  if (voice.result.kind === 'not_transaction') return say(ctx, `${heard}\n${NOT_UNDERSTOOD_TEXT}`);

  // Speech can be misheard, so voice entries are always confirmed before saving.
  askToConfirm(
    ctx,
    { id: ctx.deps.newId(), entries: voice.result.entries, rawText: voice.transcript, source: 'voice' },
    heard,
  );
}

function summarize(ctx: Ctx, period: Period, today: string): void {
  const { from, to } = rangeFor(period, today);
  say(ctx, formatSummary(period, ctx.deps.ledger.list(ctx.userId, from, to), today));
}

const SUMMARY_COMMANDS: Record<string, Period | undefined> = {
  สรุปวันนี้: 'today',
  สรุป: 'thisMonth',
  สรุปเดือนนี้: 'thisMonth',
  สรุปเดือนที่แล้ว: 'lastMonth',
  สรุปเดือนก่อน: 'lastMonth',
};

interface Ctx {
  deps: WebhookDeps;
  userId: string;
  replyToken: string;
}

function handleText(ctx: Ctx, raw: string): void {
  const input = raw.trim();
  if (/^(ยกเลิก|undo)$/i.test(input)) return cancel(ctx);
  if (/^(ช่วยเหลือ|วิธีใช้|help)$/i.test(input)) return say(ctx, HELP_TEXT);

  const today = bangkokDate(ctx.deps.now());
  const period = SUMMARY_COMMANDS[input.replace(/\s+/g, '')];
  if (period) return summarize(ctx, period, today);

  let result: ParseResult;
  try {
    result = ctx.deps.parse(input, today);
  } catch (err) {
    ctx.deps.log('ERROR', 'LLM parse failed', String((err as Error)?.message ?? err));
    const entry = parseByRule(input, today);
    if (!entry) return say(ctx, SYSTEM_ERROR_TEXT);
    return save(ctx, [entry], input, 'text-rule', '\n(AI ขัดข้อง บันทึกแบบพื้นฐาน หมวดอาจไม่ตรง)');
  }

  if (result.kind === 'not_transaction') return say(ctx, NOT_UNDERSTOOD_TEXT);
  if (result.confident) return save(ctx, result.entries, input, 'text');
  askToConfirm(ctx, { id: ctx.deps.newId(), entries: result.entries, rawText: input, source: 'text' });
}

function handlePostback(ctx: Ctx, data: string): void {
  const params = parseQuery(data);
  switch (params.a) {
    case 'confirm': {
      const pending = ctx.deps.pending.take(ctx.userId, params.id ?? '');
      if (!pending) return say(ctx, 'รายการนี้หมดเวลายืนยันแล้ว ส่งใหม่อีกครั้งนะ');
      return save(ctx, pending.entries, pending.rawText, pending.source);
    }
    case 'reject':
      ctx.deps.pending.take(ctx.userId, params.id ?? '');
      return say(ctx, 'โอเค ไม่บันทึกนะ ลองพิมพ์ใหม่ได้เลย');
    case 'cancel':
      return cancel(ctx, params.id);
  }
}

function save(ctx: Ctx, entries: Entry[], rawText: string, source: string, suffix = ''): void {
  const id = ctx.deps.newId();
  ctx.deps.ledger.add(id, entries, { userId: ctx.userId, rawText, source });
  const today = bangkokDate(ctx.deps.now());
  ctx.deps.reply(ctx.replyToken, [
    text(`✅ บันทึกแล้ว\n${formatEntries(entries, today)}${suffix}`, [
      postback('↩️ ยกเลิก', `a=cancel&id=${id}`, 'ยกเลิกรายการนี้'),
    ]),
  ]);
}

function askToConfirm(ctx: Ctx, pending: Pending, heading = ''): void {
  ctx.deps.pending.put(ctx.userId, pending);
  const today = bangkokDate(ctx.deps.now());
  const prefix = heading ? `${heading}\n` : '';
  ctx.deps.reply(ctx.replyToken, [
    text(`${prefix}ช่วยตรวจหน่อย ถูกไหม? 🧐\n${formatEntries(pending.entries, today)}`, [
      postback('✅ ถูกต้อง บันทึก', `a=confirm&id=${pending.id}`, 'ถูกต้อง'),
      postback('❌ ไม่ใช่', `a=reject&id=${pending.id}`, 'ไม่ใช่'),
    ]),
  ]);
}

function cancel(ctx: Ctx, id?: string): void {
  const cancelled = ctx.deps.ledger.cancel(ctx.userId, id);
  if (cancelled.length === 0) return say(ctx, 'ไม่พบรายการที่ยกเลิกได้');
  say(ctx, `↩️ ยกเลิกแล้ว\n${formatEntries(cancelled, bangkokDate(ctx.deps.now()))}`);
}

function say(ctx: Ctx, message: string): void {
  ctx.deps.reply(ctx.replyToken, [text(message)]);
}

function tryReply(deps: WebhookDeps, replyToken: string | undefined, message: string): void {
  if (!replyToken) return;
  try {
    deps.reply(replyToken, [text(message)]);
  } catch {
    // The reply itself may be what failed; the error is already logged.
  }
}

export function notAllowedText(userId: string): string {
  return `ขออภัย บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน\nส่งรหัสนี้ให้ผู้ดูแลเพื่อเพิ่มสิทธิ์:\n${userId}`;
}

function text(t: string, quickReplies?: QuickReplyItem[]): LineMessage {
  return quickReplies ? { type: 'text', text: t, quickReply: { items: quickReplies } } : { type: 'text', text: t };
}

function postback(label: string, data: string, displayText: string): QuickReplyItem {
  return { type: 'action', action: { type: 'postback', label, data, displayText } };
}

function parseQuery(data: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of data.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
