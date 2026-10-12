import { describe, expect, it } from 'vitest';
import type { Entry, ImageResult, ParseResult, VoiceResult } from '../src/parse';
import { handleWebhook, type LineEvent, type LineMessage, type Pending, type WebhookDeps } from '../src/webhook';

const TOKEN = 'secret-token';
const ALLOWED = 'Uallowed';
const NOW = new Date('2026-10-12T05:00:00Z'); // 12:00 in Bangkok
const TODAY = '2026-10-12';

const food: Entry = { type: 'expense', amount: 60, category: 'อาหาร', note: 'ข้าวมันไก่', date: TODAY };

const slip: ImageResult = {
  kind: 'transaction',
  source: 'slip',
  entry: { type: 'expense', amount: 640, category: 'บิล/สาธารณูปโภค', note: 'การไฟฟ้า', date: '2026-10-09' },
  ref: '2026100912345',
  parties: { sender: 'นาย ก', receiver: 'การไฟฟ้า' },
};

function setup(
  overrides: Partial<WebhookDeps> & {
    parseResult?: ParseResult | Error;
    voiceResult?: VoiceResult | Error;
    imageResult?: ImageResult | Error;
  } = {},
) {
  const replies: { token: string; messages: LineMessage[] }[] = [];
  const saved: { id: string; entries: Entry[]; source: string; userId: string; ref?: string }[] = [];
  const cancelled: string[] = [];
  const logs: string[] = [];
  const seen = new Set<string>();
  const pendings = new Map<string, Pending>();
  let ids = 0;
  const {
    parseResult = { kind: 'transactions', entries: [food], confident: true },
    voiceResult = { transcript: 'ข้าวมันไก่หกสิบ', intent: 'record', result: { kind: 'transactions', entries: [food], confident: true } },
    imageResult = slip,
    ...rest
  } = overrides;

  const deps: WebhookDeps = {
    webhookToken: TOKEN,
    isAllowedUser: (id) => id === ALLOWED,
    markProcessed: (id) => (seen.has(id) ? false : (seen.add(id), true)),
    reply: (token, messages) => replies.push({ token, messages }),
    log: (_level, message) => logs.push(message),
    now: () => NOW,
    newId: () => `id${++ids}`,
    parse: () => {
      if (parseResult instanceof Error) throw parseResult;
      return parseResult;
    },
    parseVoice: () => {
      if (voiceResult instanceof Error) throw voiceResult;
      return voiceResult;
    },
    parseImage: () => {
      if (imageResult instanceof Error) throw imageResult;
      return imageResult;
    },
    ledger: {
      add: (id, entries, meta) =>
        saved.push({ id, entries, source: meta.source, userId: meta.userId, ...(meta.ref ? { ref: meta.ref } : {}) }),
      hasRef: (userId, ref) => saved.some((s) => s.userId === userId && s.ref === ref && !cancelled.includes(s.id)),
      cancel: (userId, id) => {
        const hit = [...saved].reverse().find((s) => s.userId === userId && (!id || s.id === id) && !cancelled.includes(s.id));
        if (!hit) return [];
        cancelled.push(hit.id);
        return hit.entries;
      },
      list: (userId, from, to) =>
        saved
          .filter((s) => s.userId === userId && !cancelled.includes(s.id))
          .flatMap((s) => s.entries)
          .filter((e) => e.date >= from && e.date <= to),
    },
    pending: {
      put: (userId, p) => pendings.set(`${userId}:${p.id}`, p),
      get: (userId, id) => pendings.get(`${userId}:${id}`) ?? null,
      take: (userId, id) => {
        const p = pendings.get(`${userId}:${id}`) ?? null;
        pendings.delete(`${userId}:${id}`);
        return p;
      },
    },
    ...rest,
  };
  const last = () => replies[replies.length - 1]?.messages[0];
  /** Text of a text message, or every text node of a Flex card joined by newlines. */
  const lastText = () => {
    const m = last();
    if (!m) return '';
    return m.type === 'text' ? m.text : collect(m.contents, 'text').join('\n');
  };
  /** Postback data of quick replies or Flex buttons, in order. */
  const lastQuickReplyData = () => {
    const m = last();
    if (!m) return [];
    return m.type === 'text'
      ? (m.quickReply?.items.map((item) => item.action.data) ?? [])
      : collect(m.contents, 'data');
  };
  const button = (action: 'confirm' | 'toggle' | 'reject') =>
    lastQuickReplyData().find((d) => d.startsWith(`a=${action}&`)) ?? '';
  return { deps, replies, saved, cancelled, logs, last, lastText, lastQuickReplyData, button };
}

