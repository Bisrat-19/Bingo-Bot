import { GameStatus, type Game, type User } from '@prisma/client';
import { config } from '../config/env';
import type { Logger } from '../config/logger';
import { BingoValidator } from '../game/BingoValidator';
import { CardGenerator } from '../game/CardGenerator';
import { GameEngine } from '../game/GameEngine';
import type { CalledNumberRepository } from '../repositories/calledNumber.repository';
import type { GameRepository } from '../repositories/game.repository';
import type { PlayerRepository } from '../repositories/player.repository';
import type { UserRepository } from '../repositories/user.repository';
import type { WinnerRepository } from '../repositories/winner.repository';
import { winnerText } from '../telegram/render';
import { displayName } from '../utils/format';
import { FREE, WinningPattern, type Card, type TgUser } from '../types/index';
import type { KeyedMutex } from '../utils/Mutex';
import type { NotificationService } from './NotificationService';
import type { StatisticsService } from './StatisticsService';

const ALL_PATTERNS = [
  WinningPattern.HORIZONTAL,
  WinningPattern.VERTICAL,
  WinningPattern.DIAGONAL,
];

// Discriminated result the controller maps to a Telegram reply / callback answer.
export type ServiceResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: string; retryAfterSec?: number };

// Snapshot consumed by the Mini App frontend.
export interface WebState {
  gameId: string;
  status: string;
  currentNumber: number | null;
  called: number[];
  countdownLeft: number | null;
  minPlayers: number;
  isHost: boolean;
  joined: boolean;
  card: Card | null;
  marked: number[];
  hasBingo: boolean;
  players: { name: string; marks: number; hasBingo: boolean; isWinner: boolean }[];
  winner: { name: string } | null;
}

/**
 * Application service: all Bingo business rules live here. It coordinates repositories,
 * the game engine, validation, and notifications, and enforces state transitions.
 */
export class GameService {
  constructor(
    private readonly users: UserRepository,
    private readonly games: GameRepository,
    private readonly players: PlayerRepository,
    private readonly called: CalledNumberRepository,
    private readonly winners: WinnerRepository,
    private readonly stats: StatisticsService,
    private readonly notifier: NotificationService,
    private readonly engine: GameEngine,
    private readonly cardGen: CardGenerator,
    private readonly validator: BingoValidator,
    private readonly mutex: KeyedMutex,
    private readonly logger: Logger,
  ) {}

  // Per-(game,user) false-bingo cooldown timestamps (ms epoch). In-process is fine:
  // a cooldown is a soft anti-spam measure, not a correctness guarantee.
  private cooldowns = new Map<string, number>();

  ensureUser(tg: TgUser): Promise<User> {
    return this.users.upsertFromTelegram(tg);
  }

  private enabledPatterns(game: Game): WinningPattern[] {
    if (!game.patterns?.length) return ALL_PATTERNS;
    const valid = game.patterns.filter((p): p is WinningPattern =>
      ALL_PATTERNS.includes(p as WinningPattern),
    );
    return valid.length ? valid : ALL_PATTERNS;
  }

  getActiveGame(chatId: bigint): Promise<Game | null> {
    return this.games.findActiveByChat(chatId);
  }

  getGame(gameId: string): Promise<Game | null> {
    return this.games.findById(gameId);
  }

  listPlayers(gameId: string) {
    return this.players.listByGame(gameId);
  }

  countCalled(gameId: string): Promise<number> {
    return this.called.count(gameId);
  }

  setLobbyMessage(gameId: string, messageId: number): Promise<Game> {
    return this.games.update(gameId, { lobbyMessageId: messageId });
  }

  // ---- Mini App (Web App) ----------------------------------------------------

  // Full snapshot the Mini App renders. `user` is optional so a spectator can view
  // the board before joining.
  async getWebState(gameId: string, user?: User): Promise<WebState | null> {
    const game = await this.games.findById(gameId);
    if (!game) return null;

    const [called, players] = await Promise.all([
      this.called.listNumbers(gameId),
      this.players.listByGame(gameId),
    ]);

    const me = user ? players.find((p) => p.userId === user.id) : undefined;
    const winnerRow = game.winnerId ? players.find((p) => p.userId === game.winnerId) : undefined;

    return {
      gameId: game.id,
      status: game.status,
      currentNumber: game.currentNumber,
      called,
      countdownLeft: this.engine.getCountdownLeft(gameId),
      minPlayers: game.minPlayers,
      isHost: user ? game.hostId === user.id : false,
      joined: Boolean(me),
      card: me ? (me.card as unknown as Card) : null,
      marked: me ? me.markedNumbers : [],
      hasBingo: me ? me.hasBingo : false,
      players: players.map((p) => ({
        name: displayName(p.user),
        marks: p.markedNumbers.length,
        hasBingo: p.hasBingo,
        isWinner: p.userId === game.winnerId,
      })),
      winner: winnerRow ? { name: displayName(winnerRow.user) } : null,
    };
  }

