// Non-secret IDs shared by the Apps Script backend and the web dashboard (web/).
// Nothing here grants access by itself: the API checks a LINE ID token and the users whitelist.

/** Deployed Apps Script web app (the same deployment the LINE webhook uses). */
export const API_URL =
  'https://script.google.com/macros/s/AKfycbwMdiyG6iUfCJgOpMk0ODfp9zNioWKsCdyBSL3YiQZ5ZwwJtEAwXA1tfp6bZkq8-ISMUA/exec?api=1';

/** LIFF app of the LINE Login channel (same provider as the bot). Empty until it is created. */
export const LIFF_ID = '2011983347-FZa3vB33';

/** LINE Login channel ID; the API checks that ID tokens were issued to this channel. */
export const LINE_LOGIN_CHANNEL_ID = '2011983347';

export const liffUrl = (liffId: string) => `https://liff.line.me/${liffId}`;
