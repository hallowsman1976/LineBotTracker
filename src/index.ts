// Apps Script entry points. build.mjs wraps each export in a top-level function.
import { DEFAULT_SPREADSHEET_ID, getProp, OPTIONAL_PROP, PROP, SHEETS, STATE_PROP } from './config';
import { parseVoiceWithGemini, parseWithGemini } from './gemini';
import { addEntries, cancelEntries, listEntries } from './ledger';
import richMenuImage from '../assets/richmenu.png';
import { getMessageContentBase64, lineApi, push, reply } from './line';
import { runMonthlySummary, type MonthlyDeps } from './monthly';
import { RICH_MENU_NAME, richMenuBody } from './richmenu';
import { bangkokDate } from './parse';
import { putPending, takePending } from './pending';
import { activeUserIds, isAllowedUser, log, markProcessed } from './store';
import { handleWebhook } from './webhook';

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  // Apps Script cannot read request headers, so x-line-signature is unverifiable;
  // the secret ?key= on the webhook URL authenticates LINE instead.
  const result = handleWebhook(e.postData?.contents ?? '', e.parameter?.key, {
    webhookToken: getProp(PROP.WEBHOOK_TOKEN),
    isAllowedUser,
    markProcessed,
    reply,
    log,
    now: () => new Date(),
    newId: () => Utilities.getUuid().replace(/-/g, '').slice(0, 12),
    parse: parseWithGemini,
    parseVoice: (messageId, today) => parseVoiceWithGemini(getMessageContentBase64(messageId), today),
    ledger: { add: addEntries, cancel: cancelEntries, list: listEntries },
    pending: { put: putPending, take: takePending },
  });
  return json({ result });
}

export function doGet(): GoogleAppsScript.Content.TextOutput {
  return json({ status: 'ok' });
}

/**
 * Run from the Apps Script editor: creates the spreadsheet, sheets and webhook token.
 * Safe to re-run; it also appends header columns added in later versions.
 */
export function setup(): void {
  const props = PropertiesService.getScriptProperties();

  let ss: GoogleAppsScript.Spreadsheet.Spreadsheet;
  const existingId = props.getProperty(PROP.SPREADSHEET_ID) || DEFAULT_SPREADSHEET_ID;
  if (existingId) {
    ss = SpreadsheetApp.openById(existingId);
  } else {
    ss = SpreadsheetApp.create('LineBotTracker DB');
  }
  props.setProperty(PROP.SPREADSHEET_ID, ss.getId());
  ss.setSpreadsheetTimeZone('Asia/Bangkok');

  for (const [name, headers] of Object.entries(SHEETS)) {
    const sheet = ss.getSheetByName(name) ?? ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([...headers]);
      sheet.setFrozenRows(1);
      continue;
    }
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const missing = headers.filter((h) => !existing.includes(h));
    if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  const blank = ss.getSheetByName('Sheet1') ?? ss.getSheetByName('ชีต1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);

  if (!props.getProperty(PROP.WEBHOOK_TOKEN)) {
    props.setProperty(PROP.WEBHOOK_TOKEN, Utilities.getUuid().replace(/-/g, ''));
  }

  console.log(`Spreadsheet: ${ss.getUrl()}`);
  checkProperties();
}

/** Logs which properties are set, without revealing their values. */
export function checkProperties(): void {
  for (const name of Object.values(PROP)) {
    const value = getProp(name);
    console.log(`${name}: ${value ? `set (${value.length} chars)` : 'MISSING'}`);
  }
  for (const name of Object.values(OPTIONAL_PROP)) {
    console.log(`${name}: ${getProp(name) || '(default)'}`);
  }
}

/** Logs the full webhook URL to paste into LINE Developers Console (owner-only log). */
export function showWebhookUrl(): void {
  const url = ScriptApp.getService().getUrl();
  console.log(`${url}?key=${getProp(PROP.WEBHOOK_TOKEN)}`);
}

/**
 * Run from the editor: creates the 4-button rich menu on this bot's OA and makes it the default.
 * Re-running replaces menus this script created earlier; menus made elsewhere are left alone.
 */
export function setupRichMenu(): void {
  const previous = (JSON.parse(lineApi('get', 'https://api.line.me/v2/bot/richmenu/list')).richmenus ?? []) as {
    richMenuId: string;
    name: string;
  }[];

  const { richMenuId } = JSON.parse(lineApi('post', 'https://api.line.me/v2/bot/richmenu', richMenuBody()));
  const image = Utilities.newBlob(Utilities.base64Decode(richMenuImage), 'image/png', 'richmenu.png');
  lineApi('post', `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, undefined, image);
  lineApi('post', `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`);

  for (const menu of previous) {
    if (menu.name === RICH_MENU_NAME) lineApi('delete', `https://api.line.me/v2/bot/richmenu/${menu.richMenuId}`);
  }
  console.log(`Rich menu ${richMenuId} is now the default`);
}

const MONTHLY_TRIGGER_HANDLER = 'monthlySummaryTrigger';

function monthlyDeps(): MonthlyDeps {
  const props = PropertiesService.getScriptProperties();
  return {
    now: () => new Date(),
    activeUserIds,
    list: listEntries,
    push,
    getLastSentMonth: () => props.getProperty(STATE_PROP.LAST_MONTHLY_SUMMARY) ?? '',
    setLastSentMonth: (month) => props.setProperty(STATE_PROP.LAST_MONTHLY_SUMMARY, month),
    log,
  };
}

/** Daily time-trigger handler; sends only on the last day of the month. */
export function monthlySummaryTrigger(): void {
  runMonthlySummary(monthlyDeps());
}

/**
 * Run once from the editor: installs a daily trigger at 20:00 Bangkok
 * (Apps Script fires it some time within 20:00–21:00). Re-running replaces it.
 */
export function setupMonthlyTrigger(): void {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === MONTHLY_TRIGGER_HANDLER) ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger(MONTHLY_TRIGGER_HANDLER).timeBased().everyDays(1).atHour(20).inTimezone('Asia/Bangkok').create();
  console.log('Daily 20:00 trigger installed; it sends on the last day of each month');
}

/** Editor test: pushes this month's summary to every active user right now. */
export function sendMonthlySummaryNow(): void {
  console.log(`sent to ${runMonthlySummary(monthlyDeps(), true)} user(s)`);
}

/** Editor check that the Gemini key and model work, without going through LINE. */
export function testGemini(): void {
  const today = bangkokDate(new Date());
  for (const sample of ['ข้าวมันไก่ 60 กับกาแฟ 45', 'เมื่อวานได้ค่าแรงแปดร้อย', 'สวัสดีครับ']) {
    console.log(sample, '→', JSON.stringify(parseWithGemini(sample, today)));
  }
}

function json(body: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
