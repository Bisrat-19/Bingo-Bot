import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

/**
 * Mark called numbers. `cardNumber` identifies which of the player's cards was tapped.
 * Accepts either one `number` or a list of `numbers` (used when switching AUTO to
 * MANUAL, so the marks already daubed carry over in a single request).
 */
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body, req).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);

  const room = getContainer().room;
  const cardNumber = body.cardNumber != null ? Number(body.cardNumber) : undefined;

  if (Array.isArray(body.numbers)) {
    const numbers = body.numbers.map(Number).filter(Number.isFinite);
    return jsonSafe(await room.markNumbers(user, numbers, cardNumber));
  }
  return jsonSafe(await room.markNumber(user, Number(body.number), cardNumber));
}
