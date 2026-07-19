import type { Context } from 'telegraf';
import type { Game, User } from '@prisma/client';
import { config } from '../config/env';
import { runtime } from '../config/runtime';
import type { GameService } from '../services/GameService';
import type { StatisticsService } from '../services/StatisticsService';
import type { NotificationService } from '../services/NotificationService';
import { lobbyKeyboard } from '../telegram/keyboards';
import {
  helpText,
  leaderboardText,
  lobbyText,
  playersText,
  statusText,
} from '../telegram/render';
import { esc } from '../utils/format';

/**
 * Translates Telegram updates <-> GameService calls. Contains no game rules itself:
 * it resolves the acting user, delegates to the service, and renders the outcome.
 */
export class GameController {
  constructor(
    private readonly service: GameService,
    private readonly stats: StatisticsService,
    private readonly notifier: NotificationService,
  ) {}

  // ---- helpers ---------------------------------------------------------------

  private async user(ctx: Context): Promise<User | undefined> {
    if (!ctx.from) return undefined;
    return this.service.ensureUser({
      telegramId: BigInt(ctx.from.id),
      username: ctx.from.username ?? undefined,
      firstName: ctx.from.first_name ?? undefined,
    });
  }

  // Games can be hosted in a group/supergroup (real multiplayer) or in a private
  // chat (solo play / testing — the card is delivered to the same DM).
  private isPlayableChat(ctx: Context): boolean {
    const t = ctx.chat?.type;
    return t === 'group' || t === 'supergroup' || t === 'private';
  }

  private match(ctx: Context): RegExpExecArray {
    return (ctx as unknown as { match: RegExpExecArray }).match;
  }

  // Build the right "Open Game Board" button for the chat type.
  // Private chats (id > 0): a native web_app button opening the tunnel URL directly.
  // Groups (id < 0): a t.me deep link to the bot's Main Mini App, carrying the gameId
  // via startapp — the group-friendly way to launch the UI for every player.
  private boardButton(game: Game): { webAppUrl?: string; deepLink?: string } {
    if (!config.WEBAPP_URL) return {};
    if (game.chatId > 0n) return { webAppUrl: `${config.WEBAPP_URL}?gameId=${game.id}` };
    if (runtime.botUsername) {
      return { deepLink: `https://t.me/${runtime.botUsername}?startapp=${game.id}` };
    }
    return {};
  }

  private async sendLobby(ctx: Context, game: Game): Promise<void> {
    const players = await this.service.listPlayers(game.id);
    const sent = await ctx.reply(lobbyText(game, players), {
      parse_mode: 'HTML',
      ...lobbyKeyboard(game.id, this.boardButton(game)),
    });
    await this.service.setLobbyMessage(game.id, sent.message_id);
  }

  private async refreshLobby(game: Game): Promise<void> {
    if (!game.lobbyMessageId) return;
    const players = await this.service.listPlayers(game.id);
    await this.notifier.editText(game.chatId, game.lobbyMessageId, lobbyText(game, players), {
      reply_markup: lobbyKeyboard(game.id, this.boardButton(game)).reply_markup,
    });
  }

  // ---- commands --------------------------------------------------------------

  async onStart(ctx: Context): Promise<void> {
    await this.user(ctx);
    await ctx.reply(
      '👋 <b>Welcome to Bingo!</b>\n\nAdd me to a group and run /create to host a game.\n' +
        'Keep this DM open — your card is delivered here.\n\n' + helpText(),
      { parse_mode: 'HTML' },
    );
  }

  async onHelp(ctx: Context): Promise<void> {
    await ctx.reply(helpText(), { parse_mode: 'HTML' });
  }

  async onCreate(ctx: Context): Promise<void> {
    const user = await this.user(ctx);
    if (!user) return;
    if (!this.isPlayableChat(ctx)) {
      await ctx.reply('Please run /create inside a group chat.');
      return;
    }
    const res = await this.service.createGame(BigInt(ctx.chat!.id), user);
    if (!res.ok) {
      await ctx.reply(res.reason);
      return;
    }
    await this.sendLobby(ctx, res.game);
  }

