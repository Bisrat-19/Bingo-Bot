import type { Telegraf } from 'telegraf';
import type { GameController } from '../controllers/GameController';

// Wires every command and inline-button callback to a controller method.
// Kept in one place so the bot's surface area is easy to audit.
export function registerHandlers(bot: Telegraf, c: GameController): void {
  // Commands
  bot.start((ctx) => c.onStart(ctx));
  bot.help((ctx) => c.onHelp(ctx));
  bot.command('create', (ctx) => c.onCreate(ctx));
  bot.command('join', (ctx) => c.onJoinCommand(ctx));
  bot.command('card', (ctx) => c.onCard(ctx));
  bot.command('status', (ctx) => c.onStatus(ctx));
  bot.command('players', (ctx) => c.onPlayers(ctx));
  bot.command('bingo', (ctx) => c.onBingoCommand(ctx));
  bot.command('end', (ctx) => c.onEnd(ctx));
  bot.command('restart', (ctx) => c.onRestart(ctx));
  bot.command('leaderboard', (ctx) => c.onLeaderboard(ctx));
  bot.command('stats', (ctx) => c.onStats(ctx));

  // Inline-button callbacks. `daub` is registered first as it has the most specific shape.
  bot.action(/^daub:([^:]+):(\d):(\d)$/, (ctx) => c.onDaubAction(ctx));
  bot.action(/^join:(.+)$/, (ctx) => c.onJoinAction(ctx));
  bot.action(/^card:(.+)$/, (ctx) => c.onCardAction(ctx));
  bot.action(/^start:(.+)$/, (ctx) => c.onStartAction(ctx));
  bot.action(/^cancel:(.+)$/, (ctx) => c.onCancelAction(ctx));
  bot.action(/^leave:(.+)$/, (ctx) => c.onLeaveAction(ctx));
  bot.action(/^refresh:(.+)$/, (ctx) => c.onRefreshAction(ctx));
  bot.action(/^bingo:(.+)$/, (ctx) => c.onBingoAction(ctx));
  bot.action('noop', (ctx) => c.onNoop(ctx));
}

// The slash-command menu shown in Telegram's UI.
export const COMMAND_MENU = [
  { command: 'create', description: 'Create a new Bingo game' },
  { command: 'join', description: 'Join the current game' },
  { command: 'card', description: 'Get your card (in DM)' },
  { command: 'status', description: 'Show game status' },
  { command: 'players', description: 'List players' },
  { command: 'bingo', description: 'Claim a BINGO' },
  { command: 'end', description: 'Host: end the game' },
  { command: 'restart', description: 'Host: start a fresh game' },
  { command: 'leaderboard', description: 'Top winners' },
  { command: 'stats', description: 'Your statistics' },
  { command: 'help', description: 'How to play' },
];
