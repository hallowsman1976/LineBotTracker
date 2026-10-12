// Rich menu definition. The image (assets/richmenu.png) is 2500x843 with four equal columns.
export const RICH_MENU_NAME = 'LineBotTracker';
const WIDTH = 2500;
const HEIGHT = 843;

/** Each button just sends the same text command a user could type. */
export const RICH_MENU_BUTTONS = [
  { label: 'สรุปวันนี้', text: 'สรุปวันนี้' },
  { label: 'สรุปเดือนนี้', text: 'สรุปเดือนนี้' },
  { label: 'ยกเลิกล่าสุด', text: 'ยกเลิก' },
  { label: 'วิธีใช้', text: 'วิธีใช้' },
];

export function richMenuBody() {
  const columnWidth = WIDTH / RICH_MENU_BUTTONS.length;
  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: RICH_MENU_NAME,
    chatBarText: 'เมนู 📒',
    areas: RICH_MENU_BUTTONS.map((button, i) => ({
      bounds: { x: i * columnWidth, y: 0, width: columnWidth, height: HEIGHT },
      action: { type: 'message', label: button.label, text: button.text },
    })),
  };
}
