export const PROP = {
  LINE_CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  WEBHOOK_TOKEN: 'WEBHOOK_TOKEN',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
} as const;

/** Written by the script itself, not set by hand. */
export const STATE_PROP = {
  LAST_MONTHLY_SUMMARY: 'LAST_MONTHLY_SUMMARY',
} as const;

/** Optional overrides; a default is used when unset. */
export const OPTIONAL_PROP = {
  GEMINI_MODEL: 'GEMINI_MODEL',
} as const;

/** setup() stores this as SPREADSHEET_ID when the property is unset. Not a secret: access follows Drive sharing. */
export const DEFAULT_SPREADSHEET_ID = '1E0_sRw-w9SJ2O-QUgaY79OHngzY0a-Iz8v8vS_doc68';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export function getProp(name: string): string {
  return PropertiesService.getScriptProperties().getProperty(name) ?? '';
}

// Rows are read and written by header name, so column order here only matters for a new sheet.
export const SHEETS = {
  transactions: ['id', 'date', 'type', 'amount', 'category', 'note', 'userId', 'source', 'rawText', 'timestamp', 'status'],
  users: ['userId', 'name', 'active', 'addedAt'],
  logs: ['timestamp', 'level', 'message', 'detail'],
} as const;
