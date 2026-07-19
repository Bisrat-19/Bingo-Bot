import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

export async function POST(req: Request) {
  const body = await parseBody(req);
  if (!body.gameId) return jsonSafe({ error: 'gameId required' }, 400);
  const user = await resolveUser(body).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);
  return jsonSafe(await getContainer().gameService.leaveGame(body.gameId, user));
}
