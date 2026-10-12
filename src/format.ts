import type { Entry } from './parse';

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function formatBaht(amount: number): string {
  const [int, frac] = amount.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === '00' ? grouped : `${grouped}.${frac}`;
}

export function formatThaiDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${THAI_MONTHS[m - 1]}`;
}

/** "• อาหาร −60 บาท (ข้าวมันไก่) · 11 ต.ค." — the date appears only when it isn't today. */
export function formatEntry(entry: Entry, today: string): string {
  const sign = entry.type === 'income' ? '+' : '−';
  const note = entry.note ? ` (${entry.note})` : '';
  const date = entry.date !== today ? ` · ${formatThaiDate(entry.date)}` : '';
  return `• ${entry.category} ${sign}${formatBaht(entry.amount)} บาท${note}${date}`;
}

export function formatEntries(entries: Entry[], today: string): string {
  return entries.map((e) => formatEntry(e, today)).join('\n');
}

export const HELP_TEXT = [
  '📒 วิธีใช้',
  'พิมพ์รายการได้เลย เช่น',
  '• ข้าวมันไก่ 60',
  '• เมื่อวานเติมน้ำมัน 500',
  '• ได้เงินเดือน 25000',
  '• กาแฟ 45 ขนม 30 (หลายรายการในข้อความเดียว)',
  '',
  '🎤 กดไมค์พูดก็ได้ เช่น "เมื่อวานเติมน้ำมันห้าร้อย" หรือ "สรุปเดือนนี้"',
  '📷 ส่งรูปสลิปหรือใบเสร็จได้ (ส่งหลายรูปพร้อมกันก็ได้)',
  '',
  'คำสั่ง',
  '• สรุปวันนี้ / สรุปเดือนนี้ / สรุปเดือนที่แล้ว',
  '• ยกเลิก = ลบรายการล่าสุด',
].join('\n');

export const NOT_UNDERSTOOD_TEXT = `ยังไม่เข้าใจรายการนี้ 🤔\nลองพิมพ์แบบ "ข้าวมันไก่ 60" หรือ "ได้เงินเดือน 25000"`;

export const SYSTEM_ERROR_TEXT = `ระบบขัดข้องชั่วคราว ยังไม่ได้บันทึกนะ\nลองพิมพ์ใหม่แบบ "ข้าว 60"`;
