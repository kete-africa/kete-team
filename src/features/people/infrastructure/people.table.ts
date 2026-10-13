import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { Held } from '../domain/validity';
import type { Assignment, Authorisation, Kind, Member } from '../people.record';

/** The roster, with its row-level security in the same migration. */
export function peopleMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.members (
  organization_id text not null,
  user_id text not null,
  name text not null check (length(name) between 1 and 200),
  joined_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
${policy('members')}
grant select, insert, update on ${s}.members to ${options.appRole};

create table ${s}.authorisation_kinds (
  kind_id text primary key,
  organization_id text not null,
  name text not null check (length(name) between 1 and 120),
  unique (organization_id, name)
);
${policy('authorisation_kinds')}
grant select, insert on ${s}.authorisation_kinds to ${options.appRole};

create table ${s}.authorisations (
  authorisation_id text primary key,
  organization_id text not null,
  user_id text not null,
  kind_id text not null references ${s}.authorisation_kinds (kind_id),
  valid_from date not null,
  valid_until date,
  proof text,
  granted_by text not null,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);
create index authorisations_by_person on ${s}.authorisations (organization_id, user_id);
create index authorisations_by_expiry on ${s}.authorisations (organization_id, valid_until);
${policy('authorisations')}
grant select, insert on ${s}.authorisations to ${options.appRole};

create table ${s}.project_requirements (
  organization_id text not null,
  project_id text not null,
  project_name text not null,
  kind_id text not null references ${s}.authorisation_kinds (kind_id),
  primary key (organization_id, project_id, kind_id)
);
${policy('project_requirements')}
grant select, insert, delete on ${s}.project_requirements to ${options.appRole};

create table ${s}.assignments (
  assignment_id text primary key,
  organization_id text not null,
  user_id text not null,
  project_id text not null,
  project_name text not null,
  role text,
  starts_on date not null,
  ends_on date not null,
  assigned_by text not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index assignments_by_person on ${s}.assignments (organization_id, user_id, starts_on);
create index assignments_by_project on ${s}.assignments (organization_id, project_id, starts_on);
${policy('assignments')}
grant select, insert, update on ${s}.assignments to ${options.appRole};
`;
}

export async function upsertMember(
  db: SqlExecutor,
  member: { organizationId: string; userId: string; name: string; joinedOn?: string | undefined },
): Promise<void> {
  await db.query(
    `insert into members (organization_id, user_id, name, joined_on) values ($1, $2, $3, $4)
     on conflict (organization_id, user_id) do update
       set name = excluded.name, joined_on = coalesce(excluded.joined_on, members.joined_on),
           active = true`,
    [member.organizationId, member.userId, member.name, member.joinedOn ?? null],
  );
}

/** Whoever acts here is of the team: she is noted the first time, and never renamed by it. */
export async function noteMember(
  db: SqlExecutor,
  member: { organizationId: string; userId: string; name: string },
): Promise<void> {
  await db.query(
    `insert into members (organization_id, user_id, name) values ($1, $2, $3)
     on conflict (organization_id, user_id) do nothing`,
    [member.organizationId, member.userId, member.name],
  );
}

type MemberRow = { user_id: string; name: string; joined_on: string | null; active: boolean };
const toMember = (row: MemberRow): Member => ({
  userId: row.user_id,
  name: row.name,
  joinedOn: row.joined_on,
  active: row.active,
});
const memberColumns = `user_id, name, to_char(joined_on, 'YYYY-MM-DD') as joined_on, active`;

export async function listMembers(db: SqlExecutor): Promise<Member[]> {
  const { rows } = await db.query<MemberRow>(
    `select ${memberColumns} from members order by active desc, lower(name), user_id`,
  );
  return rows.map(toMember);
}

export async function findMember(db: SqlExecutor, userId: string): Promise<Member | null> {
  const { rows } = await db.query<MemberRow>(
    `select ${memberColumns} from members where user_id = $1`,
    [userId],
  );
  return rows[0] ? toMember(rows[0]) : null;
}

export async function insertKind(
  db: SqlExecutor,
  organizationId: string,
  name: string,
): Promise<string> {
  const { rows } = await db.query<{ kind_id: string }>(
    `insert into authorisation_kinds (kind_id, organization_id, name) values ($1, $2, $3)
     on conflict (organization_id, name) do update set name = excluded.name returning kind_id`,
    [newId('knd'), organizationId, name],
  );
  return (rows[0] as { kind_id: string }).kind_id;
}

export async function listKinds(db: SqlExecutor): Promise<Kind[]> {
  const { rows } = await db.query<{ kind_id: string; name: string }>(
    `select kind_id, name from authorisation_kinds order by lower(name), kind_id`,
  );
  return rows.map((row) => ({ kindId: row.kind_id, name: row.name }));
}

export async function insertAuthorisation(
  db: SqlExecutor,
  authorisation: {
    organizationId: string;
    userId: string;
    kindId: string;
    validFrom: string;
    validUntil?: string | undefined;
    proof?: string | undefined;
    grantedBy: string;
  },
): Promise<string> {
  const authorisationId = newId('aut');
  await db.query(
    `insert into authorisations
       (authorisation_id, organization_id, user_id, kind_id, valid_from, valid_until, proof,
        granted_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      authorisationId,
      authorisation.organizationId,
      authorisation.userId,
      authorisation.kindId,
      authorisation.validFrom,
      authorisation.validUntil ?? null,
      authorisation.proof ?? null,
      authorisation.grantedBy,
    ],
  );
  return authorisationId;
}