function collect(node: unknown, key: string): string[] {
  if (Array.isArray(node)) return node.flatMap((n) => collect(n, key));
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([k, v]) => (k === key && typeof v === 'string' ? [v] : collect(v, key)));
}

let eventSeq = 0;
function send(deps: WebhookDeps, event: Omit<LineEvent, 'webhookEventId' | 'replyToken' | 'source'>, userId = ALLOWED) {
  const id = `evt${++eventSeq}`;
  const full: LineEvent = { ...event, webhookEventId: id, replyToken: `rt-${id}`, source: { type: 'user', userId } };
  return handleWebhook(JSON.stringify({ events: [full] }), TOKEN, deps);
}
const textMsg = (text: string) => ({ type: 'message', message: { id: 'm', type: 'text', text } });
const postbackMsg = (data: string) => ({ type: 'postback', postback: { data } });

describe('webhook security and plumbing', () => {
  it('rejects a wrong or missing key without replying', () => {
    const { deps, replies } = setup();
    const raw = JSON.stringify({ events: [] });
    expect(handleWebhook(raw, 'wrong', deps)).toBe('forbidden');
    expect(handleWebhook(raw, undefined, deps)).toBe('forbidden');
    expect(replies).toHaveLength(0);
  });

  it('logs why a key was rejected without logging the key itself', () => {
    const details: string[] = [];
    const { deps } = setup({ log: (_l, _m, detail) => details.push(detail ?? '') });
    handleWebhook('{"events":[]}', undefined, deps);
    handleWebhook('{"events":[]}', 'wrong', deps);
    expect(details).toEqual(['no ?key= in URL; expected 12 chars', 'got 5 chars; expected 12 chars']);
    expect(details.join()).not.toContain(TOKEN);
  });

  it('rejects everything when no token is configured', () => {
    const { deps } = setup({ webhookToken: '' });
    expect(handleWebhook('{"events":[]}', '', deps)).toBe('forbidden');
  });

  it('accepts the empty verify request from LINE', () => {
    const { deps, replies } = setup();
    expect(handleWebhook('{"events":[]}', TOKEN, deps)).toBe('ok');
    expect(replies).toHaveLength(0);
  });

  it('returns bad_request for invalid JSON', () => {
    const { deps } = setup();
    expect(handleWebhook('not json', TOKEN, deps)).toBe('bad_request');
  });

  it('tells a non-whitelisted user their id and saves nothing', () => {
    const { deps, saved, lastText } = setup();
    send(deps, textMsg('ข้าว 60'), 'Ustranger');
    expect(lastText()).toContain('Ustranger');
    expect(saved).toHaveLength(0);
  });

  it('ignores a redelivered event', () => {
    const { deps, saved } = setup();
    const event: LineEvent = { ...textMsg('ข้าว 60'), webhookEventId: 'dup', replyToken: 'rt', source: { type: 'user', userId: ALLOWED } };
    const raw = JSON.stringify({ events: [event] });
    handleWebhook(raw, TOKEN, deps);
    handleWebhook(raw, TOKEN, deps);
    expect(saved).toHaveLength(1);
  });

  it('ignores group messages', () => {
    const { deps, replies } = setup();
    const event: LineEvent = { ...textMsg('ข้าว 60'), webhookEventId: 'g', replyToken: 'rt', source: { type: 'group', userId: ALLOWED } };
    handleWebhook(JSON.stringify({ events: [event] }), TOKEN, deps);
    expect(replies).toHaveLength(0);
  });

  it('replies with a system error and keeps going when one event fails', () => {
    const { deps, logs, lastText } = setup({
      ledger: { add: () => { throw new Error('lock timeout'); }, cancel: () => [], list: () => [], hasRef: () => false },
    });
    expect(send(deps, textMsg('ข้าว 60'))).toBe('ok');
    expect(logs).toContain('event failed');
    expect(lastText()).toContain('ขัดข้อง');
  });
});

