import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { LeaveKind } from '../domain/days';
import type { LeaveStatus, Route } from '../domain/leave';
import type { Leave } from '../leave.record';

/** Leaves, with their row-level security in the same migration. */
export function leaveMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.leaves (
  leave_id text primary key,
  organization_id text not null,
  number text not null,
  requester_id text not null,
  requester_name text not null,
  kind text not null check (kind in ('annual', 'sick', 'unpaid', 'other')),
  starts_on date not null,
  ends_on date not null,
  days int not null check (days > 0),
  reason text,
  status text not null default 'asked'
    check (status in ('asked', 'returned', 'approved', 'refused', 'cancelled')),
  route text not null default 'waiting' check (route in ('waiting', 'center', 'here')),
  decision_request_id text,
  decided_by text,
  decided_reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, number),
  check (ends_on >= starts_on)
);
create index leaves_by_person on ${s}.leaves (organization_id, requester_id, starts_on);
create index leaves_by_status on ${s}.leaves (organization_id, status, created_at desc);
${organizationPolicySql({ schema: s, table: 'leaves', appRole: options.appRole })}
grant select, insert, update on ${s}.leaves to ${options.appRole};
`;
}

type Row = {
  leave_id: string;
  number: string;
  requester_id: string;
  requester_name: string;
  kind: LeaveKind;
  starts_on: string;
  ends_on: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  route: Route;
  decision_request_id: string | null;
  decided_by: string | null;
  decided_reason: string | null;
  asked_on: string;
};

const columns = `leave_id, number, requester_id, requester_name, kind,
  to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, days,
  reason, status, route, decision_request_id, decided_by, decided_reason,
  to_char(created_at, 'YYYY-MM-DD') as asked_on`;

const toLeave = (row: Row): Leave => ({
  leaveId: row.leave_id,
  number: row.number,
  requester: { userId: row.requester_id, name: row.requester_name },
  kind: row.kind,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  days: row.days,
  reason: row.reason,
  status: row.status,
  route: row.route,
  decisionRequestId: row.decision_request_id,
  decided: row.decided_by ? { by: row.decided_by, reason: row.decided_reason } : null,
  askedOn: row.asked_on,
});

export interface LeaveWritten {
  kind: LeaveKind;
  startsOn: string;
  endsOn: string;
  days: number;
  reason?: string | undefined;
}

export async function insertLeave(
  db: SqlExecutor,
  leave: LeaveWritten & {
    organizationId: string;
    number: string;
    requester: { userId: string; name: string };
  },
): Promise<string> {
  const leaveId = newId('lev');
  await db.query(
    `insert into leaves
       (leave_id, organization_id, number, requester_id, requester_name, kind, starts_on, ends_on,
        days, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      leaveId,
      leave.organizationId,
      leave.number,
      leave.requester.userId,
      leave.requester.name,
      leave.kind,
      leave.startsOn,
      leave.endsOn,
      leave.days,
      leave.reason ?? null,
    ],
  );
  return leaveId;
}

/** A leave corrected by who asked: it waits again, and its decision is asked again. */
export async function rewriteLeave(
  db: SqlExecutor,
  leaveId: string,
  leave: LeaveWritten,
): Promise<void> {
  await db.query(
    `update leaves
        set kind = $2, starts_on = $3, ends_on = $4, days = $5, reason = $6, status = 'asked',
            route = 'waiting', decided_by = null, decided_reason = null, decided_at = null
      where leave_id = $1`,
    [leaveId, leave.kind, leave.startsOn, leave.endsOn, leave.days, leave.reason ?? null],
  );
}

export async function findLeave(db: SqlExecutor, leaveId: string): Promise<Leave | null> {
  const { rows } = await db.query<Row>(`select ${columns} from leaves where leave_id = $1`, [
    leaveId,
  ]);
  return rows[0] ? toLeave(rows[0]) : null;
}

export async function listLeaves(
  db: SqlExecutor,
  query: {
    requesterId?: string | undefined;
    statuses?: readonly LeaveStatus[] | undefined;
    route?: Route | undefined;
    limit?: number;
  } = {},
): Promise<Leave[]> {
  const { rows } = await db.query<Row>(
    `select ${columns} from leaves
      where ($1::text is null or requester_id = $1)
        and ($2::text[] is null or status = any($2::text[]))
        and ($3::text is null or route = $3)
      order by starts_on desc, leave_id limit $4`,
    [
      query.requesterId ?? null,
      query.statuses ? [...query.statuses] : null,
      query.route ?? null,
      query.limit ?? 200,
    ],
  );
  return rows.map(toLeave);
}

/** A leave of a person, asked or approved, that shares a day with a period; another than `except`. */
export async function leaveIn(
  db: SqlExecutor,
  userId: string,
  from: string,
  to: string,
  options: { approvedOnly?: boolean; except?: string } = {},
): Promise<Leave | null> {
  const { rows } = await db.query<Row>(
    `select ${columns} from leaves
      where requester_id = $1 and starts_on <= $3::date and ends_on >= $2::date
        and status = any($4::text[]) and ($5::text is null or leave_id <> $5)
      order by starts_on limit 1`,
    [
      userId,
      from,
      to,
      options.approvedOnly ? ['approved'] : ['asked', 'returned', 'approved'],
      options.except ?? null,
    ],
  );
  return rows[0] ? toLeave(rows[0]) : null;
}

export async function setRoute(
  db: SqlExecutor,
  leaveId: string,
  route: Route,
  decisionRequestId: string | null,
): Promise<void> {
  await db.query(
    `update leaves set route = $2, decision_request_id = coalesce($3, decision_request_id)
      where leave_id = $1 and status = 'asked'`,
    [leaveId, route, decisionRequestId],
  );
}

export async function setDecided(
  db: SqlExecutor,
  leaveId: string,
  status: Extract<LeaveStatus, 'approved' | 'refused' | 'returned' | 'cancelled'>,
  decided: { by: string; reason?: string | undefined },
): Promise<void> {
  await db.query(
    `update leaves set status = $2, decided_by = $3, decided_reason = $4, decided_at = now()
      where leave_id = $1`,
    [leaveId, status, decided.by, decided.reason ?? null],
  );
}

export async function leaveOfDecision(
  db: SqlExecutor,
  decisionRequestId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ leave_id: string }>(
    `select leave_id from leaves where decision_request_id = $1`,
    [decisionRequestId],
  );
  return rows[0]?.leave_id ?? null;
}

/** The approved leave days of each person in a month, by kind: what the month's elements read. */
export async function leaveDaysIn(
  db: SqlExecutor,
  monthStart: string,
  monthEnd: string,
): Promise<{ userId: string; kind: LeaveKind; startsOn: string; endsOn: string }[]> {
  const { rows } = await db.query<{
    requester_id: string;
    kind: LeaveKind;
    starts_on: string;
    ends_on: string;
  }>(
    `select requester_id, kind,
            to_char(greatest(starts_on, $1::date), 'YYYY-MM-DD') as starts_on,
            to_char(least(ends_on, $2::date), 'YYYY-MM-DD') as ends_on
       from leaves
      where status = 'approved' and starts_on <= $2::date and ends_on >= $1::date
      order by requester_id, starts_on`,
    [monthStart, monthEnd],
  );
  return rows.map((row) => ({
    userId: row.requester_id,
    kind: row.kind,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  }));
}
