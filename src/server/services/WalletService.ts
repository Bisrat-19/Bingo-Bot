import type { LedgerReason, PrismaClient, Transaction, TxStatus, TxType } from '@prisma/client';
import type { Logger } from '../config/logger';

export interface CreateDepositInput {
  userId: string;
  amount: number;
  fullName: string;
  phone: string;
  /** Legacy photo receipts. New deposits paste the payment SMS instead. */
  receiptFileId?: string;
  smsText?: string;
  payMethod?: 'TELEBIRR' | 'CBE';
}

export interface CreateWithdrawalInput {
  userId: string;
  amount: number;
  fullName: string;
  phone: string;
  payMethod?: 'TELEBIRR' | 'CBE';
}

export type WalletResult<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/**
 * Owns every coin movement. Balances are only ever changed here, and each change writes
 * an immutable LedgerEntry with the resulting balance — so the money is fully auditable.
 *
 * Deposits credit on admin approval. Withdrawals HOLD the coins immediately (so they
 * can't be spent while pending) and refund them if the request is rejected.
 */
export class WalletService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Apply a balance change and record it atomically. `requireFunds` makes the debit
   * conditional so a balance can never go negative under concurrency.
   */
  /**
   * Which bucket a credit lands in. Debits are drawn in a fixed order instead.
   */
  private bucketFor(reason: LedgerReason): 'bonusBalance' | 'depositBalance' | 'mainBalance' {
    if (reason === 'DEPOSIT') return 'depositBalance';
    if (reason === 'BONUS' || reason === 'SIGNUP_BONUS') return 'bonusBalance';
    return 'mainBalance';
  }

  /**
   * Apply a balance change and record it atomically.
   *
   * The balance is kept in three buckets so the wallet can show where money came from:
   *   bonus    promotional credit, spent FIRST and never withdrawable
   *   deposit  money the player actually paid in
   *   main     winnings and admin adjustments
   *
   * `coins` remains the single source of truth for "can they afford this"; the buckets
   * always add up to it. Debits drain bonus, then deposit, then main, so a player never
   * loses real money while promotional credit is still available.
   */
  private async move(
    userId: string,
    delta: number,
    reason: LedgerReason,
    refId?: string,
    requireFunds = false,
  ): Promise<number | null> {
    return this.prisma.$transaction(async (tx) => {
      if (requireFunds && delta < 0) {
        const ok = await tx.user.updateMany({
          where: { id: userId, coins: { gte: -delta } },
          data: { coins: { increment: delta } },
        });
        if (ok.count !== 1) return null; // insufficient funds
      } else {
        await tx.user.update({ where: { id: userId }, data: { coins: { increment: delta } } });
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { coins: true, mainBalance: true, bonusBalance: true, depositBalance: true },
      });
      const balanceAfter = user?.coins ?? 0;

      if (user) {
        let { mainBalance, bonusBalance, depositBalance } = user;
        if (delta >= 0) {
          const bucket = this.bucketFor(reason);
          if (bucket === 'bonusBalance') bonusBalance += delta;
          else if (bucket === 'depositBalance') depositBalance += delta;
          else mainBalance += delta;
        } else {
          // Drain bonus first, then deposits, then winnings.
          let owed = -delta;
          const take = (have: number) => {
            const t = Math.min(have, owed);
            owed -= t;
            return have - t;
          };
          bonusBalance = take(bonusBalance);
          depositBalance = take(depositBalance);
          mainBalance = take(mainBalance);
          // Any shortfall means the buckets had drifted; the real balance wins.
          if (owed > 0) mainBalance = Math.max(0, mainBalance - owed);
        }
        // Never let rounding or drift break the invariant buckets === coins.
        const sum = mainBalance + bonusBalance + depositBalance;
        if (sum !== balanceAfter) mainBalance += balanceAfter - sum;
        if (mainBalance < 0) mainBalance = 0;

        await tx.user.update({
          where: { id: userId },
          data: { mainBalance, bonusBalance, depositBalance },
        });
      }

      await tx.ledgerEntry.create({
        data: { userId, delta, balanceAfter, reason, refId },
      });
      return balanceAfter;
    });
  }

  /** Credit/debit used by the game itself (entry fees, prizes, refunds). */
  credit(userId: string, amount: number, reason: LedgerReason, refId?: string) {
    return this.move(userId, Math.abs(amount), reason, refId);
  }

  debit(userId: string, amount: number, reason: LedgerReason, refId?: string) {
    return this.move(userId, -Math.abs(amount), reason, refId, true);
  }

  balance(userId: string): Promise<number> {
    return this.prisma.user
      .findUnique({ where: { id: userId }, select: { coins: true } })
      .then((u) => u?.coins ?? 0);
  }

  // ---- Bonuses --------------------------------------------------------------

  /**
   * Give free coins to ONE player. Returns the new balance, or null if no such player.
   * Like every other coin movement this lands in the ledger, so a bonus is auditable
   * and can never be confused with a deposit.
   */
  async giveBonus(userId: string, amount: number, refId?: string): Promise<number | null> {
    const amt = Math.floor(Math.abs(amount));
    if (amt <= 0) return null;
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) return null;
    return this.credit(userId, amt, 'BONUS', refId);
  }

  /** Resolve a player by numeric telegram id or @username (case-insensitive). */
  async findPlayer(identifier: string) {
    const raw = identifier.trim().replace(/^@/, '');
    if (/^\d+$/.test(raw)) {
      const byId = await this.prisma.user.findUnique({ where: { telegramId: BigInt(raw) } });
      if (byId) return byId;
    }
    return this.prisma.user.findFirst({
      where: { username: { equals: raw, mode: 'insensitive' } },
    });
  }

  /**
   * Give the same bonus to every registered player. Credits run one-by-one (not one giant
   * transaction) so a single failure can't roll back everyone else's bonus — each player
   * either gets their coins and a ledger row, or neither.
   */
  async giveBonusToAll(
    amount: number,
    refId?: string,
  ): Promise<{ credited: { telegramId: bigint; balance: number }[]; failed: number }> {
    const amt = Math.floor(Math.abs(amount));
    const credited: { telegramId: bigint; balance: number }[] = [];
    let failed = 0;
    if (amt <= 0) return { credited, failed };

    const users = await this.prisma.user.findMany({
      where: { registered: true },
      select: { id: true, telegramId: true },
    });
    for (const u of users) {
      try {
        const balance = await this.credit(u.id, amt, 'BONUS', refId);
        credited.push({ telegramId: u.telegramId, balance: balance ?? 0 });
      } catch (err) {
        failed += 1;
        this.logger.error({ err, userId: u.id }, 'bonus credit failed');
      }
    }
    this.logger.info({ amount: amt, credited: credited.length, failed }, 'bonus to all players');
    return { credited, failed };
  }

  // ---- Deposits -------------------------------------------------------------

  /** Record a deposit request. No coins move until an admin approves it. */
  async createDeposit(input: CreateDepositInput): Promise<Transaction> {
    const tx = await this.prisma.transaction.create({
      data: {
        userId: input.userId,
        type: 'DEPOSIT',
        amount: input.amount,
        fullName: input.fullName,
        phone: input.phone,
        receiptFileId: input.receiptFileId,
        smsText: input.smsText,
        payMethod: input.payMethod,
      },
    });
    this.logger.info({ txId: tx.id, amount: tx.amount }, 'deposit request created');
    return tx;
  }

  /** Largest receipt we'll keep (Telegram photos are far smaller than this). */
  static readonly MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

  /**
   * Store our own copy of the receipt image. Kept separate from the Transaction row so
   * listing requests never loads the blobs.
   */
  async storeReceipt(txId: string, data: Buffer, mimeType = 'image/jpeg'): Promise<boolean> {
    if (data.byteLength === 0 || data.byteLength > WalletService.MAX_RECEIPT_BYTES) {
      this.logger.warn({ txId, size: data.byteLength }, 'receipt rejected (empty or too large)');
      return false;
    }
    await this.prisma.receiptFile.upsert({
      where: { txId },
      create: { txId, data, mimeType, sizeBytes: data.byteLength },
      update: { data, mimeType, sizeBytes: data.byteLength },
    });
    this.logger.info({ txId, size: data.byteLength }, 'receipt stored');
    return true;
  }

  getReceipt(txId: string) {
    return this.prisma.receiptFile.findUnique({ where: { txId } });
  }

  /** Whether we hold our own copy (used by the dashboard to pick an image source). */
  async hasReceipt(txId: string): Promise<boolean> {
    return (await this.prisma.receiptFile.count({ where: { txId } })) > 0;
  }

  // ---- Withdrawals ----------------------------------------------------------

  /**
   * Record a withdrawal and HOLD the coins immediately, so a player can't request a
   * payout and then spend the same coins while it's pending.
   */
  async createWithdrawal(input: CreateWithdrawalInput): Promise<WalletResult<{ tx: Transaction }>> {
    const tx = await this.prisma.transaction.create({
      data: {
        userId: input.userId,
        type: 'WITHDRAWAL',
        amount: input.amount,
        fullName: input.fullName,
        phone: input.phone,
        payMethod: input.payMethod,
      },
    });

    const balance = await this.move(input.userId, -input.amount, 'WITHDRAWAL_HOLD', tx.id, true);
    if (balance === null) {
      await this.prisma.transaction.update({
        where: { id: tx.id },
        data: { status: 'REJECTED', adminNote: 'Insufficient balance at request time' },
      });
      return { ok: false, reason: 'Not enough birr for that withdrawal.' };
    }

    this.logger.info({ txId: tx.id, amount: tx.amount }, 'withdrawal requested (coins held)');
    return { ok: true, tx };
  }

  // ---- Admin review ---------------------------------------------------------

  /**
   * Approve a pending request.
   *  - DEPOSIT    -> credit the approved amount
   *  - WITHDRAWAL -> coins were already held; just finalise
   * Guarded so a request can never be approved twice.
   */
  async approve(
    txId: string,
    reviewedBy: string,
    approvedAmount?: number,
    note?: string,
  ): Promise<WalletResult<{ tx: Transaction; balance: number }>> {
    const claimed = await this.prisma.transaction.updateMany({
      where: { id: txId, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        reviewedBy,
        reviewedAt: new Date(),
        adminNote: note,
        approvedAmount,
      },
    });
    if (claimed.count !== 1) return { ok: false, reason: 'Already reviewed or not found.' };

    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) return { ok: false, reason: 'Not found.' };

    const finalAmount = approvedAmount ?? tx.amount;
    let balance = await this.balance(tx.userId);

    if (tx.type === 'DEPOSIT') {
      balance = (await this.move(tx.userId, finalAmount, 'DEPOSIT', tx.id)) ?? balance;
    }
    this.logger.info({ txId, type: tx.type, amount: finalAmount }, 'transaction approved');
    return { ok: true, tx: { ...tx, approvedAmount: finalAmount }, balance };
  }

  /** Reject a pending request; withdrawals get their held coins back. */
  async reject(
    txId: string,
    reviewedBy: string,
    note?: string,
  ): Promise<WalletResult<{ tx: Transaction; balance: number }>> {
    const claimed = await this.prisma.transaction.updateMany({
      where: { id: txId, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedBy, reviewedAt: new Date(), adminNote: note },
    });
    if (claimed.count !== 1) return { ok: false, reason: 'Already reviewed or not found.' };

    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) return { ok: false, reason: 'Not found.' };

    let balance = await this.balance(tx.userId);
    if (tx.type === 'WITHDRAWAL') {
      balance = (await this.move(tx.userId, tx.amount, 'WITHDRAWAL_REFUND', tx.id)) ?? balance;
    }
    this.logger.info({ txId, type: tx.type }, 'transaction rejected');
    return { ok: true, tx, balance };
  }

  // ---- Queries --------------------------------------------------------------

  list(opts: { status?: TxStatus; type?: TxType; skip?: number; take?: number }) {
    return this.prisma.transaction.findMany({
      where: { status: opts.status, type: opts.type },
      orderBy: { createdAt: 'desc' },
      skip: opts.skip ?? 0,
      take: Math.min(opts.take ?? 50, 200),
      include: {
        user: { select: { telegramId: true, username: true, firstName: true, coins: true } },
      },
    });
  }

  count(status?: TxStatus) {
    return this.prisma.transaction.count({ where: { status } });
  }

  byId(id: string) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: { user: { select: { telegramId: true, username: true, firstName: true } } },
    });
  }

  ledgerFor(userId: string, take = 50) {
    return this.prisma.ledgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