  async onJoinCommand(ctx: Context): Promise<void> {
    const user = await this.user(ctx);
    if (!user || !this.isPlayableChat(ctx)) {
      await ctx.reply('Join from inside the group where the game was created.');
      return;
    }
    const game = await this.service.getActiveGame(BigInt(ctx.chat!.id));
    if (!game) {
      await ctx.reply('No active game here. Start one with /create.');
      return;
    }
    await this.joinFlow(ctx, game.id, false);
  }

  async onCard(ctx: Context): Promise<void> {
    const user = await this.user(ctx);
    if (!user) return;
    if (!this.isPlayableChat(ctx)) {
      await ctx.reply('Use /card in the group where you joined — I will DM your card.');
      return;
    }
    const game = await this.service.getActiveGame(BigInt(ctx.chat!.id));
    if (!game) {
      await ctx.reply('No active game here.');
      return;
    }
    const res = await this.service.viewCard(game.id, user);
    if (!res.ok) {
      await ctx.reply(res.reason);
      return;
    }
    await ctx.reply(
      res.dmOk ? '🎴 Sent your card in DM.' : '⚠️ I could not DM you — please start me in a private chat first.',
    );
  }

  async onStatus(ctx: Context): Promise<void> {
    if (!this.isPlayableChat(ctx)) return;
    const game = await this.service.getActiveGame(BigInt(ctx.chat!.id));
    if (!game) {
      await ctx.reply('No active game here. Use /create.');
      return;
    }
    const [players, called] = await Promise.all([
      this.service.listPlayers(game.id),
      this.service.countCalled(game.id),
    ]);
    await ctx.reply(statusText(game, players.length, called), { parse_mode: 'HTML' });
  }

  async onPlayers(ctx: Context): Promise<void> {
    if (!this.isPlayableChat(ctx)) return;
    const game = await this.service.getActiveGame(BigInt(ctx.chat!.id));
    if (!game) {
      await ctx.reply('No active game here.');
      return;
    }
    const players = await this.service.listPlayers(game.id);
    await ctx.reply(playersText(players), { parse_mode: 'HTML' });
  }

  async onBingoCommand(ctx: Context): Promise<void> {
    const user = await this.user(ctx);
    if (!user || !this.isPlayableChat(ctx)) return;
    const game = await this.service.getActiveGame(BigInt(ctx.chat!.id));
    if (!game) {
      await ctx.reply('No active game here.');
      return;
    }
    await this.bingoFlow(ctx, game.id, false);
  }

  async onEnd(ctx: Context): Promise<void> {
    const user = await this.user(ctx);
    if (!user || !this.isPlayableChat(ctx)) return;
    const game = await this.service.getActiveGame(BigInt(ctx.chat!.id));
    if (!game) {
      await ctx.reply('No active game to end.');
      return;
    }
    const res = await this.service.endGame(game.id, user);
    await ctx.reply(res.ok ? '🛑 Game ended.' : res.reason);
  }

  async onRestart(ctx: Context): Promise<void> {
    const user = await this.user(ctx);
    if (!user || !this.isPlayableChat(ctx)) {
      await ctx.reply('Use /restart inside the group.');
      return;
    }
    const res = await this.service.restartGame(BigInt(ctx.chat!.id), user);
    if (!res.ok) {
      await ctx.reply(res.reason);
      return;
    }
    await this.sendLobby(ctx, res.game);
  }

  async onLeaderboard(ctx: Context): Promise<void> {
    const rows = await this.stats.leaderboard(10);
    await ctx.reply(leaderboardText(rows), { parse_mode: 'HTML' });
  }

  async onStats(ctx: Context): Promise<void> {
    const user = await this.user(ctx);
    if (!user) return;
    const s = await this.stats.forUser(user.id);
    if (!s) {
      await ctx.reply('No stats yet — play a game first!');
      return;
    }
    await ctx.reply(
      `📈 <b>Your stats</b>\nPlayed: <b>${s.gamesPlayed}</b>\nWon: <b>${s.gamesWon}</b>\n` +
        `BINGOs: <b>${s.bingosCalled}</b>\nFalse BINGOs: <b>${s.falseBingos}</b>`,
      { parse_mode: 'HTML' },
    );
  }

  // ---- callback actions ------------------------------------------------------

  async onJoinAction(ctx: Context): Promise<void> {
    const gameId = this.match(ctx)[1];
    await this.joinFlow(ctx, gameId, true);
  }

