import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

// The first valid press wins the round.
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);
  return jsonSafe(await getContainer().room.claimBingo(user));
}
