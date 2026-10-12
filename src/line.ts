import { getProp, PROP } from './config';
import type { LineMessage } from './webhook';

type HttpMethod = GoogleAppsScript.URL_Fetch.HttpMethod;

/** Calls the LINE API with the bot's token; throws on any non-200 response. */
export function lineApi(method: HttpMethod, url: string, body?: unknown, blob?: GoogleAppsScript.Base.Blob): string {
  const res = UrlFetchApp.fetch(url, {
    method,
    headers: { Authorization: `Bearer ${getProp(PROP.LINE_CHANNEL_ACCESS_TOKEN)}` },
    ...(blob
      ? { contentType: blob.getContentType() ?? 'application/octet-stream', payload: blob.getBytes() }
      : body !== undefined
        ? { contentType: 'application/json', payload: JSON.stringify(body) }
        : {}),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error(`LINE ${method.toUpperCase()} ${url} ${res.getResponseCode()}: ${res.getContentText()}`);
  }
  return res.getContentText();
}

/** Downloads a user's audio/image message as base64. LINE keeps the content only for a limited time. */
export function getMessageContentBase64(messageId: string): string {
  const res = UrlFetchApp.fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${getProp(PROP.LINE_CHANNEL_ACCESS_TOKEN)}` },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error(`LINE content ${messageId} ${res.getResponseCode()}: ${res.getContentText().slice(0, 300)}`);
  }
  return Utilities.base64Encode(res.getBlob().getBytes());
}

export function push(to: string, messages: LineMessage[]): void {
  lineApi('post', 'https://api.line.me/v2/bot/message/push', { to, messages });
}

export function reply(replyToken: string, messages: LineMessage[]): void {
  lineApi('post', 'https://api.line.me/v2/bot/message/reply', { replyToken, messages });
}