type AuthorisationRow = {
  authorisation_id: string;
  user_id: string;
  member_name: string;
  kind_id: string;
  kind_name: string;
  valid_from: string;
  valid_until: string | null;
  proof: string | null;
};
const authorisationSelect = `select a.authorisation_id, a.user_id, coalesce(m.name, a.user_id) as member_name,
    a.kind_id, k.name as kind_name, to_char(a.valid_from, 'YYYY-MM-DD') as valid_from,
    to_char(a.valid_until, 'YYYY-MM-DD') as valid_until, a.proof
  from authorisations a
  join authorisation_kinds k on k.kind_id = a.kind_id
  left join members m on m.user_id = a.user_id and m.organization_id = a.organization_id`;
const toAuthorisation = (row: AuthorisationRow): Authorisation => ({
  authorisationId: row.authorisation_id,
  userId: row.user_id,
  memberName: row.member_name,
  kindId: row.kind_id,
  kindName: row.kind_name,
  validFrom: row.valid_from,
  validUntil: row.valid_until,
  proof: row.proof,
});

export async function authorisationsOf(db: SqlExecutor, userId: string): Promise<Authorisation[]> {
  const { rows } = await db.query<AuthorisationRow>(
    `${authorisationSelect} where a.user_id = $1 order by k.name, a.valid_from desc`,
    [userId],
  );
  return rows.map(toAuthorisation);
}

/** What a person holds, as the rules read it. */
export async function heldBy(db: SqlExecutor, userId: string): Promise<Held[]> {
  return (await authorisationsOf(db, userId)).map((one) => ({
    kindId: one.kindId,
    validFrom: one.validFrom,
    validUntil: one.validUntil,
  }));
}

/**
 * The authorisations that end within `days` — each person's latest of each kind only: one that
 * was renewed is not said to expire.
 */
export async function expiringWithin(
  db: SqlExecutor,
  days: number,
  userId?: string,
): Promise<Authorisation[]> {
  const { rows } = await db.query<AuthorisationRow>(
    `select * from (${authorisationSelect}
        where a.valid_until is not null and ($2::text is null or a.user_id = $2)
          and not exists (
            select 1 from authorisations later
             where later.user_id = a.user_id and later.kind_id = a.kind_id
               and (later.valid_until is null or later.valid_until > a.valid_until))
      ) latest
      where latest.valid_until <= to_char(current_date + $1::int, 'YYYY-MM-DD')
      order by latest.valid_until, latest.member_name`,
    [days, userId ?? null],
  );
  return rows.map(toAuthorisation);
}

/** What a project requires of whoever is assigned to it. */
export async function requirementsOf(db: SqlExecutor, projectId: string): Promise<Kind[]> {
  const { rows } = await db.query<{ kind_id: string; name: string }>(
    `select r.kind_id, k.name from project_requirements r
       join authorisation_kinds k on k.kind_id = r.kind_id
      where r.project_id = $1 order by lower(k.name)`,
    [projectId],
  );
  return rows.map((row) => ({ kindId: row.kind_id, name: row.name }));
}

