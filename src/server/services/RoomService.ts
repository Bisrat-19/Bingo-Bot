import type { User } from '@prisma/client';
import { config } from '../config/env';
import type { Logger } from '../config/logger';
import { BingoValidator } from '../game/BingoValidator';
import { CardGenerator } from '../game/CardGenerator';
import { NumberCaller } from '../game/NumberCaller';
import { TimerService } from '../game/TimerService';
import type { CatalogRepository } from '../repositories/catalog.repository';
import type { RoundRepository } from '../repositories/round.repository';
import type { WinnerRepository } from '../repositories/winner.repository';
import type { UserRepository } from '../repositories/user.repository';
import { FREE, WinningPattern, type Card, type TgUser } from '../types/index';
import { displayName } from '../utils/format';
import type { KeyedMutex } from '../utils/Mutex';
import type { StatisticsService } from './StatisticsService';


// Timer keys (the room is a singleton, so fixed keys are fine).
const T_DRAW = 'room:draw';
const T_PHASE = 'room:phase';

export type RoomPhase = 'SELECTING' | 'PLAYING' | 'FINISHED';

export interface RoomState {
  roundId: string;
  phase: RoomPhase;
  /// Selection countdown; null until the first player picks a card.
  secondsLeft: number | null;
  poolSize: number;
  takenCards: number[];
  myCardNumber: number | null;
  playersCount: number;
  called: number[];
  currentNumber: number | null;
  card: Card | null;
  marked: number[];
  hasBingo: boolean;
  winner: {
    name: string;
    cardNumber: number;
    pattern: string | null;
    /** Numbers forming the winning line, so the UI can highlight the pattern. */
    line: number[];
    card: Card | null;
  } | null;
  nextRoundInSec: number | null;
}

export type RoomResult<T = object> = ({ ok: true } & T) | { ok: false; reason: string; retryAfterSec?: number };

/**
 * The single, always-running Bingo room.
 *
 *   SELECTING ──(first pick starts a 30s timer)──► PLAYING ──(valid BINGO / balls run out)──►
 *   FINISHED (winner shown briefly) ──► new SELECTING round ──► …
 *
 * There is no host: rounds start and repeat automatically. All timers live in this
 * process (the Next.js server), which is why the app must run as a persistent server.
 */
export class RoomService {
  private cooldowns = new Map<string, number>();
  private drawing = false;
  /// Guards the "did this round already get scheduled/started" transitions.
  private starting = false;

  constructor(
    private readonly users: UserRepository,
    private readonly rounds: RoundRepository,
    private readonly catalog: CatalogRepository,
    private readonly winners: WinnerRepository,
    private readonly stats: StatisticsService,
    private readonly cardGen: CardGenerator,
    private readonly validator: BingoValidator,
    private readonly caller: NumberCaller,
    private readonly timers: TimerService,
    private readonly mutex: KeyedMutex,
    private readonly logger: Logger,
  ) {}

  ensureUser(tg: TgUser): Promise<User> {
    return this.users.upsertFromTelegram(tg);
  }

  // ---- Boot ------------------------------------------------------------------

  /** Generate the fixed catalog once, then keep it forever. */
  async ensureCatalog(): Promise<void> {
    const have = await this.catalog.count();
    if (have >= config.CARD_POOL_SIZE) return;

    const seen = new Set<string>();
    const cards: { number: number; numbers: Card }[] = [];
    for (let n = have + 1; n <= config.CARD_POOL_SIZE; n++) {
      let card = this.cardGen.generate();
      // Guarantee every catalog card is distinct.
      while (seen.has(JSON.stringify(card))) card = this.cardGen.generate();
      seen.add(JSON.stringify(card));
      cards.push({ number: n, numbers: card });
    }
    await this.catalog.createMany(cards);
    this.logger.info({ created: cards.length }, 'seeded bingo card catalog');
  }

  /** Called on server start: clean up interrupted rounds and open a fresh one. */
  async boot(): Promise<void> {
    await this.ensureCatalog();
    const abandoned = await this.rounds.abandonUnfinished();
    if (abandoned) this.logger.info({ abandoned }, 'closed interrupted rounds on boot');
    this.timers.clearAll(T_DRAW);
    this.timers.clearAll(T_PHASE);
    await this.rounds.create();
    this.logger.info('Bingo room open — waiting for the first card selection');
  }

  private async currentRound() {
    const round = await this.rounds.current();
    if (round) return round;
    return this.rounds.create();
  }

  // ---- Selection -------------------------------------------------------------

