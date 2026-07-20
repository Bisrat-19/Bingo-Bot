import type { Context, Telegraf } from 'telegraf';
import type { RoomService } from '../services/RoomService';
import type { StatisticsService } from '../services/StatisticsService';
import { BTN, mainMenuKeyboard, registerKeyboard } from '../telegram/menus';
import { displayName, esc } from '../utils/format';

// The bot is the entry point; the game itself lives in the Mini App (one continuous room).

const HELP = [
  '🎲 <b>Bingo 75 — how it works</b>',
  '',
  '1️⃣ Pick one of the <b>100 cards</b> — one card per player.',
  '2️⃣ When the first player picks, a countdown starts.',
  '3️⃣ The round starts automatically and numbers are called.',
  '4️⃣ Mark called numbers, complete a line, and press <b>BINGO</b> first to win!',
  '',
  '⚠️ You must press BINGO on the number that <b>completes</b> your line — if another',
  'number is called first, that line has passed and you need a different pattern.',
  '',
  'The room never stops — a new round begins right after each winner.',
].join('\n');

// Placeholder replies for the menu items that aren't built yet.
const COMING_SOON: Record<string, string> = {
  [BTN.deposit]: '💰 <b>Deposit</b>\n\nComing soon.',
  [BTN.withdraw]: '💸 <b>Withdraw</b>\n\nComing soon.',
  [BTN.balance]: '💳 <b>Balance</b>\n\nComing soon.',
  [BTN.support]: '📞 <b>Support</b>\n\nComing soon.',
};

export function registerHandlers(
  bot: Telegraf,
  room: RoomService,
  stats: StatisticsService,
  _getBotUsername: () => string | undefined,
): void {
  const ensure = async (ctx: Context) => {
    if (!ctx.from) return null;
    return room.ensureUser({
      telegramId: BigInt(ctx.from.id),
      username: ctx.from.username ?? undefined,
      firstName: ctx.from.first_name ?? undefined,
    });
  };

  bot.start(async (ctx) => {
    const user = await ensure(ctx);
    if (!user) return;

    if (!user.registered) {
      const kb = registerKeyboard();
      await ctx.reply(
        `👋 <b>Welcome to Bingo 75!</b>\n\nTap <b>${BTN.register}</b> below to create your account — one tap, using your Telegram profile.`,
        { parse_mode: 'HTML', ...(kb ?? {}) },
      );
      return;
    }

    const kb = mainMenuKeyboard(user.id, user.telegramId);
    await ctx.reply(
      `👋 <b>Welcome back, ${esc(user.firstName ?? 'player')}!</b>\n\nTap <b>${BTN.play}</b> to join the live room.`,
      { parse_mode: 'HTML', ...(kb ?? {}) },
    );
  });

  // Registration happens entirely in the bot — one tap, using their Telegram account.
  bot.hears(BTN.register, async (ctx) => {
    const user = await ensure(ctx);
    if (!user) return;
    const kb = mainMenuKeyboard(user.id, user.telegramId);

    if (user.registered) {
      await ctx.reply('✅ You are already registered.', { ...(kb ?? {}) });
      return;
    }

    const updated = await room.register(user);
    const menu = mainMenuKeyboard(updated.id, updated.telegramId);
    await ctx.reply(
      `✅ <b>Registration complete!</b>\n\nWelcome, ${esc(updated.firstName ?? 'player')} — you start with <b>${updated.coins}</b> coins.\n\nTap <b>${BTN.play}</b> to join the live Bingo room.`,
      { parse_mode: 'HTML', ...(menu ?? {}) },
    );
  });

  bot.help((ctx) => ctx.reply(HELP, { parse_mode: 'HTML' }));

  bot.command('menu', async (ctx) => {
    const user = await ensure(ctx);
    if (!user) return;
    const kb = user.registered ? mainMenuKeyboard(user.id, user.telegramId) : registerKeyboard();
    await ctx.reply(user.registered ? 'Main menu:' : `Tap ${BTN.register} to get started:`, {
      ...(kb ?? {}),
    });
  });

  // Instructions is the one placeholder with real content.
  bot.hears(BTN.instructions, (ctx) => ctx.reply(HELP, { parse_mode: 'HTML' }));

  // Everything else that isn't built yet — one handler, O(1) lookup.
  bot.hears(Object.keys(COMING_SOON), async (ctx) => {
    const user = await ensure(ctx);
    if (!user?.registered) {
      const kb = registerKeyboard();
      await ctx.reply(`Please tap ${BTN.register} first.`, { ...(kb ?? {}) });
      return;
    }
    await ctx.reply(COMING_SOON[ctx.message.text] ?? 'Coming soon.', {
      parse_mode: 'HTML',
      ...(mainMenuKeyboard(user.id, user.telegramId) ?? {}),
    });
  });

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
  { command: 'start', description: 'Start / open the menu' },
  { command: 'menu', description: 'Show the main menu' },
  { command: 'stats', description: 'Your statistics' },
  { command: 'leaderboard', description: 'Top winners' },
  { command: 'help', description: 'How to play' },
];