  // Mark by number (used by the Mini App, which knows the number, not the cell).
  async markByNumber(
    gameId: string,
    user: User,
    number: number,
  ): Promise<ServiceResult<{ number: number }>> {
    const game = await this.games.findById(gameId);
    if (!game) return { ok: false, reason: 'Game not found.' };
    if (game.status !== GameStatus.PLAYING) return { ok: false, reason: 'The game is not running.' };

    const player = await this.players.findByGameAndUser(gameId, user.id);
    if (!player || player.leftAt) return { ok: false, reason: 'You are not in this game.' };

    const card = player.card as unknown as Card;
    if (!card.some((row) => row.includes(number))) {
      return { ok: false, reason: 'That number is not on your card.' };
    }
    if (player.markedNumbers.includes(number)) return { ok: true, number }; // idempotent

    const calledNumbers = await this.called.listNumbers(gameId);
    if (!calledNumbers.includes(number)) return { ok: false, reason: `${number} not called yet.` };

    await this.players.addMark(player.id, number);
    const marked = new Set([...player.markedNumbers, number]);
    const result = this.validator.validate(card, [...marked], calledNumbers, this.enabledPatterns(game));
    if (result.won && !player.hasBingo) await this.players.setHasBingo(player.id, true);

    // Keep any Telegram card message in sync too (best effort).
    if (player.cardMessageId) {
      await this.notifier.refreshCard(
        user.telegramId,
        player.cardMessageId,
        game,
        card,
        marked,
        new Set(calledNumbers),
      );
    }
    return { ok: true, number };
  }

  // ---- Lobby -----------------------------------------------------------------

  async createGame(chatId: bigint, host: User): Promise<ServiceResult<{ game: Game }>> {
    const existing = await this.games.findActiveByChat(chatId);
    if (existing) return { ok: false, reason: 'A game is already running in this chat. Use /status or /end.' };

    const game = await this.games.create({
      chatId,
      hostId: host.id,
      intervalMs: config.DRAW_INTERVAL_SECONDS * 1000,
      countdownSec: config.COUNTDOWN_SECONDS,
      minPlayers: config.MIN_PLAYERS,
      maxPlayers: config.MAX_PLAYERS,
      patterns: ALL_PATTERNS,
    });
    return { ok: true, game };
  }

  async joinGame(gameId: string, user: User): Promise<ServiceResult<{ game: Game; dmOk: boolean }>> {
    const game = await this.games.findById(gameId);
    if (!game) return { ok: false, reason: 'Game not found.' };
    if (game.status !== GameStatus.WAITING_FOR_PLAYERS && game.status !== GameStatus.CARD_GENERATED) {
      return { ok: false, reason: 'This game has already started — you can no longer join.' };
    }

    const existing = await this.players.findByGameAndUser(gameId, user.id);
    if (existing && !existing.leftAt) return { ok: false, reason: 'You already joined this game.' };

    const count = await this.players.countActive(gameId);
    if (count >= game.maxPlayers) return { ok: false, reason: 'This game is full.' };

    const card = this.cardGen.generate();
    const player = await this.players.add(gameId, user.id, card);

    // First join generates cards -> move to CARD_GENERATED.
    if (game.status === GameStatus.WAITING_FOR_PLAYERS) {
      await this.games.setStatus(gameId, GameStatus.CARD_GENERATED);
    }

    const msgId = await this.notifier.sendCard(user.telegramId, game, card, new Set());
    if (msgId) await this.players.setCardMessageId(player.id, msgId);

    return { ok: true, game, dmOk: msgId !== null };
  }

  // Re-send a fresh card message to the player's DM (used by /card and View Card).
  async viewCard(gameId: string, user: User): Promise<ServiceResult<{ dmOk: boolean }>> {
    const game = await this.games.findById(gameId);
    if (!game) return { ok: false, reason: 'Game not found.' };
    const player = await this.players.findByGameAndUser(gameId, user.id);
    if (!player || player.leftAt) return { ok: false, reason: 'You are not in this game. Tap Join first.' };

    const card = player.card as unknown as Card;
    const marked = new Set(player.markedNumbers);
    const called = new Set(await this.called.listNumbers(gameId));
    const msgId = await this.notifier.sendCard(user.telegramId, game, card, marked, called);
    if (msgId) await this.players.setCardMessageId(player.id, msgId);
    return { ok: true, dmOk: msgId !== null };
  }

