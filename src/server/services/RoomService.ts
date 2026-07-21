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
import type { SettingsService } from './SettingsService';
import type { WalletService } from './WalletService';
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
  myCards: { cardNumber: number; card: Card; marked: number[]; hasBingo: boolean }[];
  maxCards: number;
  playersCount: number;
  cardsCount: number;
  called: number[];
  currentNumber: number | null;
  hasBingo: boolean;
  /** Registration + coin economy */
  registered: boolean;
  coins: number | null;
  entryFee: number;
  pot: number;
  /** What the winner of THIS round will receive (pot minus house cut, floored). */
  winAmount: number;
  isAdmin: boolean;
  winner: {
    name: string;
    cardNumber: number;
    /** Birr actually won (pot minus house cut, floored). */
    prize: number;
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
  /** Called numbers per round, kept in memory so a BINGO press needs no query for them. */
  private callsCache = new Map<string, number[]>();
  /** userId -> last time we saw them poll. Lets us detect that everyone has left. */
  private presence = new Map<string, number>();
  /** If nobody in the round has polled for this long, treat the round as abandoned. */
  private static readonly ABANDON_MS = 30_000;
  /** Very short-lived round cache; correctness never depends on it (see claimWinner). */
  private roundCache: { round: Awaited<ReturnType<RoundRepository['create']>>; at: number } | null = null;
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
    private readonly settings: SettingsService,
    private readonly wallet: WalletService,
    private readonly logger: Logger,
  ) {}

  async ensureUser(tg: TgUser): Promise<User> {
    const s = await this.settings.get();
    return this.users.upsertFromTelegram(tg, s.startingCoins);
  }

  /** Explicit registration from the Mini App (identity comes from verified initData). */
  async register(user: User, phone?: string): Promise<User> {
    if (user.registered) return user; // idempotent
    const updated = await this.users.markRegistered(user.id, phone);
    this.logger.info({ userId: user.id, telegramId: String(user.telegramId) }, 'player registered');
    return updated;
  }

  /** Look up a user by our internal id (used when resolving a session JWT). */
  userById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  private isAdmin(user?: User): boolean {
    if (!user) return false;
    return config.ADMIN_TELEGRAM_IDS.includes(String(user.telegramId));
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
    this.callsCache.clear();
    this.invalidateRound();
    await this.rounds.create();
    this.logger.info('Bingo room open — waiting for the first card selection');
  }

  private async currentRound() {
    // 400ms cache: removes a query from every poll and every button press. Safe because
    // every state-changing operation is validated against the DB, not this snapshot.
    if (this.roundCache && Date.now() - this.roundCache.at < 400) return this.roundCache.round;
    const round = (await this.rounds.current()) ?? (await this.rounds.create());
    this.roundCache = { round, at: Date.now() };
    return round;
  }

  private invalidateRound(): void {
    this.roundCache = null;
  }

  /**
   * Record that a player is still here.
   *
   * ANY interaction counts, not just a state poll: someone who just paid for a card is
   * obviously present, and a brief gap in polling (backgrounded tab, flaky network)
   * must not let the room decide the round was abandoned.
   */
  private touch(userId: string): void {
    this.presence.set(userId, Date.now());
  }

  /**
   * The whole card catalog, for the selection-screen preview.
   *
   * The catalog never changes, so it is read once and then served from memory. Sending
   * it to the client in one go means tapping a card previews instantly, with no request
   * per tap and nothing to wait for.
   */
  private catalogCache: { number: number; card: Card }[] | null = null;

  async catalogCards(): Promise<{ number: number; card: Card }[]> {
    if (this.catalogCache) return this.catalogCache;
    const rows = await this.catalog.all();
    this.catalogCache = rows.map((r) => ({
      number: r.number,
      card: r.numbers as unknown as Card,
    }));
    return this.catalogCache;
  }

  /** Called numbers, served from memory after the first read. */
  private async getCalls(roundId: string): Promise<number[]> {
    const hit = this.callsCache.get(roundId);
    if (hit) return hit;
    const calls = await this.rounds.listCalls(roundId);
    this.callsCache.set(roundId, calls);
    return calls;
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

      if (!user.registered) {
        return { ok: false as const, reason: 'Please register first (press Register in the bot).' };
      }
      this.touch(user.id);
      if (user.blocked) {
        return { ok: false as const, reason: 'Your account is blocked from playing.' };
      }

      const s = await this.settings.get();
      const taken = await this.rounds.takenCardNumbers(round.id);
      const mine = await this.rounds.findEntries(round.id, user.id);
      const alreadyMine = mine.find((e) => e.cardNumber === cardNumber);

      // Tapping a card you already hold is a no-op, not an error.
      if (alreadyMine) return { ok: true as const, cardNumber };

      if (taken.includes(cardNumber)) {
        return { ok: false as const, reason: `Card ${cardNumber} is already taken.` };
      }

      const wasEmpty = taken.length === 0;
      const max = Math.max(1, s.maxCardsPerPlayer);

      // With a one-card limit, tapping a different card MOVES you to it for free — the
      // long-standing behaviour, and the only sensible reading of the tap.
      if (mine.length >= max) {
        if (max === 1 && mine.length === 1) {
          try {
            await this.rounds.updateEntryCard(mine[0].id, cardNumber);
          } catch {
            return { ok: false as const, reason: `Card ${cardNumber} was just taken.` };
          }
          return { ok: true as const, cardNumber };
        }
        return {
          ok: false as const,
          reason: `You can hold at most ${max} cards. Tap one of yours to release it.`,
        };
      }

      // Each extra card costs its own entry fee. Charge first (atomic, can't overdraw).
      const paid = await this.wallet.debit(user.id, s.entryFee, 'ENTRY_FEE', round.id);
      if (paid === null) {
        return {
          ok: false as const,
          reason: `Not enough birr. You need ${s.entryFee} for another card.`,
        };
      }
      try {
        await this.rounds.createEntry(round.id, user.id, cardNumber);
        await this.rounds.update(round.id, {
          pot: { increment: s.entryFee },
          entryFee: s.entryFee,
        });
        this.invalidateRound();
      } catch {
        await this.wallet.credit(user.id, s.entryFee, 'ROUND_REFUND', round.id); // refund
        return { ok: false as const, reason: `Card ${cardNumber} was just taken.` };
      }

      // First pick of the round opens the selection window.
      if (wasEmpty) {
        const endsAt = new Date(Date.now() + s.selectionSeconds * 1000);
        await this.rounds.update(round.id, { selectionEndsAt: endsAt });
      this.invalidateRound();
        this.scheduleStart(round.id, s.selectionSeconds * 1000);
        this.logger.info({ roundId: round.id }, 'selection window opened');
      }
      return { ok: true as const, cardNumber };
    });
  }

  /**
   * Release the card you picked (e.g. tapped by mistake). Refunds the entry fee, and if
   * that leaves the round empty the countdown is cancelled — it restarts from scratch
   * when someone picks again.
   */
  async deselectCard(user: User, cardNumber?: number): Promise<RoomResult> {
    return this.mutex.runExclusive('room:select', async () => {
      const round = await this.currentRound();
      if (round.status !== 'SELECTING') {
        return { ok: false as const, reason: 'The round already started.' };
      }

      // A specific card, or all of them when none is named.
      const held = await this.rounds.findEntries(round.id, user.id);
      const dropping =
        cardNumber != null ? held.filter((e) => e.cardNumber === cardNumber) : held;
      if (dropping.length === 0) return { ok: true as const };

      for (const entry of dropping) {
        await this.rounds.deleteEntry(entry.id);
        if (round.entryFee > 0) {
          await this.wallet.credit(user.id, round.entryFee, 'ROUND_REFUND', round.id);
          await this.rounds.update(round.id, { pot: { decrement: round.entryFee } });
        }
      }
      this.invalidateRound();

      const remaining = await this.rounds.countEntries(round.id);
      if (remaining === 0) {
        this.timers.clearTimeout(T_PHASE);
        await this.rounds.update(round.id, { selectionEndsAt: null });
      this.invalidateRound();
        this.logger.info({ roundId: round.id }, 'countdown cancelled — no players left');
      }
      return { ok: true as const };
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

      const s = await this.settings.get();
      const entries = await this.rounds.listEntries(roundId);
      if (entries.length < s.minPlayers) {
        // Not enough players — reopen selection and wait for more.
        await this.rounds.update(roundId, { selectionEndsAt: null });
      this.invalidateRound();
        this.logger.info(
          { roundId, have: entries.length, need: s.minPlayers },
          'not enough players — waiting again',
        );
        return;
      }

      await this.rounds.update(roundId, { status: 'PLAYING', startedAt: new Date() });
      this.invalidateRound();
      await this.stats.recordGamePlayed(entries.map((e) => e.userId));
      this.logger.info({ roundId, players: entries.length }, 'round started');

      this.timers.setInterval(T_DRAW, () => void this.drawTick(roundId), s.drawIntervalSeconds * 1000);
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
      // If every player has closed the app, don't keep drawing to an empty room.
      const players = await this.rounds.listEntries(roundId);
      const cutoff = Date.now() - RoomService.ABANDON_MS;
      const anyoneHere = players.some((p) => (this.presence.get(p.userId) ?? 0) > cutoff);
      if (players.length === 0 || !anyoneHere) {
        this.logger.info({ roundId, players: players.length }, 'all players left — resetting room');
        await this.resetRoom('all players left');
        return;
      }

      const called = await this.getCalls(roundId);
      const next = this.caller.drawNext(called);
      if (next === null) {
        await this.finishRound(roundId); // all 75 drawn, nobody won
        return;
      }
      await this.rounds.addCall(roundId, next, called.length + 1);
      await this.rounds.update(roundId, { currentNumber: next });
      this.callsCache.set(roundId, [...called, next]);
      this.invalidateRound();
    } catch (err) {
      this.logger.error({ err, roundId }, 'drawTick failed');
    } finally {
      this.drawing = false;
    }
  }

  /**
   * Mark a called number on one of the player's cards (server-verified).
   *
   * `cardNumber` says which card was tapped. Without it the number is marked on every
   * card of the player that contains it, which is what a single-card player expects.
   */
  async markNumber(
    user: User,
    number: number,
    cardNumber?: number,
  ): Promise<RoomResult<{ number: number }>> {
    const round = await this.currentRound();
    if (round.status !== 'PLAYING') return { ok: false, reason: 'The round is not running.' };

    const held = await this.rounds.findEntries(round.id, user.id);
    if (held.length === 0) return { ok: false, reason: 'You are not in this round.' };
    this.touch(user.id);

    const targets =
      cardNumber != null ? held.filter((e) => e.cardNumber === cardNumber) : held;
    const entry = targets.find((e) =>
      (e.card.numbers as unknown as Card).some((row) => row.includes(number)),
    );
    if (!entry) {
      return { ok: false, reason: 'That number is not on your card.' };
    }
    if (number === FREE) return { ok: false, reason: 'That is the free space.' };
    if (entry.marked.includes(number)) return { ok: true, number }; // idempotent

    const calls = await this.getCalls(round.id);
    if (!calls.includes(number)) return { ok: false, reason: `${number} not called yet.` };

    // Cosmetic only: recording which cells the player tapped. The win is computed
    // server-side from the called numbers (see claimBingo).
    await this.rounds.addMark(entry.id, number);
    return { ok: true, number };
  }

  /**
   * Mark several numbers at once.
   *
   * Used when a player switches from AUTO to MANUAL: everything AUTO had daubed is
   * written down in one request, so the card carries on from exactly where it was
   * instead of appearing to reset.
   */
  async markNumbers(
    user: User,
    numbers: number[],
    cardNumber?: number,
  ): Promise<RoomResult<{ marked: number }>> {
    const round = await this.currentRound();
    if (round.status !== 'PLAYING') return { ok: false, reason: 'The round is not running.' };

    const held = await this.rounds.findEntries(round.id, user.id);
    if (held.length === 0) return { ok: false, reason: 'You are not in this round.' };
    this.touch(user.id);

    const calls = await this.getCalls(round.id);
    const wanted = new Set(numbers.filter((n) => n !== FREE && calls.includes(n)));
    const targets = cardNumber != null ? held.filter((e) => e.cardNumber === cardNumber) : held;

    let marked = 0;
    for (const entry of targets) {
      const onCard = new Set((entry.card.numbers as unknown as Card).flat());
      const add = [...wanted].filter((n) => onCard.has(n) && !entry.marked.includes(n));
      if (add.length === 0) continue;
      await this.rounds.setMarks(entry.id, [...entry.marked, ...add]);
      marked += add.length;
    }
    return { ok: true, marked };
  }

  /**
   * THE rule: the FIRST valid BINGO press wins. Serialized by a mutex, then finalized
   * by an atomic conditional update so only one winner is ever committed.
   */
  async claimBingo(user: User): Promise<RoomResult<{ pattern: WinningPattern; cardNumber: number }>> {
    return this.mutex.runExclusive('room:bingo', async () => {
      const round = await this.currentRound();
      if (round.status !== 'PLAYING') {
        return { ok: false as const, reason: 'Not accepting BINGO right now.' };
      }
      const entries = await this.rounds.findEntries(round.id, user.id);
      if (entries.length === 0) return { ok: false as const, reason: 'You are not in this round.' };
      this.touch(user.id);

      const s = await this.settings.get();
      const key = `${round.id}:${user.id}`;
      const now = Date.now();
      // Cooldown is opt-in (0 = disabled): a wrong call just gets an error message.
      if (s.falseBingoCooldownSec > 0) {
        const until = this.cooldowns.get(key);
        if (until && until > now) {
          return {
            ok: false as const,
            reason: 'cooldown',
            retryAfterSec: Math.ceil((until - now) / 1000),
          };
        }
      }

      const calls = await this.getCalls(round.id);
      const enabled = s.patterns as WinningPattern[];
      const lastCalled = calls[calls.length - 1];

      // AUTO-DAUB across EVERY card the player holds. One press covers all of them, so
      // holding several cards never means having to guess which one to claim on.
      let anyLine = false;
      let winning: { pattern: WinningPattern; numbers: number[] } | undefined;
      let entry = entries[0];

      for (const e of entries) {
        const lines = this.validator.findLines(
          e.card.numbers as unknown as Card,
          calls,
          calls,
          enabled,
        );
        if (lines.length > 0) anyLine = true;
        // Real bingo rule: you must call on the ball that COMPLETES the line. If it was
        // finished earlier and another ball has since been called, that line has passed.
        const hit = lines.find((l) => l.numbers.includes(lastCalled));
        if (hit) {
          winning = hit;
          entry = e;
          break;
        }
      }

      if (!winning) {
        if (s.falseBingoCooldownSec > 0) {
          this.cooldowns.set(key, now + s.falseBingoCooldownSec * 1000);
        }
        // Fire-and-forget: the player shouldn't wait on a stats write.
        void this.stats.recordFalseBingo(user.id).catch(() => {});
        return { ok: false as const, reason: anyLine ? 'passed' : 'invalid' };
      }

      const claimed = await this.rounds.claimWinner(
        round.id,
        user.id,
        entry.cardNumber,
        winning.pattern,
        winning.numbers,
      );
      if (!claimed) return { ok: false as const, reason: 'Someone already won this round!' };
      this.invalidateRound();

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
      // Winner takes the pot minus the house cut, rounded DOWN to whole coins.
      const prize = Math.floor((round.pot * (100 - s.houseCutPercent)) / 100);
      if (prize > 0) {
        await this.wallet.credit(user.id, prize, 'PRIZE', round.id);
        this.logger.info(
          { userId: user.id, pot: round.pot, cut: s.houseCutPercent, prize },
          'prize awarded to winner',
        );
      }

      await this.scheduleNextRound();
      this.logger.info(
        { roundId: round.id, userId: user.id, card: entry.cardNumber, pattern: winning.pattern },
        'winner confirmed',
      );
      return { ok: true as const, pattern: winning.pattern, cardNumber: entry.cardNumber };
    });
  }

  /**
   * Stop the current round immediately, refund every stake, and open a fresh selection
   * round. Used when everyone leaves and by the admin "Close game" button.
   */
  async resetRoom(reason: string): Promise<{ refunded: number }> {
    this.timers.clearAll(T_DRAW);
    this.timers.clearAll(T_PHASE);

    // Read the round FRESH — a refund must never be based on the cached snapshot.
    this.invalidateRound();
    const round = (await this.rounds.current()) ?? (await this.rounds.create());
    const entries = await this.rounds.listEntries(round.id);

    if (round.entryFee > 0) {
      for (const e of entries) {
        await this.wallet.credit(e.userId, round.entryFee, 'ROUND_REFUND', round.id);
      }
    }
    await this.rounds.update(round.id, {
      status: 'FINISHED',
      endedAt: new Date(),
      selectionEndsAt: null,
    });

    this.presence.clear();
    this.callsCache.clear();
    this.invalidateRound();
    const fresh = await this.rounds.create();
    this.invalidateRound();

    this.logger.info(
      { reason, refunded: entries.length, newRound: fresh.id },
      'room reset — new round open',
    );
    return { refunded: entries.length };
  }

  /** End the round with no winner (all balls drawn) — everyone gets their fee back. */
  private async finishRound(roundId: string): Promise<void> {
    this.timers.clearAll(T_DRAW);
    const round = await this.rounds.findById(roundId);
    await this.rounds.update(roundId, { status: 'FINISHED', endedAt: new Date() });
    this.invalidateRound();

    if (round && round.entryFee > 0) {
      const entries = await this.rounds.listEntries(roundId);
      for (const e of entries) {
        await this.wallet.credit(e.userId, round.entryFee, 'ROUND_REFUND', roundId);
      }
      this.logger.info({ roundId, refunded: entries.length }, 'no winner — entry fees refunded');
    }
    this.logger.info({ roundId }, 'round ended with no winner');
    await this.scheduleNextRound();
  }

  private async scheduleNextRound(): Promise<void> {
    const s = await this.settings.get();
    this.timers.setTimeout(
      T_PHASE,
      () => {
        void (async () => {
          this.timers.clearAll(T_DRAW);
          const fresh = await this.rounds.create();
          this.callsCache.clear();
          this.invalidateRound();
          this.logger.info({ roundId: fresh.id }, 'new round open for card selection');
        })().catch((err) => this.logger.error({ err }, 'failed to open next round'));
      },
      s.winnerDisplaySeconds * 1000,
    );
  }

  // ---- State for the Mini App ------------------------------------------------

  async getState(user?: User): Promise<RoomState> {
    const round = await this.currentRound();
    const settings = await this.settings.get();
    const [entries, calls] = await Promise.all([
      this.rounds.listEntries(round.id),
      round.status === 'SELECTING' ? Promise.resolve<number[]>([]) : this.getCalls(round.id),
    ]);

    const mine = user ? entries.filter((e) => e.userId === user.id) : [];
    // Anyone polling while holding a card counts as "still here".
    if (mine.length > 0 && user) this.touch(user.id);
    const patterns = settings.patterns as WinningPattern[];
    // Match the WINNING CARD, not just the winner. A player may hold several cards, and
    // matching on userId alone would show their first card with a line that isn't on it.
    const winnerEntry = round.winnerId
      ? (entries.find(
          (e) => e.userId === round.winnerId && e.cardNumber === round.winnerCardNo,
        ) ?? entries.find((e) => e.userId === round.winnerId))
      : undefined;

    const secondsLeft = round.selectionEndsAt
      ? Math.max(0, Math.ceil((round.selectionEndsAt.getTime() - Date.now()) / 1000))
      : null;

    const nextRoundInSec =
      round.status === 'FINISHED' && round.endedAt
        ? Math.max(
            0,
            Math.ceil(
              (round.endedAt.getTime() + settings.winnerDisplaySeconds * 1000 - Date.now()) / 1000,
            ),
          )
        : null;

    return {
      roundId: round.id,
      phase: round.status as RoomPhase,
      secondsLeft: round.status === 'SELECTING' ? secondsLeft : null,
      poolSize: config.CARD_POOL_SIZE,
      takenCards: entries.map((e) => e.cardNumber),
      myCards: mine.map((e) => ({
        cardNumber: e.cardNumber,
        card: e.card.numbers as unknown as Card,
        marked: e.marked,
        // True when THIS card completes a line on the ball just called, so the player
        // can see which of their cards is the one to claim on.
        hasBingo: this.validator
          .findLines(e.card.numbers as unknown as Card, calls, calls, patterns)
          .some((l) => l.numbers.includes(round.currentNumber ?? -1)),
      })),
      maxCards: Math.max(1, settings.maxCardsPerPlayer),
      // Distinct people, not cards — one player with three cards is still one player.
      playersCount: new Set(entries.map((e) => e.userId)).size,
      cardsCount: entries.length,
      called: calls,
      currentNumber: round.currentNumber,
      // True if ANY of the player's cards completes a line on the current ball.
      hasBingo: mine.some((e) =>
        this.validator
          .findLines(e.card.numbers as unknown as Card, calls, calls, patterns)
          .some((l) => l.numbers.includes(round.currentNumber ?? -1)),
      ),
      registered: user?.registered ?? false,
      // `user` is already loaded by the auth layer — no extra query needed.
      coins: user ? user.coins : null,
      entryFee: settings.entryFee,
      pot: round.pot,
      winAmount: Math.floor((round.pot * (100 - settings.houseCutPercent)) / 100),
      isAdmin: this.isAdmin(user),
      winner: winnerEntry
        ? {
            name: displayName(winnerEntry.user),
            cardNumber: winnerEntry.cardNumber,
            prize: Math.floor((round.pot * (100 - settings.houseCutPercent)) / 100),
            pattern: round.winnerPattern,
            line: round.winnerLine,
            card: winnerEntry.card.numbers as unknown as Card,
          }
        : null,
      nextRoundInSec,
    };
  }
}
