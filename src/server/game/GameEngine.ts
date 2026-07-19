import type { Game } from '@prisma/client';
import type { Logger } from '../config/logger';
import type { CalledNumberRepository } from '../repositories/calledNumber.repository';
import type { GameRepository } from '../repositories/game.repository';
import type { PlayerRepository } from '../repositories/player.repository';
import type { NotificationService } from '../services/NotificationService';
import type { StatisticsService } from '../services/StatisticsService';
import { boardText, noWinnerText } from '../telegram/render';
import type { Card } from '../types/index';
import { NumberCaller } from './NumberCaller';
import { TimerService } from './TimerService';

/**
 * Owns the *time-driven* lifecycle of a running game: the pre-game countdown and the
 * automatic number-calling loop. It does NOT decide winners — that happens in
 * GameService when a player presses BINGO. The engine only stops when told to (a
 * winner was claimed / game cancelled) or when the 75-ball pool is exhausted.
 */
export class GameEngine {
  // Guards against overlapping draw ticks for the same game (interval re-entrancy).
  private drawing = new Set<string>();
  // The pinned "live board" message per game, so we can edit it in place each draw.
  private boards = new Map<string, { chatId: bigint; messageId: number }>();
  // Epoch-ms when each game's countdown ends (for the Mini App to render a timer).
  private countdownEnds = new Map<string, number>();

  /** Seconds left in the countdown, or null if this game isn't counting down. */
  getCountdownLeft(gameId: string): number | null {
    const end = this.countdownEnds.get(gameId);
    if (!end) return null;
    return Math.max(0, Math.ceil((end - Date.now()) / 1000));
  }

  constructor(
    private readonly gameRepo: GameRepository,
    private readonly playerRepo: PlayerRepository,
    private readonly calledRepo: CalledNumberRepository,
    private readonly stats: StatisticsService,
    private readonly notifier: NotificationService,
    private readonly caller: NumberCaller,
    private readonly timers: TimerService,
    private readonly logger: Logger,
  ) {}

  /** Begin the countdown, then automatically transition into number-calling. */
  async startCountdown(gameId: string): Promise<void> {
    const game = await this.gameRepo.findById(gameId);
    if (!game) return;

    await this.gameRepo.setStatus(gameId, 'COUNTDOWN');
    let left = game.countdownSec;
    this.countdownEnds.set(gameId, Date.now() + left * 1000);
    const msgId = await this.notifier.sendCountdown(game.chatId, left);

    this.timers.setInterval(
      gameId,
      () => {
        void (async () => {
          left -= 1;
          if (left <= 0) {
            this.timers.clearInterval(gameId);
            await this.beginDrawing(gameId);
            return;
          }
          // Edit sparingly to respect Telegram rate limits.
          if (msgId && (left % 5 === 0 || left <= 5)) {
            await this.notifier.updateCountdown(game.chatId, msgId, left);
          }
        })().catch((err) => this.logger.error({ err, gameId }, 'countdown tick failed'));
      },
      1000,
    );
  }

  private async beginDrawing(gameId: string): Promise<void> {
    const game = await this.gameRepo.findById(gameId);
    if (!game || game.status === 'FINISHED' || game.status === 'CANCELLED') return;

    this.countdownEnds.delete(gameId);
    await this.gameRepo.update(gameId, { status: 'PLAYING', startedAt: new Date() });

    // Everyone who reached the PLAYING phase counts as having played a game.
    const players = await this.playerRepo.listByGame(gameId);
    await this.stats.recordGamePlayed(players.map((p) => p.userId));

    await this.notifier.sendToChat(
      game.chatId,
      '🎬 <b>The game has begun!</b> Watch the pinned board 👆 and daub your cards 👇',
    );

    // Create the live board and pin it to the top of the chat.
    const board = await this.notifier.sendToChat(game.chatId, boardText([]));
    if (board) {
      this.boards.set(gameId, { chatId: game.chatId, messageId: board.message_id });
      await this.notifier.pin(game.chatId, board.message_id);
    }

    this.timers.setInterval(gameId, () => void this.drawTick(gameId), game.intervalMs);
    await this.drawTick(gameId); // draw the first ball immediately
  }

  private async drawTick(gameId: string): Promise<void> {
    if (this.drawing.has(gameId)) return; // skip if a previous tick is still running
    this.drawing.add(gameId);
    try {
      const game = await this.gameRepo.findById(gameId);
      if (!game || game.status !== 'PLAYING') {
        this.timers.clearAll(gameId);
        return;
      }

      const called = await this.calledRepo.listNumbers(gameId);
      const next = this.caller.drawNext(called);

      if (next === null) {
        this.timers.clearAll(gameId);
        await this.endWithoutWinner(gameId, game.chatId);
        return;
      }

      const order = called.length + 1;
      await this.calledRepo.add(gameId, next, order);
      await this.gameRepo.setCurrentNumber(gameId, next);

      const updatedCalled = [...called, next];
      // Update the pinned live board with the new current number + history.
      const board = this.boards.get(gameId);
      if (board) await this.notifier.editText(board.chatId, board.messageId, boardText(updatedCalled));
      // Light up newly-called numbers (🔸) on every player's card.
      await this.refreshAllCards(gameId, game, updatedCalled);
    } catch (err) {
      this.logger.error({ err, gameId }, 'drawTick failed');
    } finally {
      this.drawing.delete(gameId);
    }
  }

  // Re-render every active player's card so newly-called numbers are highlighted.
  private async refreshAllCards(gameId: string, game: Game, called: number[]): Promise<void> {
    const players = await this.playerRepo.listByGame(gameId);
    const calledSet = new Set(called);
    for (const p of players) {
      if (!p.cardMessageId) continue;
      const card = p.card as unknown as Card;
      await this.notifier.refreshCard(
        p.user.telegramId,
        p.cardMessageId,
        game,
        card,
        new Set(p.markedNumbers),
        calledSet,
      );
    }
  }

  private async endWithoutWinner(gameId: string, chatId: bigint): Promise<void> {
    await this.gameRepo.update(gameId, { status: 'FINISHED', endedAt: new Date() });
    this.stop(gameId);
    await this.notifier.sendToChat(chatId, noWinnerText());
  }

  /** Stop all timers for a game (called when a winner is confirmed or game cancelled). */
  stop(gameId: string): void {
    this.timers.clearAll(gameId);
    this.drawing.delete(gameId);
    this.countdownEnds.delete(gameId);
    const board = this.boards.get(gameId);
    if (board) {
      void this.notifier.unpin(board.chatId, board.messageId);
      this.boards.delete(gameId);
    }
  }
}