  /**
   * Claim a card for this round. Race-safe: the unique (roundId, cardNumber) index means
   * two players tapping the same card can never both get it.
   * The 30s countdown starts on the FIRST selection of the round.
   */
  async selectCard(user: User, cardNumber: number): Promise<RoomResult<{ cardNumber: number }>> {
    return this.mutex.runExclusive('room:select', async () => {
      const round = await this.currentRound();
      if (round.status !== 'SELECTING') {
        return { ok: false as const, reason: 'Selection is closed — wait for the next round.' };
      }
      if (!Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > config.CARD_POOL_SIZE) {
        return { ok: false as const, reason: 'Invalid card number.' };
      }

      const taken = await this.rounds.takenCardNumbers(round.id);
      const mine = await this.rounds.findEntry(round.id, user.id);
      if (taken.includes(cardNumber) && mine?.cardNumber !== cardNumber) {
        return { ok: false as const, reason: `Card ${cardNumber} is already taken.` };
      }

      const wasEmpty = taken.length === 0;
      try {
        if (mine) await this.rounds.updateEntryCard(mine.id, cardNumber);
        else await this.rounds.createEntry(round.id, user.id, cardNumber);
      } catch {
        return { ok: false as const, reason: `Card ${cardNumber} was just taken.` };
      }

      // First pick of the round opens the 30-second window.
      if (wasEmpty) {
        const endsAt = new Date(Date.now() + config.SELECTION_SECONDS * 1000);
        await this.rounds.update(round.id, { selectionEndsAt: endsAt });
        this.scheduleStart(round.id, config.SELECTION_SECONDS * 1000);
        this.logger.info({ roundId: round.id }, 'selection window opened');
      }
      return { ok: true as const, cardNumber };
    });
  }

  private scheduleStart(roundId: string, ms: number): void {
    this.timers.setTimeout(T_PHASE, () => void this.startRound(roundId), ms);
  }

  // ---- Playing ---------------------------------------------------------------

  private async startRound(roundId: string): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      const round = await this.rounds.findById(roundId);
      if (!round || round.status !== 'SELECTING') return;

      const entries = await this.rounds.listEntries(roundId);
      if (entries.length === 0) {
        // Nobody picked — reopen selection (wait for a first pick again).
        await this.rounds.update(roundId, { selectionEndsAt: null });
        this.logger.info({ roundId }, 'no players selected — waiting again');
        return;
      }

      await this.rounds.update(roundId, { status: 'PLAYING', startedAt: new Date() });
      await this.stats.recordGamePlayed(entries.map((e) => e.userId));
      this.logger.info({ roundId, players: entries.length }, 'round started');

