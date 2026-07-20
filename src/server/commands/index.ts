import { Markup, type Context, type Telegraf } from 'telegraf';
import { config } from '../config/env';
import type { RoomService } from '../services/RoomService';
import type { StatisticsService } from '../services/StatisticsService';
import { displayName, esc } from '../utils/format';

// The bot is just the entry point now — the game itself lives in the Mini App, which
// runs one continuous room shared by everybody.

function playKeyboard(botUsername: string | undefined, isPrivate: boolean) {
  if (!config.WEBAPP_URL) return undefined;
  // Inline web_app buttons are only allowed in private chats; groups get a t.me link.
  if (isPrivate) {
    return Markup.inlineKeyboard([[Markup.button.webApp('🎮 Play Bingo', config.WEBAPP_URL)]]);
  }
  if (botUsername) {
    return Markup.inlineKeyboard([[Markup.button.url('🎮 Play Bingo', `https://t.me/${botUsername}`)]]);
  }
  return undefined;
}

const HELP = [
  '🎲 <b>Bingo 75 — how it works</b>',
  '',
  'Tap <b>Play Bingo</b> to open the game.',
  '',
  '1️⃣ Pick one of the <b>100 cards</b> — one card per player.',
  '2️⃣ When the first player picks, a <b>30-second</b> timer starts.',
  '3️⃣ The round then starts automatically and numbers are called.',
  '4️⃣ Mark called numbers, complete a line, and press <b>BINGO</b> first to win!',
  '',
  'The room never stops — a new round begins right after each winner.',
].join('\n');

export function registerHandlers(
  bot: Telegraf,
  room: RoomService,
  stats: StatisticsService,
  getBotUsername: () => string | undefined,
): void {
  const ensure = async (ctx: Context) => {
    if (!ctx.from) return null;
    return room.ensureUser({
      telegramId: BigInt(ctx.from.id),
      username: ctx.from.username ?? undefined,
      firstName: ctx.from.first_name ?? undefined,
    });
  };

  const sendPlay = async (ctx: Context, text: string) => {
    const kb = playKeyboard(getBotUsername(), ctx.chat?.type === 'private');
    await ctx.reply(text, { parse_mode: 'HTML', ...(kb ?? {}) });
  };

  bot.start(async (ctx) => {
    await ensure(ctx);
    await sendPlay(ctx, `👋 <b>Welcome to Bingo 75!</b>\n\n${HELP}`);
  });

  bot.help((ctx) => sendPlay(ctx, HELP));
  bot.command('play', (ctx) => sendPlay(ctx, '🎮 Tap below to join the live Bingo room:'));

  bot.command('stats', async (ctx) => {
    const user = await ensure(ctx);
    if (!user) return;
    const s = await stats.forUser(user.id);
    if (!s) {
      await ctx.reply('No stats yet — play a round first!');
      return;
    }
    await ctx.reply(
      `📈 <b>Your stats</b>\nPlayed: <b>${s.gamesPlayed}</b>\nWon: <b>${s.gamesWon}</b>\n` +
        `BINGOs: <b>${s.bingosCalled}</b>\nFalse BINGOs: <b>${s.falseBingos}</b>`,
      { parse_mode: 'HTML' },
    );
  });

  bot.command('leaderboard', async (ctx) => {
    const rows = await stats.leaderboard(10);
    if (rows.length === 0) {
      await ctx.reply('🏅 No rounds have been played yet.');
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map(
      (r, i) =>
        `${medals[i] ?? `${i + 1}.`} ${esc(displayName(r.user))} — <b>${r.gamesWon}</b> wins / ${r.gamesPlayed} played`,
    );
    await ctx.reply(['🏅 <b>Leaderboard</b>', ...lines].join('\n'), { parse_mode: 'HTML' });
  });
}

export const COMMAND_MENU = [
  { command: 'play', description: 'Open the live Bingo room' },
  { command: 'stats', description: 'Your statistics' },
  { command: 'leaderboard', description: 'Top winners' },
  { command: 'help', description: 'How to play' },
];