  private async joinFlow(ctx: Context, gameId: string, viaButton: boolean): Promise<void> {
    const user = await this.user(ctx);
    if (!user) return;
    const res = await this.service.joinGame(gameId, user);
    if (!res.ok) {
      if (viaButton) await ctx.answerCbQuery(res.reason, { show_alert: true });
      else await ctx.reply(res.reason);
      return;
    }
    const note = res.dmOk
      ? '✅ Joined! Your card is in your DM.'
      : '✅ Joined! ⚠️ Start me in a private chat to receive your card.';
    if (viaButton) await ctx.answerCbQuery(note, { show_alert: !res.dmOk });
    else await ctx.reply(note);
    await this.refreshLobby(res.game);
  }

  async onCardAction(ctx: Context): Promise<void> {
    const gameId = this.match(ctx)[1];
    const user = await this.user(ctx);
    if (!user) return;
    const res = await this.service.viewCard(gameId, user);
    await ctx.answerCbQuery(
      res.ok
        ? res.dmOk
          ? 'Card sent to your DM.'
          : 'Start me in DM first to get your card.'
        : res.reason,
      { show_alert: !res.ok },
    );
  }

  async onStartAction(ctx: Context): Promise<void> {
    const gameId = this.match(ctx)[1];
    const user = await this.user(ctx);
    if (!user) return;
    const res = await this.service.startGame(gameId, user);
    await ctx.answerCbQuery(res.ok ? '▶️ Starting the countdown!' : res.reason, {
      show_alert: !res.ok,
    });
  }

  async onCancelAction(ctx: Context): Promise<void> {
    const gameId = this.match(ctx)[1];
    const user = await this.user(ctx);
    if (!user) return;
    const res = await this.service.endGame(gameId, user);
    await ctx.answerCbQuery(res.ok ? '🛑 Game cancelled.' : res.reason, { show_alert: !res.ok });
  }

  async onLeaveAction(ctx: Context): Promise<void> {
    const gameId = this.match(ctx)[1];
    const user = await this.user(ctx);
    if (!user) return;
    const res = await this.service.leaveGame(gameId, user);
    await ctx.answerCbQuery(res.ok ? '🚪 You left the game.' : res.reason);
    if (res.ok && !res.cancelled) {
      const game = await this.service.getGame(gameId);
      if (game) await this.refreshLobby(game);
    }
  }

  async onDaubAction(ctx: Context): Promise<void> {
    const m = this.match(ctx);
    const gameId = m[1];
    const row = Number(m[2]);
    const col = Number(m[3]);
    const user = await this.user(ctx);
    if (!user) return;
    const res = await this.service.daub(gameId, user, row, col);
    await ctx.answerCbQuery(res.ok ? `Marked ${res.number} ✅` : res.reason);
  }

  async onRefreshAction(ctx: Context): Promise<void> {
    const gameId = this.match(ctx)[1];
    const user = await this.user(ctx);
    if (!user) return;
    const res = await this.service.refreshCard(gameId, user);
    await ctx.answerCbQuery(res.ok ? '🔄 Refreshed' : res.reason);
  }

  async onBingoAction(ctx: Context): Promise<void> {
    const gameId = this.match(ctx)[1];
    await this.bingoFlow(ctx, gameId, true);
  }

  private async bingoFlow(ctx: Context, gameId: string, viaButton: boolean): Promise<void> {
    const user = await this.user(ctx);
    if (!user) return;
    const res = await this.service.claimBingo(gameId, user);

    if (res.ok) {
      const msg = '🎉 BINGO! You win! 🏆';
      if (viaButton) await ctx.answerCbQuery(msg, { show_alert: true });
      else await ctx.reply(msg);
      return;
    }

    let msg: string;
    if (res.reason === 'invalid') msg = "❌ Invalid Bingo!\nYou don't currently have a valid Bingo.";
    else if (res.reason === 'cooldown') msg = `⏳ Cooldown — wait ${res.retryAfterSec}s before trying again.`;
    else msg = res.reason;

    if (viaButton) await ctx.answerCbQuery(msg, { show_alert: true });
    else await ctx.reply(esc(msg));
  }

  async onNoop(ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
  }
}
