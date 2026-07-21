import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/**
 * Grant bonus coins — to every registered player (`target: 'all'`) or to one player
 * (`target: '@username'` or a numeric telegram id). Every grant is written to the
 * ledger, so bonuses stay separable from real deposits in the audit trail.
 *
 * POST { target: 'all' | '@user' | '123456789', amount: number }
 */
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const amount = Math.floor(Number(body.amount));
  const target = typeof body.target === 'string' ? body.target.trim() : '';
  if (!Number.isFinite(amount) || amount < 1) {
    return jsonSafe({ ok: false, error: 'amount must be at least 1' }, 400);
  }
  if (!target) return jsonSafe({ ok: false, error: 'target is required' }, 400);

  const { wallet } = getContainer();

  if (target.toLowerCase() === 'all') {
    const { credited, failed } = await wallet.giveBonusToAll(amount);
    return jsonSafe({ ok: true, target: 'all', amount, credited: credited.length, failed });
  }

  const user = await wallet.findPlayer(target);
  if (!user) return jsonSafe({ ok: false, error: 'player not found' }, 404);

  const balance = await wallet.giveBonus(user.id, amount);
  return jsonSafe({
    ok: true,
    amount,
    user: { telegramId: user.telegramId, username: user.username, balance },
  });
}