      this.timers.setInterval(T_DRAW, () => void this.drawTick(roundId), config.DRAW_INTERVAL_SECONDS * 1000);
      await this.drawTick(roundId); // first ball immediately
    } finally {
      this.starting = false;
    }
  }

  private async drawTick(roundId: string): Promise<void> {
    if (this.drawing) return;
    this.drawing = true;
    try {
      const round = await this.rounds.findById(roundId);
      if (!round || round.status !== 'PLAYING') {
        this.timers.clearAll(T_DRAW);
        return;
      }
      const called = await this.rounds.listCalls(roundId);
      const next = this.caller.drawNext(called);
      if (next === null) {
        await this.finishRound(roundId); // all 75 drawn, nobody won
        return;
      }
      await this.rounds.addCall(roundId, next, called.length + 1);
      await this.rounds.update(roundId, { currentNumber: next });
    } catch (err) {
      this.logger.error({ err, roundId }, 'drawTick failed');
    } finally {
      this.drawing = false;
    }
  }

  /** Mark a called number on the player's card (server-verified). */
  async markNumber(user: User, number: number): Promise<RoomResult<{ number: number }>> {
    const round = await this.currentRound();
    if (round.status !== 'PLAYING') return { ok: false, reason: 'The round is not running.' };

    const entry = await this.rounds.findEntry(round.id, user.id);
    if (!entry) return { ok: false, reason: 'You are not in this round.' };

    const card = entry.card.numbers as unknown as Card;
    if (!card.some((row) => row.includes(number))) {
      return { ok: false, reason: 'That number is not on your card.' };
    }
    if (number === FREE) return { ok: false, reason: 'That is the free space.' };
    if (entry.marked.includes(number)) return { ok: true, number }; // idempotent

    const calls = await this.rounds.listCalls(round.id);
    if (!calls.includes(number)) return { ok: false, reason: `${number} not called yet.` };

    await this.rounds.addMark(entry.id, number);
    const marked = [...entry.marked, number];
    const res = this.validator.validate(card, marked, calls);
    if (res.won && !entry.hasBingo) await this.rounds.setHasBingo(entry.id, true);
    return { ok: true, number };
  }

  /**
   * THE rule: the FIRST valid BINGO press wins. Serialized by a mutex, then finalized
   * by an atomic conditional update so only one winner is ever committed.
   */
  async claimBingo(user: User): Promise<RoomResult<{ pattern: WinningPattern }>> {
    return this.mutex.runExclusive('room:bingo', async () => {
      const round = await this.currentRound();
      if (round.status !== 'PLAYING') {
        return { ok: false as const, reason: 'Not accepting BINGO right now.' };
      }
      const entry = await this.rounds.findEntry(round.id, user.id);
      if (!entry) return { ok: false as const, reason: 'You are not in this round.' };

      const key = `${round.id}:${user.id}`;
      const until = this.cooldowns.get(key);
      const now = Date.now();
      if (until && until > now) {
        return { ok: false as const, reason: 'cooldown', retryAfterSec: Math.ceil((until - now) / 1000) };
      }

      const calls = await this.rounds.listCalls(round.id);
      const card = entry.card.numbers as unknown as Card;
      const lines = this.validator.findLines(card, entry.marked, calls);

      if (lines.length === 0) {
        if (config.FALSE_BINGO_COOLDOWN_SECONDS > 0) {
          this.cooldowns.set(key, now + config.FALSE_BINGO_COOLDOWN_SECONDS * 1000);
        }
        await this.stats.recordFalseBingo(user.id);
        return { ok: false as const, reason: 'invalid' };
      }

      // Real bingo rule: you must call on the ball that COMPLETES your line. If the line
      // was finished by an earlier ball and another has since been called, it has passed.
      const lastCalled = calls[calls.length - 1];
      const winning = lines.find((l) => l.numbers.includes(lastCalled));
      if (!winning) {
        if (config.FALSE_BINGO_COOLDOWN_SECONDS > 0) {
          this.cooldowns.set(key, now + config.FALSE_BINGO_COOLDOWN_SECONDS * 1000);
        }
        await this.stats.recordFalseBingo(user.id);
        return { ok: false as const, reason: 'passed' };
      }

      const claimed = await this.rounds.claimWinner(
        round.id,
        user.id,
        entry.cardNumber,
        winning.pattern,
        winning.numbers,
      );
      if (!claimed) return { ok: false as const, reason: 'Someone already won this round!' };

      this.timers.clearAll(T_DRAW);
      await this.winners.create({
        roundId: round.id,
        userId: user.id,
        cardNumber: entry.cardNumber,
        pattern: winning.pattern,
        numbersCalled: calls.length,
        durationMs: round.startedAt ? now - round.startedAt.getTime() : 0,
      });
      await this.rounds.setHasBingo(entry.id, true);
      await this.stats.recordBingoCalled(user.id);
      await this.stats.recordWin(user.id);

      this.scheduleNextRound();
      this.logger.info(
        { roundId: round.id, userId: user.id, card: entry.cardNumber, pattern: winning.pattern },
        'winner confirmed',
      );
      return { ok: true as const, pattern: winning.pattern };
    });
  }

  /** End the round with no winner (all balls drawn). */
  private async finishRound(roundId: string): Promise<void> {
    this.timers.clearAll(T_DRAW);
    await this.rounds.update(roundId, { status: 'FINISHED', endedAt: new Date() });
    this.logger.info({ roundId }, 'round ended with no winner');
    this.scheduleNextRound();
  }

  private scheduleNextRound(): void {
    this.timers.setTimeout(
      T_PHASE,
      () => {
        void (async () => {
          this.timers.clearAll(T_DRAW);
          await this.rounds.create();
          this.logger.info('new round open for card selection');
        })().catch((err) => this.logger.error({ err }, 'failed to open next round'));
      },
      config.WINNER_DISPLAY_SECONDS * 1000,
    );
  }

  // ---- State for the Mini App ------------------------------------------------

  async getState(user?: User): Promise<RoomState> {
    const round = await this.currentRound();
    const [entries, calls] = await Promise.all([
      this.rounds.listEntries(round.id),
      round.status === 'SELECTING' ? Promise.resolve<number[]>([]) : this.rounds.listCalls(round.id),
    ]);

    const mine = user ? entries.find((e) => e.userId === user.id) : undefined;
    const winnerEntry = round.winnerId ? entries.find((e) => e.userId === round.winnerId) : undefined;

    const secondsLeft = round.selectionEndsAt
      ? Math.max(0, Math.ceil((round.selectionEndsAt.getTime() - Date.now()) / 1000))
      : null;

    const nextRoundInSec =
      round.status === 'FINISHED' && round.endedAt
        ? Math.max(
            0,
            Math.ceil(
              (round.endedAt.getTime() + config.WINNER_DISPLAY_SECONDS * 1000 - Date.now()) / 1000,
            ),
          )
        : null;

    return {
      roundId: round.id,
      phase: round.status as RoomPhase,
      secondsLeft: round.status === 'SELECTING' ? secondsLeft : null,
      poolSize: config.CARD_POOL_SIZE,
      takenCards: entries.map((e) => e.cardNumber),
      myCardNumber: mine?.cardNumber ?? null,
      playersCount: entries.length,
      called: calls,
      currentNumber: round.currentNumber,
      card: mine ? (mine.card.numbers as unknown as Card) : null,
      marked: mine?.marked ?? [],
      hasBingo: mine?.hasBingo ?? false,
      winner: winnerEntry
        ? {
            name: displayName(winnerEntry.user),
            cardNumber: winnerEntry.cardNumber,
            pattern: round.winnerPattern,
            line: round.winnerLine,
            card: winnerEntry.card.numbers as unknown as Card,
          }
        : null,
      nextRoundInSec,
    };
  }
}
