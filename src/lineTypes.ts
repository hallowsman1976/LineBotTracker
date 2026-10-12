// LINE Messaging API message shapes this bot sends.

export type PostbackAction = { type: 'postback'; label: string; data: string; displayText: string };

export type QuickReplyItem = { type: 'action'; action: PostbackAction };

export type LineMessage =
  | { type: 'text'; text: string; quickReply?: { items: QuickReplyItem[] } }
  | { type: 'flex'; altText: string; contents: Record<string, unknown> };