describe('recording entries', () => {
  it('saves a confident result and offers a cancel button for it', () => {
    const { deps, saved, lastText, lastQuickReplyData } = setup();
    send(deps, textMsg('ข้าวมันไก่ 60'));
    expect(saved).toEqual([{ id: 'id1', entries: [food], source: 'text', userId: ALLOWED }]);
    expect(lastText()).toContain('บันทึกแล้ว');
    expect(lastText()).toContain('อาหาร −60 บาท (ข้าวมันไก่)');
    expect(lastQuickReplyData()).toEqual(['a=cancel&id=id1']);
  });

  it('asks before saving a low-confidence result, then saves on confirm', () => {
    const { deps, saved, last, lastText, button } = setup({
      parseResult: { kind: 'transactions', entries: [food], confident: false },
    });
    send(deps, textMsg('ข้าว หกสิบ มั้ง'));
    expect(saved).toHaveLength(0);
    expect(last()?.type).toBe('flex');
    expect(lastText()).toContain('ถูกต้องไหม');
    expect(lastText()).toContain('−60 บาท');

    send(deps, postbackMsg(button('confirm')));
    expect(saved).toHaveLength(1);
    expect(saved[0].entries).toEqual([food]);
    expect(lastText()).toContain('บันทึกแล้ว');
  });

  it('saves nothing when the user rejects', () => {
    const { deps, saved, lastText, button } = setup({
      parseResult: { kind: 'transactions', entries: [food], confident: false },
    });
    send(deps, textMsg('ข้าว หกสิบ มั้ง'));
    send(deps, postbackMsg(button('reject')));
    expect(saved).toHaveLength(0);
    expect(lastText()).toContain('ไม่บันทึก');
  });

  it('does not save twice when confirm is pressed twice', () => {
    const { deps, saved, lastText, button } = setup({
      parseResult: { kind: 'transactions', entries: [food], confident: false },
    });
    send(deps, textMsg('ข้าว หกสิบ มั้ง'));
    const confirm = button('confirm');
    send(deps, postbackMsg(confirm));
    send(deps, postbackMsg(confirm));
    expect(saved).toHaveLength(1);
    expect(lastText()).toContain('หมดเวลา');
  });

  it('explains how to use the bot when the text is not a transaction', () => {
    const { deps, saved, lastText } = setup({ parseResult: { kind: 'not_transaction' } });
    send(deps, textMsg('สวัสดี'));
    expect(saved).toHaveLength(0);
    expect(lastText()).toContain('ยังไม่เข้าใจ');
  });

  it('falls back to the rule parser when the LLM fails', () => {
    const { deps, saved, logs, lastText } = setup({ parseResult: new Error('Gemini 429') });
    send(deps, textMsg('ข้าวมันไก่ 60'));
    expect(logs).toContain('LLM parse failed');
    expect(saved[0].source).toBe('text-rule');
    expect(saved[0].entries[0]).toMatchObject({ type: 'expense', amount: 60, note: 'ข้าวมันไก่' });
    expect(lastText()).toContain('AI ขัดข้อง');
  });

  it('saves nothing when the LLM fails and the rule parser cannot read the text', () => {
    const { deps, saved, lastText } = setup({ parseResult: new Error('Gemini 500') });
    send(deps, textMsg('เมื่อวานกินหมูกระทะสี่ร้อยห้าสิบ'));
    expect(saved).toHaveLength(0);
    expect(lastText()).toContain('ระบบขัดข้อง');
  });

});

