import { describe, expect, it } from 'vitest';
import { RICH_MENU_BUTTONS, richMenuBody } from '../src/richmenu';
import { handleWebhook, type WebhookDeps } from '../src/webhook';

describe('rich menu', () => {
  it('tiles the full image width with no gaps', () => {
    const { size, areas, chatBarText } = richMenuBody();
    expect(areas.reduce((w, a) => w + a.bounds.width, 0)).toBe(size.width);
    areas.forEach((a, i) => i > 0 && expect(a.bounds.x).toBe(areas[i - 1].bounds.x + areas[i - 1].bounds.width));
    expect(chatBarText.length).toBeLessThanOrEqual(14);
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
        ledger: { add: () => {}, cancel: () => [], list: () => [] },
        pending: { put: () => {}, take: () => null },
      } satisfies WebhookDeps;
      const event = { type: 'message', webhookEventId: text, replyToken: 'rt', source: { type: 'user', userId: 'U' }, message: { id: 'm', type: 'text', text } };
      handleWebhook(JSON.stringify({ events: [event] }), 't', deps);
      expect(replied, text).toBe(true);
      expect(reachedLlm, text).toBe(false);
    }
  });
});
