import { prisma } from '@/server/database/prisma';
import { getContainer } from '@/server/container';
import { logger } from '@/server/config/logger';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/**
 * Approve or reject a pending request.
 * Body: { id, action: 'approve'|'reject', amount?: number, note?: string }
 *  - approving a DEPOSIT credits `amount` (defaults to what the user declared)
 *  - rejecting a WITHDRAWAL returns the held coins
 * The user is notified in Telegram either way.
 */
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const id = String(body.id ?? '');
  const action = String(body.action ?? '');
  if (!id || (action !== 'approve' && action !== 'reject')) {
    return jsonSafe({ ok: false, reason: 'id and action (approve|reject) are required' }, 400);
  }

  const { wallet, bot } = getContainer();
  const reviewer = String(body.reviewedBy ?? 'dashboard');
  const note = body.note ? String(body.note) : undefined;

  const res =
    action === 'approve'
      ? await wallet.approve(id, reviewer, body.amount != null ? Number(body.amount) : undefined, note)
      : await wallet.reject(id, reviewer, note);

  if (!res.ok) return jsonSafe(res, 409);

  const tx = res.tx;
  const amount = tx.approvedAmount ?? tx.amount;
  const msg =
    action === 'approve'
      ? tx.type === 'DEPOSIT'
        ? `✅ <b>Deposit approved</b>\n\n+<b>${amount}</b> coins added.\nNew balance: <b>${res.balance}</b>`
        : `✅ <b>Withdrawal sent</b>\n\n<b>${amount}</b> birr sent to <code>${tx.phone}</code>.\nBalance: <b>${res.balance}</b>`
      : tx.type === 'DEPOSIT'
        ? `❌ <b>Deposit rejected</b>\n\nRef <code>${tx.id.slice(-8)}</code>.`
        : `❌ <b>Withdrawal rejected</b>\n\nYour <b>${tx.amount}</b> coins have been returned.\nBalance: <b>${res.balance}</b>`;

  const user = await prisma.user.findUnique({ where: { id: tx.userId } });
  if (user) {
    try {
      await bot.telegram.sendMessage(Number(user.telegramId), msg, { parse_mode: 'HTML' });
    } catch (err) {
      logger.warn({ err }, 'could not notify user of review');
    }
  }
  return jsonSafe({ ok: true, transaction: tx, balance: res.balance });
}