describe('slips and receipts', () => {
  const image = (id = 'img1') => ({ type: 'message', message: { id, type: 'image' } });

  it('shows a slip card and saves it with its ref on confirm', () => {
    const { deps, saved, last, lastText, button } = setup();
    send(deps, image());
    expect(saved).toHaveLength(0);
    expect(last()?.type).toBe('flex');
    expect(lastText()).toContain('สลิปโอนเงิน');
    expect(lastText()).toContain('−640 บาท');
    expect(lastText()).toContain('บิล/สาธารณูปโภค · การไฟฟ้า');
    expect(lastText()).toContain('9 ต.ค.');

    send(deps, postbackMsg(button('confirm')));
    expect(saved).toEqual([
      { id: 'id2', entries: [slip.kind === 'transaction' && slip.entry], source: 'slip', userId: ALLOWED, ref: '2026100912345' },
    ]);
  });

  it('flips a slip to income, moving the note to the sender and fixing the category', () => {
    const { deps, saved, lastText, button } = setup();
    send(deps, image());
    send(deps, postbackMsg(button('toggle')));
    expect(lastText()).toContain('+640 บาท');
    expect(lastText()).toContain('อื่นๆ · นาย ก');
    expect(button('toggle')).not.toBe('');

    send(deps, postbackMsg(button('confirm')));
    expect(saved[0].entries[0]).toMatchObject({ type: 'income', category: 'อื่นๆ', note: 'นาย ก' });
  });

  it('rejects a slip that is already saved', () => {
    const { deps, saved, lastText, button } = setup();
    send(deps, image('a'));
    send(deps, postbackMsg(button('confirm')));
    send(deps, image('b'));
    expect(lastText()).toContain('สลิปนี้บันทึกไปแล้ว');
    expect(saved).toHaveLength(1);
  });

  it('keeps several slips pending at once, each confirmable from its own card', () => {
    const { deps, saved, button } = setup({ imageResult: { ...slip, ref: '' } as ImageResult });
    send(deps, image('a'));
    const first = button('confirm');
    send(deps, image('b'));
    const second = button('confirm');
    expect(first).not.toBe(second);

    send(deps, postbackMsg(first));
    send(deps, postbackMsg(second));
    expect(saved).toHaveLength(2);
  });

  it('does not save the same slip twice when two cards for it are confirmed', () => {
    const { deps, saved, lastText, button } = setup();
    send(deps, image('a'));
    const first = button('confirm');
    send(deps, image('b'));
    const second = button('confirm');
    send(deps, postbackMsg(first));
    send(deps, postbackMsg(second));
    expect(saved).toHaveLength(1);
    expect(lastText()).toContain('บันทึกไปแล้ว');
  });

  it('allows a slip again after its entry was cancelled', () => {
    const { deps, saved, lastText, button } = setup();
    send(deps, image('a'));
    send(deps, postbackMsg(button('confirm')));
    send(deps, textMsg('ยกเลิก'));
    send(deps, image('b'));
    expect(lastText()).toContain('สลิปโอนเงิน');
    send(deps, postbackMsg(button('confirm')));
    expect(saved).toHaveLength(2);
  });

  it.each([
    [{ kind: 'other' } as ImageResult, 'ไม่ใช่สลิปหรือใบเสร็จ'],
    [{ kind: 'unreadable' } as ImageResult, 'อ่านยอดเงินในรูปไม่ได้'],
    [new Error('Gemini 503'), 'อ่านรูปไม่สำเร็จ'],
  ])('saves nothing for %s', (imageResult, message) => {
    const { deps, saved, lastText } = setup({ imageResult });
    send(deps, image());
    expect(saved).toHaveLength(0);
    expect(lastText()).toContain(message);
  });
});

