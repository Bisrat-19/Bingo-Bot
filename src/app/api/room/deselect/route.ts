import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

// Release your card during selection (refunds the entry fee).
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body, req).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);
  return jsonSafe(await getContainer().room.deselectCard(user));
}