  async startGame(gameId: string, user: User): Promise<ServiceResult> {
    const game = await this.games.findById(gameId);
    if (!game) return { ok: false, reason: 'Game not found.' };
    if (game.hostId !== user.id) return { ok: false, reason: 'Only the host can start the game.' };
    if (game.status !== GameStatus.WAITING_FOR_PLAYERS && game.status !== GameStatus.CARD_GENERATED) {
      return { ok: false, reason: 'The game cannot be started from its current state.' };
    }
    const count = await this.players.countActive(gameId);
    if (count < game.minPlayers) {
      return { ok: false, reason: `Need at least ${game.minPlayers} players to start (have ${count}).` };
    }

    await this.engine.startCountdown(gameId);
    return { ok: true };
  }

  // ---- In-play actions -------------------------------------------------------

  async daub(
    gameId: string,
    user: User,
    row: number,
    col: number,
  ): Promise<ServiceResult<{ number: number }>> {
    const game = await this.games.findById(gameId);
    if (!game) return { ok: false, reason: 'Game not found.' };
    if (game.status !== GameStatus.PLAYING) return { ok: false, reason: 'The game is not running.' };

    const player = await this.players.findByGameAndUser(gameId, user.id);
    if (!player || player.leftAt) return { ok: false, reason: 'You are not in this game.' };

    const card = player.card as unknown as Card;
    const number = card[row]?.[col];
    if (number === undefined) return { ok: false, reason: 'Invalid cell.' };
    if (number === FREE) return { ok: false, reason: 'That is the FREE space.' };
    if (player.markedNumbers.includes(number)) return { ok: false, reason: 'Already marked.' };

    const calledNumbers = await this.called.listNumbers(gameId);
    if (!calledNumbers.includes(number)) {
      return { ok: false, reason: `${number} has not been called yet!` };
    }

    await this.players.addMark(player.id, number);
    const marked = new Set([...player.markedNumbers, number]);

    // Informational only — completing a line does NOT auto-win.
    const result = this.validator.validate(
      card,
      [...marked],
      calledNumbers,
      this.enabledPatterns(game),
    );
    if (result.won && !player.hasBingo) await this.players.setHasBingo(player.id, true);

    if (player.cardMessageId) {
      await this.notifier.refreshCard(
        user.telegramId,
        player.cardMessageId,
        game,
        card,
        marked,
        new Set(calledNumbers),
      );
    }
    return { ok: true, number };
  }

  async refreshCard(gameId: string, user: User): Promise<ServiceResult> {
    const game = await this.games.findById(gameId);
    if (!game) return { ok: false, reason: 'Game not found.' };
    const player = await this.players.findByGameAndUser(gameId, user.id);
    if (!player || player.leftAt || !player.cardMessageId) {
      return { ok: false, reason: 'No card to refresh.' };
    }
    const card = player.card as unknown as Card;
    const called = new Set(await this.called.listNumbers(gameId));
    await this.notifier.refreshCard(
      user.telegramId,
      player.cardMessageId,
      game,
      card,
      new Set(player.markedNumbers),
      called,
    );
    return { ok: true };
  }

