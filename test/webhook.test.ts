import { describe, expect, it } from 'vitest';
import type { Entry, ParseResult, VoiceResult } from '../src/parse';
import { handleWebhook, type LineEvent, type LineMessage, type Pending, type WebhookDeps } from '../src/webhook';

const TOKEN = 'secret-token';
const ALLOWED = 'Uallowed';
const NOW = new Date('2026-10-12T05:00:00Z'); // 12:00 in Bangkok
const TODAY = '2026-10-12';

const food: Entry = { type: 'expense', amount: 60, category: 'อาหาร', note: 'ข้าวมันไก่', date: TODAY };

function setup(
  overrides: Partial<WebhookDeps> & { parseResult?: ParseResult | Error; voiceResult?: VoiceResult | Error } = {},
) {
  const replies: { token: string; messages: LineMessage[] }[] = [];
  const saved: { id: string; entries: Entry[]; source: string; userId: string }[] = [];
  const cancelled: string[] = [];
  const logs: string[] = [];
  const seen = new Set<string>();
  const pendings = new Map<string, Pending>();
  let ids = 0;
  const {
    parseResult = { kind: 'transactions', entries: [food], confident: true },
    voiceResult = { transcript: 'ข้าวมันไก่หกสิบ', intent: 'record', result: { kind: 'transactions', entries: [food], confident: true } },
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
    ledger: {
      add: (id, entries, meta) => saved.push({ id, entries, source: meta.source, userId: meta.userId }),
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
      put: (userId, p) => pendings.set(userId, p),
      take: (userId, id) => {
        const p = pendings.get(userId);
        if (!p || p.id !== id) return null;
        pendings.delete(userId);
        return p;
      },
    },
    ...rest,
  };
  const last = () => replies[replies.length - 1]?.messages[0];
  const lastText = () => last()?.text ?? '';
  const lastQuickReplyData = () => last()?.quickReply?.items.map((item) => item.action.data) ?? [];
  return { deps, replies, saved, cancelled, logs, lastText, lastQuickReplyData };
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
      ledger: { add: () => { throw new Error('lock timeout'); }, cancel: () => [], list: () => [] },
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
    const { deps, saved, lastText, lastQuickReplyData } = setup({
      parseResult: { kind: 'transactions', entries: [food], confident: false },
    });
    send(deps, textMsg('ข้าว หกสิบ มั้ง'));
    expect(saved).toHaveLength(0);
    expect(lastText()).toContain('ถูกไหม');
    const [confirm] = lastQuickReplyData();

    send(deps, postbackMsg(confirm));
    expect(saved).toHaveLength(1);
    expect(saved[0].entries).toEqual([food]);
    expect(lastText()).toContain('บันทึกแล้ว');
  });

  it('saves nothing when the user rejects', () => {
    const { deps, saved, lastText, lastQuickReplyData } = setup({
      parseResult: { kind: 'transactions', entries: [food], confident: false },
    });
    send(deps, textMsg('ข้าว หกสิบ มั้ง'));
    send(deps, postbackMsg(lastQuickReplyData()[1]));
    expect(saved).toHaveLength(0);
    expect(lastText()).toContain('ไม่บันทึก');
  });

  it('does not save twice when confirm is pressed twice', () => {
    const { deps, saved, lastText, lastQuickReplyData } = setup({
      parseResult: { kind: 'transactions', entries: [food], confident: false },
    });
    send(deps, textMsg('ข้าว หกสิบ มั้ง'));
    const [confirm] = lastQuickReplyData();
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

describe('voice', () => {
  const audio = (duration = 3000) => ({ type: 'message', message: { id: 'a1', type: 'audio', duration } });

  it('always asks to confirm a voice entry, even when confident, and shows what it heard', () => {
    const { deps, saved, lastText, lastQuickReplyData } = setup();
    send(deps, audio());
    expect(saved).toHaveLength(0);
    expect(lastText()).toContain('🎤 "ข้าวมันไก่หกสิบ"');
    expect(lastText()).toContain('ถูกไหม');

    send(deps, postbackMsg(lastQuickReplyData()[0]));
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
