import type { AppObject } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import * as m from '@/paraglide/messages.js';
import { linkOf } from '@/platform/links';

// Authorisations in the center's index (spec 006; kete-core spec 142; doctrine D-062, R1, R15):
// each one said with its holder and whether it is valid, ending within a month, or expired — found
// at the center with each person's own rights. Its data stays here.

/** The authorisations valid, and those expired in the last month. */
export async function authorisationObjects(db: SqlExecutor): Promise<AppObject[]> {
  const { rows } = await db.query<{
    authorisation_id: string;
    user_id: string;
    holder_name: string | null;
    kind_name: string;
    state: string;
    created_at: Date;
  }>(
    `select a.authorisation_id, a.user_id, mb.name as holder_name, k.name as kind_name,
            case when a.valid_until is not null and a.valid_until < current_date then 'expired'
                 when a.valid_until is not null and a.valid_until < current_date + 30 then 'ending'
                 else 'valid' end as state,
            a.created_at
       from authorisations a
       join authorisation_kinds k on k.kind_id = a.kind_id
       left join members mb on mb.user_id = a.user_id
      where a.valid_until is null or a.valid_until >= current_date - 30
      order by a.created_at desc limit 200`,
  );
  return rows.map((r): AppObject => ({
    kind: 'authorisation',
    id: r.authorisation_id,
    title: m.object_authorisation({ kind: r.kind_name, name: r.holder_name ?? r.user_id }),
    state: r.state,
    personId: r.user_id,
    ...linkOf(`/equipe/personnes/${encodeURIComponent(r.user_id)}`),
    updatedAt: r.created_at.toISOString(),
  }));
}
