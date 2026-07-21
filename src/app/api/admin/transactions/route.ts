import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/**
 * List deposit/withdrawal requests for the admin dashboard.
 * Body: { status?: 'PENDING'|'APPROVED'|'REJECTED', type?: 'DEPOSIT'|'WITHDRAWAL', skip?, take? }
 */
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const { wallet } = getContainer();
  const [items, pending] = await Promise.all([
    wallet.list({
      status: body.status as never,
      type: body.type as never,
      skip: Number(body.skip) || 0,
      take: Number(body.take) || 50,
    }),
    wallet.count('PENDING'),
  ]);
  // Tell the dashboard which requests have a receipt stored in our DB.
  const withReceipt = await Promise.all(
    items.map(async (i) => ({ ...i, hasStoredReceipt: await wallet.hasReceipt(i.id) })),
  );
  return jsonSafe({ ok: true, pending, items: withReceipt });
}
