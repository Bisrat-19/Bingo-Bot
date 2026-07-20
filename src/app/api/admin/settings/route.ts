import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';
import { VALID_PATTERNS } from '@/server/services/SettingsService';

// Read (and optionally update) live game settings.
// Auth: Telegram admin (Mini App) OR `Authorization: Bearer <ADMIN_API_TOKEN>` (dashboard).
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const { settings } = getContainer();
  const patch = body.patch as Record<string, never> | undefined;
  const current = patch ? await settings.update(patch) : await settings.get();

  return jsonSafe({ ok: true, settings: current, validPatterns: VALID_PATTERNS });
}