export async function setRequirements(
  db: SqlExecutor,
  organizationId: string,
  project: { projectId: string; name: string },
  kindIds: readonly string[],
): Promise<void> {
  await db.query(`delete from project_requirements where project_id = $1`, [project.projectId]);
  for (const kindId of kindIds) {
    await db.query(
      `insert into project_requirements (organization_id, project_id, project_name, kind_id)
       values ($1, $2, $3, $4)`,
      [organizationId, project.projectId, project.name, kindId],
    );
  }
}

/** The projects this app already knows, by what was required or assigned on them. */
export async function knownProjects(
  db: SqlExecutor,
): Promise<{ projectId: string; name: string }[]> {
  const { rows } = await db.query<{ project_id: string; name: string }>(
    `select project_id, max(project_name) as name from (
       select project_id, project_name from project_requirements
       union all
       select project_id, project_name from assignments
     ) known group by project_id order by 2, 1 limit 200`,
  );
  return rows.map((row) => ({ projectId: row.project_id, name: row.name }));
}

export async function insertAssignment(
  db: SqlExecutor,
  assignment: {
    organizationId: string;
    userId: string;
    projectId: string;
    projectName: string;
    role?: string | undefined;
    startsOn: string;
    endsOn: string;
    assignedBy: string;
  },
): Promise<string> {
  const assignmentId = newId('asg');
  await db.query(
    `insert into assignments
       (assignment_id, organization_id, user_id, project_id, project_name, role, starts_on,
        ends_on, assigned_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      assignmentId,
      assignment.organizationId,
      assignment.userId,
      assignment.projectId,
      assignment.projectName,
      assignment.role ?? null,
      assignment.startsOn,
      assignment.endsOn,
      assignment.assignedBy,
    ],
  );
  return assignmentId;
}

type AssignmentRow = {
  assignment_id: string;
  user_id: string;
  member_name: string;
  project_id: string;
  project_name: string;
  role: string | null;
  starts_on: string;
  ends_on: string;
};
const assignmentSelect = `select a.assignment_id, a.user_id, coalesce(m.name, a.user_id) as member_name,
    a.project_id, a.project_name, a.role, to_char(a.starts_on, 'YYYY-MM-DD') as starts_on,
    to_char(a.ends_on, 'YYYY-MM-DD') as ends_on
  from assignments a
  left join members m on m.user_id = a.user_id and m.organization_id = a.organization_id`;
const toAssignment = (row: AssignmentRow): Assignment => ({
  assignmentId: row.assignment_id,
  userId: row.user_id,
  memberName: row.member_name,
  projectId: row.project_id,
  projectName: row.project_name,
  role: row.role,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
});

/** Assignments, the latest first: of a person, of a project, or that touch a period. */
export async function listAssignments(
  db: SqlExecutor,
  query: {
    userId?: string | undefined;
    projectId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    limit?: number;
  } = {},
): Promise<Assignment[]> {
  const { rows } = await db.query<AssignmentRow>(
    `${assignmentSelect}
      where ($1::text is null or a.user_id = $1)
        and ($2::text is null or a.project_id = $2)
        and ($3::date is null or a.ends_on >= $3::date)
        and ($4::date is null or a.starts_on <= $4::date)
      order by a.starts_on desc, a.assignment_id limit $5`,
    [
      query.userId ?? null,
      query.projectId ?? null,
      query.from ?? null,
      query.to ?? null,
      query.limit ?? 300,
    ],
  );
  return rows.map(toAssignment);
}

export async function findAssignment(
  db: SqlExecutor,
  assignmentId: string,
): Promise<Assignment | null> {
  const { rows } = await db.query<AssignmentRow>(
    `${assignmentSelect} where a.assignment_id = $1`,
    [assignmentId],
  );
  return rows[0] ? toAssignment(rows[0]) : null;
}

export async function endAssignmentOn(
  db: SqlExecutor,
  assignmentId: string,
  endsOn: string,
): Promise<void> {
  await db.query(`update assignments set ends_on = $2 where assignment_id = $1`, [
    assignmentId,
    endsOn,
  ]);
}
