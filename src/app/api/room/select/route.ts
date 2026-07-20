import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

// Claim one of the 100 cards for the current round (race-safe, one card per player).
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);
  return jsonSafe(await getContainer().room.selectCard(user, Number(body.cardNumber)));
}
