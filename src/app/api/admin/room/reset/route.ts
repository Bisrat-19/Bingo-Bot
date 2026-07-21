import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/**
 * Force-close the current round and open a fresh one. Every stake is refunded, so
 * closing a game never costs players money.
 */
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const reason = typeof body.reason === 'string' ? body.reason : 'admin closed the game';
  const res = await getContainer().room.resetRoom(reason);
  return jsonSafe({ ok: true, ...res });
}
