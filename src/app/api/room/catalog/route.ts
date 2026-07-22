import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

/**
 * The full, fixed card catalog. Served from server memory (the catalog never changes),
 * so the client can fetch it once and preview any card instantly with no per-tap call.
 */
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body, req).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);
  return jsonSafe({ ok: true, cards: await getContainer().room.catalogCards() });
}
