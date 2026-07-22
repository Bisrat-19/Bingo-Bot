import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';
import { LIMITS, VALID_PATTERNS } from '@/server/services/SettingsService';
import { DEFAULT_INSTRUCTIONS, DEFAULT_SUPPORT, parseSupport } from '@/server/content/defaults';

// Read (and optionally update) live game settings.
// Auth: Telegram admin (Mini App) OR `Authorization: Bearer <ADMIN_API_TOKEN>` (dashboard).
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const { settings } = getContainer();
  const patch = body.patch as Record<string, never> | undefined;
  const current = patch ? await settings.update(patch) : await settings.get();

  // Anything the server clamped is reported, so no admin surface ever has to guess why
  // a saved value differs from what was typed.
  const adjusted: Record<string, { requested: number; applied: number; min: number; max: number }> = {};
  if (patch) {
    const cur = current as unknown as Record<string, unknown>;
    for (const [key, range] of Object.entries(LIMITS)) {
      if (!(key in patch)) continue;
      if (['patterns', 'depositPhone', 'supportItems', 'instructionsText'].includes(key)) continue;
      const requested = Math.round(Number((patch as Record<string, unknown>)[key]));
      const applied = Number(cur[key]);
      if (Number.isFinite(requested) && requested !== applied) {
        adjusted[key] = { requested, applied, min: range[0], max: range[1] };
      }
    }
  }

  return jsonSafe({
    ok: true,
    settings: current,
    validPatterns: VALID_PATTERNS,
    limits: LIMITS,
    adjusted,
    // What players actually see right now, with the built-in fallbacks applied. The
    // dashboard edits this rather than the raw column, which may legitimately be empty.
    effective: {
      supportItems: parseSupport(current.supportItems),
      instructionsText: current.instructionsText?.trim()
        ? current.instructionsText
        : DEFAULT_INSTRUCTIONS,
      usingDefaultInstructions: !current.instructionsText?.trim(),
    },
    defaults: { supportItems: DEFAULT_SUPPORT, instructionsText: DEFAULT_INSTRUCTIONS },
  });
}