describe('voice', () => {
  const audio = (duration = 3000) => ({ type: 'message', message: { id: 'a1', type: 'audio', duration } });

  it('always asks to confirm a voice entry, even when confident, and shows what it heard', () => {
    const { deps, saved, lastText, button } = setup();
    send(deps, audio());
    expect(saved).toHaveLength(0);
    expect(lastText()).toContain('ข้อความเสียง');
    expect(lastText()).toContain('“ข้าวมันไก่หกสิบ”');

    send(deps, postbackMsg(button('confirm')));
    expect(saved).toEqual([{ id: 'id2', entries: [food], source: 'voice', userId: ALLOWED }]);
  });

  it('runs a spoken summary command directly', () => {
    const { deps, lastText } = setup({
      voiceResult: { transcript: 'สรุปเดือนนี้หน่อย', intent: 'summary_this_month', result: { kind: 'not_transaction' } },
    });
    send(deps, audio());
    expect(lastText()).toContain('สรุปเดือนตุลาคม 2569');
  });

  it('only offers a button for a spoken cancel', () => {
    const { deps, cancelled, lastText, lastQuickReplyData } = setup();
    send(deps, textMsg('ข้าวมันไก่ 60'));
    deps.parseVoice = () => ({ transcript: 'ยกเลิกอันล่าสุด', intent: 'cancel', result: { kind: 'not_transaction' } });
    send(deps, audio());
    expect(cancelled).toHaveLength(0);
    expect(lastText()).toContain('ยกเลิกรายการล่าสุดใช่ไหม');

    send(deps, postbackMsg(lastQuickReplyData()[0]));
    expect(cancelled).toEqual(['id1']);
  });

  it('shows the transcript when it is not a transaction', () => {
    const { deps, lastText } = setup({
      voiceResult: { transcript: 'ฝนตกหนักมาก', intent: 'other', result: { kind: 'not_transaction' } },
    });
    send(deps, audio());
    expect(lastText()).toContain('ฝนตกหนักมาก');
    expect(lastText()).toContain('ยังไม่เข้าใจ');
  });

  it('refuses clips over a minute without calling Gemini', () => {
    let called = false;
    const { deps, lastText } = setup({ parseVoice: () => { called = true; throw new Error('no'); } });
    send(deps, audio(61_000));
    expect(called).toBe(false);
    expect(lastText()).toContain('ยาวเกินไป');
  });

  it('saves nothing when transcription fails', () => {
    const { deps, saved, logs, lastText } = setup({ voiceResult: new Error('Gemini 503') });
    send(deps, audio());
    expect(saved).toHaveLength(0);
    expect(logs).toContain('voice parse failed');
    expect(lastText()).toContain('ฟังเสียงไม่สำเร็จ');
  });
});

describe('commands', () => {
  it('"ยกเลิก" cancels the latest entry', () => {
    const { deps, cancelled, lastText } = setup();
    send(deps, textMsg('ข้าวมันไก่ 60'));
    send(deps, textMsg(' ยกเลิก '));
    expect(cancelled).toEqual(['id1']);
    expect(lastText()).toContain('ยกเลิกแล้ว');
  });

  it('the cancel button cancels that specific entry', () => {
    const { deps, cancelled, lastQuickReplyData } = setup();
    send(deps, textMsg('ข้าวมันไก่ 60'));
    const [cancelFirst] = lastQuickReplyData();
    send(deps, textMsg('กาแฟ 45'));
    send(deps, postbackMsg(cancelFirst));
    expect(cancelled).toEqual(['id1']);
  });

  it('says so when there is nothing to cancel', () => {
    const { deps, lastText } = setup();
    send(deps, textMsg('ยกเลิก'));
    expect(lastText()).toContain('ไม่พบรายการ');
  });

  it('"สรุปวันนี้" summarises only today\'s active entries', () => {
    const { deps, lastText } = setup();
    send(deps, textMsg('ข้าวมันไก่ 60'));
    send(deps, textMsg('ข้าวมันไก่ 60'));
    send(deps, textMsg('ยกเลิก'));
    send(deps, textMsg('สรุปวันนี้'));
    expect(lastText()).toContain('สรุปวันนี้ (12 ต.ค.)');
    expect(lastText()).toContain('รายจ่าย −60 บาท');
  });

  it('month summaries accept spacing variants and report empty months', () => {
    const { deps, lastText } = setup();
    send(deps, textMsg('สรุป เดือนที่แล้ว'));
    expect(lastText()).toContain('สรุปเดือนกันยายน 2569');
    expect(lastText()).toContain('ยังไม่มีรายการ');
  });

  it('does not send summary commands to the LLM', () => {
    let parsed = 0;
    const { deps } = setup({ parse: () => { parsed++; return { kind: 'not_transaction' }; } });
    send(deps, textMsg('สรุปเดือนนี้'));
    send(deps, textMsg('สรุป'));
    expect(parsed).toBe(0);
  });

  it('shows help', () => {
    const { deps, lastText } = setup();
    send(deps, textMsg('วิธีใช้'));
    expect(lastText()).toContain('วิธีใช้');
  });
});
