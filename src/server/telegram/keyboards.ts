import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import { COLUMNS, FREE, type Card } from '../types/index';

// Lobby controls shown in the chat. Host-only buttons are still shown to everyone,
// but the controller rejects presses from non-hosts (server-side authority).
// When `webAppUrl` is provided (private chats only — Telegram restricts inline
// web_app buttons to private chats), a colored Mini App "Open Board" button is added.
export function lobbyKeyboard(
  gameId: string,
  opts: { webAppUrl?: string; deepLink?: string } = {},
): Markup.Markup<InlineKeyboardMarkup> {
  const rows = [];
  // Private chats: a native web_app button. Groups: a t.me link to the Mini App
  // (Telegram forbids inline web_app buttons in groups, but allows URL buttons).
  if (opts.webAppUrl) {
    rows.push([Markup.button.webApp('🎮 Open Game Board', opts.webAppUrl)]);
  } else if (opts.deepLink) {
    rows.push([Markup.button.url('🎮 Open Game Board', opts.deepLink)]);
  }
  rows.push([
    Markup.button.callback('➕ Join Game', `join:${gameId}`),
    Markup.button.callback('🎴 View Card', `card:${gameId}`),
  ]);
  rows.push([
    Markup.button.callback('▶️ Start (host)', `start:${gameId}`),
    Markup.button.callback('🚪 Leave', `leave:${gameId}`),
  ]);
  rows.push([Markup.button.callback('🛑 Cancel (host)', `cancel:${gameId}`)]);
  return Markup.inlineKeyboard(rows);
}

// A player's tappable 5x5 card (manual daubing) + refresh / BINGO / leave.
// Cell states: 🆓 free · ✅ marked · 🔸 called-but-not-yet-marked (tap me!) · plain = not called.
export function cardKeyboard(
  gameId: string,
  card: Card,
  marked: Set<number>,
  called: Set<number> = new Set(),
): Markup.Markup<InlineKeyboardMarkup> {
  const rows = [];

  // Header row B I N G O (non-interactive).
  rows.push(COLUMNS.map((c) => Markup.button.callback(c, 'noop')));

  for (let r = 0; r < 5; r++) {
    const row = [];
    for (let c = 0; c < 5; c++) {
      const num = card[r][c];
      let label: string;
      if (num === FREE) label = '🆓';
      else if (marked.has(num)) label = `✅${num}`;
      else if (called.has(num)) label = `🔸${num}`;
      else label = `${num}`;
      row.push(Markup.button.callback(label, `daub:${gameId}:${r}:${c}`));
    }
    rows.push(row);
  }

  rows.push([
    Markup.button.callback('🔄 Refresh', `refresh:${gameId}`),
    Markup.button.callback('🎉 BINGO', `bingo:${gameId}`),
  ]);
  rows.push([Markup.button.callback('🚪 Leave', `leave:${gameId}`)]);

  return Markup.inlineKeyboard(rows);
}
