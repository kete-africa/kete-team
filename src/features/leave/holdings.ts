import type { AppHolding } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import * as m from '@/paraglide/messages.js';
import { linkOf } from '@/platform/links';

// What leave holds, as the center keeps it (kete-core spec 114): a leave sent back is its
// requester's to correct. One the center's circuit decides is a holding there already.

export async function leaveHoldings(db: SqlExecutor): Promise<AppHolding[]> {
  const { rows } = await db.query<{
    leave_id: string;
    number: string;
    requester_id: string;
    created_at: Date;
  }>(
    `select leave_id, number, requester_id, created_at from leaves
      where status = 'returned' order by created_at limit 500`,
  );
  return rows.map((r) => ({
    kind: 'leave',
    ref: r.leave_id,
    object: { kind: 'leave', id: r.leave_id },
    what: m.holding_leave_returned({ number: r.number }),
    holder: { kind: 'person', id: r.requester_id },
    state: 'held',
    since: r.created_at.toISOString(),
    ...linkOf('/'),
  }));
}
