import { getProp, PROP } from './config';

export function openDb(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  return SpreadsheetApp.openById(getProp(PROP.SPREADSHEET_ID));
}

/** userIds in the `users` sheet whose `active` cell isn't FALSE (blank counts as active). */
export function activeUserIds(): string[] {
  const sheet = openDb().getSheetByName('users');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 3)
    .getValues()
    .filter(([id, , active]) => id && active !== false && active !== 'FALSE')
    .map(([id]) => String(id).trim());
}

export function isAllowedUser(userId: string): boolean {
  return activeUserIds().includes(userId);
}

// LINE redelivers within hours, and CacheService keeps entries up to 6 hours.
const SEEN_TTL_SECONDS = 6 * 60 * 60;

export function markProcessed(eventId: string): boolean {
  const cache = CacheService.getScriptCache();
  const key = `evt:${eventId}`;
  if (cache.get(key)) return false;
  cache.put(key, '1', SEEN_TTL_SECONDS);
  return true;
}

export function log(level: string, message: string, detail = ''): void {
  try {
    openDb().getSheetByName('logs')?.appendRow([new Date(), level, message, detail.slice(0, 5000)]);
  } catch (err) {
    console.error('log sheet unavailable', message, err);
  }
}
