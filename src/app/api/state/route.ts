import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

// Spectator-friendly: works with or without an authenticated user.
export async function POST(req: Request) {
  const body = await parseBody(req);
  if (!body.gameId) return jsonSafe({ error: 'gameId required' }, 400);
  const user = await resolveUser(body).catch(() => null);
  const state = await getContainer().gameService.getWebState(body.gameId, user ?? undefined);
  if (!state) return jsonSafe({ error: 'game not found' }, 404);
  return jsonSafe(state);
}
