import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { config } from '@/server/config/env';
import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/** Constant-time token comparison (used for the query-param form below). */
function tokenOk(token: string): boolean {
  if (!config.ADMIN_API_TOKEN || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(config.ADMIN_API_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * GET /api/admin/receipt?id=<txId>&token=<ADMIN_API_TOKEN>
 *
 * Streams the receipt image straight from our database, so a dashboard can simply do
 * `<img src="/api/admin/receipt?id=…&token=…">`. The token goes in the query string
 * because an <img> tag can't send an Authorization header.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  const token = url.searchParams.get('token') ?? '';

  const header = req.headers.get('authorization') ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (!tokenOk(token) && !tokenOk(bearer)) {
    return jsonSafe({ ok: false, reason: 'Admins only.' }, 403);
  }

  const file = await getContainer().wallet.getReceipt(id);
  if (!file) return jsonSafe({ ok: false, reason: 'No receipt stored for this request.' }, 404);

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'content-type': file.mimeType,
      'content-length': String(file.sizeBytes),
      'cache-control': 'private, max-age=300',
    },
  });
}

/**
 * POST — receipt metadata for the dashboard: where to load the image from, plus a
 * Telegram link as a fallback if we somehow never stored our own copy.
 */
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const id = String(body.id ?? '');
  const { wallet, bot } = getContainer();
  const tx = await wallet.byId(id);
  if (!tx) return jsonSafe({ ok: false, reason: 'Not found' }, 404);

  const stored = await wallet.getReceipt(id);
  if (stored) {
    return jsonSafe({
      ok: true,
      source: 'database',
      url: `/api/admin/receipt?id=${encodeURIComponent(id)}&token=${encodeURIComponent(config.ADMIN_API_TOKEN ?? '')}`,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    });
  }

  if (tx.receiptFileId) {
    try {
      const link = await bot.telegram.getFileLink(tx.receiptFileId);
      return jsonSafe({ ok: true, source: 'telegram', url: link.href });
    } catch {
      /* fall through */
    }
  }
  return jsonSafe({ ok: false, reason: 'No receipt available' }, 404);
}
