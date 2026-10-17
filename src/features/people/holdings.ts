import type { AppHolding } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import * as m from '@/paraglide/messages.js';
import { linkOf } from '@/platform/links';

// What the roster holds, as the center keeps it (kete-core spec 114): an authorisation that ends
// within thirty days is its holder's to renew, due on its last day.

export async function authorisationHoldings(db: SqlExecutor): Promise<AppHolding[]> {
  const { rows } = await db.query<{
    authorisation_id: string;
    user_id: string;
    kind: string;
    valid_until: string;
  }>(
    `select a.authorisation_id, a.user_id, k.name as kind,
            to_char(a.valid_until, 'YYYY-MM-DD') as valid_until
       from authorisations a
       join authorisation_kinds k on k.kind_id = a.kind_id
       join members p on p.organization_id = a.organization_id and p.user_id = a.user_id
      where p.active and a.valid_until between current_date and current_date + 30
        and not exists (
          select 1 from authorisations later
           where later.organization_id = a.organization_id and later.user_id = a.user_id
             and later.kind_id = a.kind_id
             and (later.valid_until is null or later.valid_until > a.valid_until))
      order by a.valid_until limit 500`,
  );
  return rows.map((r) => ({
    kind: 'authorisation',
    ref: r.authorisation_id,
    object: { kind: 'person', id: r.user_id },
    what: m.holding_authorisation_ends({ kind: r.kind, until: r.valid_until }),
    holder: { kind: 'person', id: r.user_id },
    state: 'held',
    due: r.valid_until,
    ...linkOf(`/equipe/personnes/${encodeURIComponent(r.user_id)}`),
  }));
}
