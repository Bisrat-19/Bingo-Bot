import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

// Release a card during selection (refunds its entry fee).
// Without `cardNumber`, every card the player holds is released.
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body, req).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);
  const cardNumber = body.cardNumber != null ? Number(body.cardNumber) : undefined;
  return jsonSafe(await getContainer().room.deselectCard(user, cardNumber));
}
