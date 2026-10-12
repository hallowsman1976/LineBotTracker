// Rich menu definition. The image (assets/richmenu.png, from assets/richmenu.html) is 2500x1686:
// 3 columns x 2 rows, with the dashboard button spanning two columns of the top row.
import { liffUrl } from './publicConfig';

export const RICH_MENU_NAME = 'LineBotTracker';
const WIDTH = 2500;
const HEIGHT = 1686;
const COLS = [0, 833, 1667, 2500];
const ROWS = [0, 843, 1686];

type Action = { type: 'message'; label: string; text: string } | { type: 'uri'; label: string; uri: string };

/** Message buttons send the same text command a user could type. */
export const RICH_MENU_BUTTONS = [
  { label: 'สรุปวันนี้', text: 'สรุปวันนี้', col: 2, row: 0 },
  { label: 'สรุปเดือนนี้', text: 'สรุปเดือนนี้', col: 0, row: 1 },
  { label: 'ยกเลิกล่าสุด', text: 'ยกเลิก', col: 1, row: 1 },
  { label: 'วิธีใช้', text: 'วิธีใช้', col: 2, row: 1 },
];

function cell(col: number, row: number, span = 1) {
  return { x: COLS[col], y: ROWS[row], width: COLS[col + span] - COLS[col], height: ROWS[row + 1] - ROWS[row] };
}

export function richMenuBody(liffId: string) {
  if (!liffId) throw new Error('LIFF_ID is empty in src/publicConfig.ts; the dashboard button needs it');
  const areas: { bounds: ReturnType<typeof cell>; action: Action }[] = [
    { bounds: cell(0, 0, 2), action: { type: 'uri', label: 'แดชบอร์ด', uri: liffUrl(liffId) } },
    ...RICH_MENU_BUTTONS.map((b) => ({
      bounds: cell(b.col, b.row),
      action: { type: 'message' as const, label: b.label, text: b.text },
    })),
  ];
  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: RICH_MENU_NAME,
    chatBarText: 'เมนู',
    areas,
  };
}
