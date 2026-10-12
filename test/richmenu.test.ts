import { describe, expect, it } from 'vitest';
import { RICH_MENU_BUTTONS, richMenuBody } from '../src/richmenu';
import { handleWebhook, type WebhookDeps } from '../src/webhook';

describe('rich menu', () => {
  it('covers the whole image exactly once', () => {
    const { size, areas, chatBarText } = richMenuBody('2000000000-abcdEFGH');
    expect(areas.reduce((sum, a) => sum + a.bounds.width * a.bounds.height, 0)).toBe(size.width * size.height);
    for (const a of areas) {
      for (const b of areas) {
        if (a === b) continue;
        const overlapX = a.bounds.x < b.bounds.x + b.bounds.width && b.bounds.x < a.bounds.x + a.bounds.width;
        const overlapY = a.bounds.y < b.bounds.y + b.bounds.height && b.bounds.y < a.bounds.y + a.bounds.height;
        expect(overlapX && overlapY).toBe(false);
      }
    }
    expect(chatBarText.length).toBeLessThanOrEqual(14);
  });

  it('opens the dashboard through LIFF from the wide top-left button', () => {
    const [dashboard] = richMenuBody('2000000000-abcdEFGH').areas;
    expect(dashboard.bounds).toEqual({ x: 0, y: 0, width: 1667, height: 843 });
    expect(dashboard.action).toEqual({ type: 'uri', label: 'แดชบอร์ด', uri: 'https://liff.line.me/2000000000-abcdEFGH' });
  });

  it('refuses to build without a LIFF ID', () => {
    expect(() => richMenuBody('')).toThrow('LIFF_ID');
  });

  it('every button sends a command the webhook handles without the LLM', () => {
    for (const { text } of RICH_MENU_BUTTONS) {
      let replied = false;
      let reachedLlm = false;
      const deps = {
        webhookToken: 't',
        isAllowedUser: () => true,
        markProcessed: () => true,
        reply: () => { replied = true; },
        log: () => {},
        now: () => new Date('2026-10-12T05:00:00Z'),
        newId: () => 'x',
        parse: () => { reachedLlm = true; return { kind: 'not_transaction' as const }; },
        parseVoice: () => { throw new Error('unused'); },
        parseImage: () => { throw new Error('unused'); },
        ledger: { add: () => {}, cancel: () => [], list: () => [], hasRef: () => false },
        pending: { put: () => {}, get: () => null, take: () => null },
      } satisfies WebhookDeps;
      const event = { type: 'message', webhookEventId: text, replyToken: 'rt', source: { type: 'user', userId: 'U' }, message: { id: 'm', type: 'text', text } };
      handleWebhook(JSON.stringify({ events: [event] }), 't', deps);
      expect(replied, text).toBe(true);
      expect(reachedLlm, text).toBe(false);
    }
  });
});
