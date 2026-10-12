// Flex confirm card. Its buttons stay attached to the card, unlike quick replies which only
// show under the latest message, so several pending items (e.g. 3 slips) can each be confirmed.
import { formatBaht, formatThaiDate } from './format';
import type { LineMessage, PostbackAction } from './lineTypes';
import type { Entry } from './parse';
import type { Pending } from './webhook';

// Same palette as the dashboard (light theme; Flex has no dark-mode variant).
const C = { text: '#111417', text2: '#5B636B', text3: '#8A9299', income: '#078A3E', accent: '#06C755' };

const TITLES: Record<string, string> = {
  slip: 'สลิปโอนเงิน',
  receipt: 'ใบเสร็จ',
  voice: 'ข้อความเสียง',
  text: 'ตรวจรายการ',
};

const MAX_ENTRIES_SHOWN = 5;

export function confirmCard(pending: Pending, today: string): LineMessage {
  const entries = pending.entries.slice(0, MAX_ENTRIES_SHOWN);
  const more = pending.entries.length - entries.length;
  const single = pending.entries.length === 1;

  const body: Record<string, unknown>[] = [
    { type: 'text', text: TITLES[pending.source] ?? TITLES.text, size: 'xs', weight: 'bold', color: C.text3 },
  ];
  if (pending.heading) {
    body.push({ type: 'text', text: `“${pending.heading}”`, size: 'sm', color: C.text2, wrap: true });
  }
  entries.forEach((e, i) => {
    if (i > 0) body.push({ type: 'separator', margin: 'lg' });
    body.push(entryBlock(e, today));
  });
  if (more > 0) body.push({ type: 'text', text: `และอีก ${more} รายการ`, size: 'sm', color: C.text3 });
  body.push({ type: 'text', text: 'ถูกต้องไหม?', size: 'sm', color: C.text2, margin: 'xl' });

  const flipTo = single && pending.entries[0].type === 'expense' ? 'รายรับ' : 'รายจ่าย';
  const footer = [
    button({ label: 'บันทึก', data: `a=confirm&id=${pending.id}`, displayText: 'บันทึก' }, 'primary'),
    ...(single
      ? [button({ label: `สลับเป็น${flipTo}`, data: `a=toggle&id=${pending.id}`, displayText: `เปลี่ยนเป็น${flipTo}` }, 'secondary')]
      : []),
    button({ label: 'ไม่ใช่', data: `a=reject&id=${pending.id}`, displayText: 'ไม่ใช่' }, 'link'),
  ];

  return {
    type: 'flex',
    altText: `ยืนยันรายการ: ${pending.entries.map((e) => `${e.category} ${amountText(e)}`).join(', ')}`.slice(0, 400),
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: footer },
    },
  };
}

function entryBlock(e: Entry, today: string): Record<string, unknown> {
  // Flex rejects empty text, so the detail line omits a missing note instead of leaving it blank.
  const detail = e.note ? `${e.category} · ${e.note}` : e.category;
  const date = e.date === today ? `${formatThaiDate(e.date)} (วันนี้)` : formatThaiDate(e.date);
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'lg',
    contents: [
      { type: 'text', text: amountText(e), size: 'xxl', weight: 'bold', color: e.type === 'income' ? C.income : C.text },
      { type: 'text', text: detail, size: 'sm', color: C.text2, wrap: true },
      { type: 'text', text: date, size: 'xs', color: C.text3 },
    ],
  };
}

function amountText(e: Entry): string {
  return `${e.type === 'income' ? '+' : '−'}${formatBaht(e.amount)} บาท`;
}

function button(action: Omit<PostbackAction, 'type'>, style: 'primary' | 'secondary' | 'link'): Record<string, unknown> {
  return {
    type: 'button',
    style,
    height: 'sm',
    ...(style === 'primary' ? { color: C.accent } : {}),
    action: { type: 'postback', ...action },
  };
}
