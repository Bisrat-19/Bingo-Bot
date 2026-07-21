import { Markup } from 'telegraf';
import { signSession } from '../auth/jwt';
import { config } from '../config/env';

// Button labels double as the text a reply-keyboard button sends back, so they're
// declared once here and reused by the handlers.
export const BTN = {
  register: '📝 Register',
  play: '🎮 Play Game',
  deposit: '💰 Deposit',
  withdraw: '💸 Withdraw',
  balance: '💳 Balance',
  support: '📞 Support',
  instructions: '📖 Instructions',
  admin: '⚙️ Admin',
} as const;

/**
 * Reply keyboards persist in the chat, so the embedded token must outlive the message.
 * It matches the session lifetime and is refreshed every time we send a keyboard.
 * It is scoped to 'launch': it can only be exchanged for a session, never used as one.
 */
const LAUNCH_TTL_SECONDS = config.SESSION_TTL_SECONDS;

/**
 * Per-user Mini App URL carrying a signed launch token.
 *
 * Telegram normally hands the app a signed `initData` payload, but some clients
 * (notably Desktop/Web opening reply-keyboard buttons) launch the URL as a plain link
 * with no payload at all. The token makes the handshake work everywhere, because WE
 * control the URL rather than depending on the client to inject anything.
 */
export function playUrl(userId: string, telegramId: bigint): string | undefined {
  if (!config.WEBAPP_URL) return undefined;
  const token = signSession(userId, telegramId, LAUNCH_TTL_SECONDS, 'launch');
  return `${config.WEBAPP_URL}?tk=${encodeURIComponent(token)}`;
}

/** Asks for the phone number — Telegram can share it with a single tap. */
export function phoneKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest('📱 Share my phone number')],
    ['❌ Cancel'],
  ]).resize();
}

/** Shown to brand-new users: registration happens in the bot, so this is plain text. */
export function registerKeyboard() {
  return Markup.keyboard([[BTN.register]]).resize();
}

/** The persistent main menu shown after registration. */
export function mainMenuKeyboard(userId: string, telegramId: bigint) {
  const url = playUrl(userId, telegramId);
  const playRow = url ? [Markup.button.webApp(BTN.play, url)] : [BTN.play];
  const rows: (string | ReturnType<typeof Markup.button.webApp>)[][] = [
    playRow,
    [BTN.deposit, BTN.withdraw],
    [BTN.balance],
    [BTN.support, BTN.instructions],
  ];
  // Admins get an extra row — everyone else never sees it.
  if (config.ADMIN_TELEGRAM_IDS.includes(String(telegramId))) rows.push([BTN.admin]);
  return Markup.keyboard(rows).resize();
}
