import type { AppObject } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import * as m from '@/paraglide/messages.js';
import { linkOf } from '@/platform/links';

// Leaves in the center's index (spec 006; kete-core spec 142; doctrine D-062, R1, R15): each leave
// said with its requester and its state, so that « # », the search, Planifier, Kete and the agents
// of the center find it with each person's own rights. Its data stays here. A leave approved and
// over is « taken ».

/** The leaves in progress or to come, and those that changed or ended in the last month. */
export async function leaveObjects(db: SqlExecutor): Promise<AppObject[]> {
  const { rows } = await db.query<{
    leave_id: string;
    number: string;
    requester_id: string;
    requester_name: string;
    status: string;
    over: boolean;
    changed_at: Date;
  }>(
    `select leave_id, number, requester_id, requester_name, status, ends_on < current_date as over,
            greatest(created_at, decided_at) as changed_at
       from leaves
      where status in ('asked', 'returned')
         or (status = 'approved' and ends_on >= current_date - 30)
         or greatest(created_at, decided_at) > now() - interval '30 days'
      order by created_at desc limit 300`,
  );
  return rows.map((r): AppObject => ({
    kind: 'leave',
    id: r.leave_id,
    title: m.object_leave({ number: r.number, name: r.requester_name }),
    state: r.status === 'approved' && r.over ? 'taken' : r.status,
    personId: r.requester_id,
    ...linkOf(`/equipe/personnes/${encodeURIComponent(r.requester_id)}`),
    updatedAt: r.changed_at.toISOString(),
  }));
}