  /**
   * THE mandatory rule: the FIRST valid BINGO press wins — not the first completed card.
   * Serialized per game by an in-process mutex, and finalized by an atomic conditional
   * DB update so that even across multiple processes exactly one winner is committed.
   */
  async claimBingo(
    gameId: string,
    user: User,
  ): Promise<ServiceResult<{ pattern: WinningPattern }>> {
    return this.mutex.runExclusive(`game:${gameId}`, async () => {
      const game = await this.games.findById(gameId);
      if (!game) return { ok: false, reason: 'Game not found.' };
      if (game.status !== GameStatus.PLAYING) {
        return { ok: false, reason: 'The game is not accepting BINGO right now.' };
      }

      const player = await this.players.findByGameAndUser(gameId, user.id);
      if (!player || player.leftAt) return { ok: false, reason: 'You are not in this game.' };

      // False-bingo cooldown.
      const key = `${gameId}:${user.id}`;
      const until = this.cooldowns.get(key);
      const now = Date.now();
      if (until && until > now) {
        return { ok: false, reason: 'cooldown', retryAfterSec: Math.ceil((until - now) / 1000) };
      }

      const calledNumbers = await this.called.listNumbers(gameId);
      const card = player.card as unknown as Card;
      const result = this.validator.validate(
        card,
        player.markedNumbers,
        calledNumbers,
        this.enabledPatterns(game),
      );

      if (!result.won || !result.pattern) {
        // Invalid BINGO -> apply cooldown penalty + record.
        if (config.FALSE_BINGO_COOLDOWN_SECONDS > 0) {
          this.cooldowns.set(key, now + config.FALSE_BINGO_COOLDOWN_SECONDS * 1000);
        }
        await this.stats.recordFalseBingo(user.id);
        return { ok: false, reason: 'invalid' };
      }

      // Atomic winner claim. If another press already won, count === 0 here.
      const claimed = await this.games.claimWinner(gameId, user.id);
      if (!claimed) return { ok: false, reason: 'Someone already won this game!' };

      // We are the sole winner — stop the engine and persist results.
      this.engine.stop(gameId);
      const numbersCalled = calledNumbers.length;
      const durationMs = game.startedAt ? now - game.startedAt.getTime() : 0;

      await this.winners.create({
        gameId,
        userId: user.id,
        pattern: result.pattern,
        numbersCalled,
        durationMs,
      });
      await this.players.setHasBingo(player.id, true);
      await this.stats.recordBingoCalled(user.id);
      await this.stats.recordWin(user.id);

      await this.notifier.sendToChat(
        game.chatId,
        winnerText(user, result.pattern, numbersCalled, durationMs, game.currentNumber),
      );

      this.logger.info({ gameId, userId: user.id, pattern: result.pattern }, 'winner confirmed');
      return { ok: true, pattern: result.pattern };
    });
  }

  // ---- Leaving / ending ------------------------------------------------------

  async leaveGame(gameId: string, user: User): Promise<ServiceResult<{ cancelled: boolean }>> {
    const game = await this.games.findById(gameId);
    if (!game) return { ok: false, reason: 'Game not found.' };
    const player = await this.players.findByGameAndUser(gameId, user.id);
    if (!player || player.leftAt) return { ok: false, reason: 'You are not in this game.' };

    await this.players.leave(player.id);

    // Host leaving before the game starts cancels the lobby.
    const preStart =
      game.status === GameStatus.WAITING_FOR_PLAYERS || game.status === GameStatus.CARD_GENERATED;
    if (game.hostId === user.id && preStart) {
      await this.cancelInternal(game, 'The host left — game cancelled.');
      return { ok: true, cancelled: true };
    }
    return { ok: true, cancelled: false };
  }

  async endGame(gameId: string, user: User): Promise<ServiceResult> {
    const game = await this.games.findById(gameId);
    if (!game) return { ok: false, reason: 'Game not found.' };
    if (game.hostId !== user.id) return { ok: false, reason: 'Only the host can end the game.' };
    if (game.status === GameStatus.FINISHED || game.status === GameStatus.CANCELLED) {
      return { ok: false, reason: 'The game has already ended.' };
    }
    await this.cancelInternal(game, 'The host ended the game.');
    return { ok: true };
  }

  private async cancelInternal(game: Game, message: string): Promise<void> {
    this.engine.stop(game.id);
    await this.games.update(game.id, { status: GameStatus.CANCELLED, endedAt: new Date() });
    await this.notifier.sendToChat(game.chatId, `🛑 ${message}`);
  }

  async restartGame(chatId: bigint, user: User): Promise<ServiceResult<{ game: Game }>> {
    const active = await this.games.findActiveByChat(chatId);
    if (active) {
      if (active.hostId !== user.id) {
        return { ok: false, reason: 'Only the current host can restart the game.' };
      }
      await this.cancelInternal(active, 'Restarting…');
    }
    return this.createGame(chatId, user);
  }

  // ---- Recovery on boot ------------------------------------------------------

  /**
   * On startup, any game left mid-flight has lost its in-memory timers, so we can't
   * resume its draw loop safely. Cancel such games and notify the chat.
   */
  async recoverStaleGames(): Promise<number> {
    const stale = await this.games.findAllActive();
    for (const game of stale) {
      try {
        await this.games.update(game.id, { status: GameStatus.CANCELLED, endedAt: new Date() });
        await this.notifier.sendToChat(
          game.chatId,
          '🔄 The bot restarted, so the in-progress game was cancelled. Use /create to start a new one.',
        );
      } catch (err) {
        this.logger.warn({ err, gameId: game.id }, 'failed to recover stale game');
      }
    }
    if (stale.length) this.logger.info({ count: stale.length }, 'cancelled stale games on boot');
    return stale.length;
  }
}
