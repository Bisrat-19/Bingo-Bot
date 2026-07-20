import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

// Full room snapshot. Works with or without a user (spectators can watch).
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body).catch(() => null);
  const state = await getContainer().room.getState(user ?? undefined);
  return jsonSafe(state);
}
