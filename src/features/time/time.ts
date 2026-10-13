import { defineCapability, defineDataset, RuleError } from '@kete/capabilities';
import { defineCommand } from '@kete/commands';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { leaveDaysIn } from '@/features/leave';
import { listAssignments, listMembers, noteMember } from '@/features/people';
import { actingFor, currentName } from '@/platform/person';
import { mondayOf, plusDays, workingDays } from '@/lib/days';

// Time by project, in one answer a week: each person says once how her days of the week split
// between the projects she is assigned to. Nobody fills a timesheet hour by hour.

/** A rule of the week's answer a gesture broke: the screen words its code. */
export class TimeRuleError extends RuleError {
  constructor(
    override readonly code: 'not_a_monday' | 'week_too_long' | 'not_assigned' | 'week_not_started',
    facts: Record<string, string | number> = {},
  ) {
    super(code, facts);
    this.name = 'TimeRuleError';
  }
}

export function timeMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.time_weeks (
  organization_id text not null,
  user_id text not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  -- [{ projectId, projectName, days }]: her days of that week, project by project.
  entries jsonb not null,
  total numeric(3, 1) not null check (total >= 0 and total <= 7),
  said_at timestamptz not null default now(),
  primary key (organization_id, user_id, week_start)
);
${organizationPolicySql({ schema: s, table: 'time_weeks', appRole: options.appRole })}
grant select, insert, update on ${s}.time_weeks to ${options.appRole};
`;
}

export interface WeekEntry {
  projectId: string;
  projectName: string;
  days: number;
}

export interface Week {
  weekStart: string;
  /** The projects she is assigned to that week: what her answer may name. */
  projects: { projectId: string; name: string }[];
  /** Her answer, when she gave one. */
  entries: WeekEntry[] | null;
  total: number;
}

const half = z
  .number()
  .min(0)
  .max(7)
  .refine((days) => Number.isInteger(days * 2), 'Days are counted by halves.');

export const weekInput = z.object({
  /** The Monday of the week. */
  weekStart: z.iso.date(),
  entries: z.array(z.object({ projectId: z.string().min(1).max(64), days: half })).max(30),
});

/** The projects a person is assigned to in a week. */
async function projectsOf(db: SqlExecutor, userId: string, weekStart: string) {
  const assignments = await listAssignments(db, {
    userId,
    from: weekStart,
    to: plusDays(weekStart, 6),
  });
  const projects = new Map<string, string>();
  for (const assignment of assignments) projects.set(assignment.projectId, assignment.projectName);
  return [...projects].map(([projectId, name]) => ({ projectId, name }));
}

export async function weekOf(db: SqlExecutor, userId: string, day: string): Promise<Week> {
  const weekStart = mondayOf(day);
  const { rows } = await db.query<{ entries: WeekEntry[]; total: string }>(
    `select entries, total from time_weeks where user_id = $1 and week_start = $2`,
    [userId, weekStart],
  );
  return {
    weekStart,
    projects: await projectsOf(db, userId, weekStart),
    entries: rows[0]?.entries ?? null,
    total: Number(rows[0]?.total ?? 0),
  };
}

/**
 * Says how the days of a week split between her projects. Said again, it replaces what was said.
 * A week holds seven days at most, and names only projects she is assigned to that week.
 */
export const sayWeek = defineCommand({
  name: 'say-week',
  input: weekInput,
  reversibility: { reversible: false },
  async handler({ weekStart, entries }, { db, organizationId, actor }) {
    if (mondayOf(weekStart) !== weekStart) throw new TimeRuleError('not_a_monday');
    if (weekStart > new Date().toISOString().slice(0, 10)) {
      throw new TimeRuleError('week_not_started');
    }
    const userId = actingFor(actor);
    await noteMember(db, { organizationId, userId, name: currentName(userId) });
    const projects = new Map(
      (await projectsOf(db, userId, weekStart)).map((p) => [p.projectId, p.name]),
    );
    const kept: WeekEntry[] = [];
    for (const entry of entries) {
      const projectName = projects.get(entry.projectId);
      if (!projectName) throw new TimeRuleError('not_assigned', { project: entry.projectId });
      if (entry.days > 0) kept.push({ projectId: entry.projectId, projectName, days: entry.days });
    }
    // Halves add up exactly: counted in half-days, never in floats that drift.
    const total = kept.reduce((halves, entry) => halves + Math.round(entry.days * 2), 0) / 2;
    if (total > 7) throw new TimeRuleError('week_too_long');
    await db.query(
      `insert into time_weeks (organization_id, user_id, week_start, entries, total)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (organization_id, user_id, week_start)
         do update set entries = excluded.entries, total = excluded.total, said_at = now()`,
      [organizationId, userId, weekStart, JSON.stringify(kept), total],
    );
    return { weekStart, total };
  },
  summarize: ({ weekStart }) => `Week of ${weekStart} said`,
});

/** One row per person, project and week: the `time_by_project` data set. */
async function timeRows(db: SqlExecutor, query: { from?: string; to?: string; limit: number }) {
  const { rows } = await db.query<{
    week_start: string;
    user_id: string;
    project_id: string;
    project_name: string;
    days: string;
  }>(
    `select to_char(w.week_start, 'YYYY-MM-DD') as week_start, w.user_id,
            e->>'projectId' as project_id, e->>'projectName' as project_name, e->>'days' as days
       from time_weeks w, jsonb_array_elements(w.entries) e
      where ($1::date is null or w.week_start >= $1::date)
        and ($2::date is null or w.week_start <= $2::date)
      order by w.week_start, w.user_id, 3 limit $3`,
    [query.from ?? null, query.to ?? null, query.limit],
  );
  return rows.map((row) => ({
    weekStart: row.week_start,
    userId: row.user_id,
    projectId: row.project_id,
    project: row.project_name,
    days: Number(row.days),
  }));
}

export interface MonthElements {
  month: string;
  people: {
    userId: string;
    name: string;
    /** Her days by project, from her weekly answers of the weeks that start in the month. */
    projects: { projectId: string; name: string; days: number }[];
    worked: number;
    /** Her approved leave in the month, in working days, by kind. */
    leave: { annual: number; sick: number; unpaid: number; other: number };
    /** Weeks of the month that started and that she has not answered. */
    weeksMissing: number;
  }[];
}

/**
 * The month's elements, person by person: what the accountant needs to prepare the pay — days by
 * project, leave by kind, weeks without an answer. Kete does not compute a pay slip.
 */
export async function monthElements(db: SqlExecutor, month: string): Promise<MonthElements> {
  const first = `${month}-01`;
  const next = new Date(Date.parse(`${first}T00:00:00Z`));
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = plusDays(next.toISOString().slice(0, 10), -1);
  const today = new Date().toISOString().slice(0, 10);
  // The Mondays of the month that already came.
  const mondays: string[] = [];
  for (let monday = mondayOf(first); monday <= last; monday = plusDays(monday, 7)) {
    if (monday >= first && monday <= today) mondays.push(monday);
  }
  const rows = await timeRows(db, { from: first, to: last, limit: 5000 });
  const leaves = await leaveDaysIn(db, first, last);
  const { rows: said } = await db.query<{ user_id: string; week_start: string }>(
    `select user_id, to_char(week_start, 'YYYY-MM-DD') as week_start from time_weeks
      where week_start between $1::date and $2::date`,
    [first, last],
  );
  const people = (await listMembers(db))
    .filter((member) => member.active)
    .map((member) => {
      const projects = new Map<string, { projectId: string; name: string; halves: number }>();
      for (const row of rows.filter((one) => one.userId === member.userId)) {
        const project = projects.get(row.projectId) ?? {
          projectId: row.projectId,
          name: row.project,
          halves: 0,
        };
        project.halves += Math.round(row.days * 2);
        projects.set(row.projectId, project);
      }
      const leave = { annual: 0, sick: 0, unpaid: 0, other: 0 };
      for (const one of leaves.filter((each) => each.userId === member.userId)) {
        leave[one.kind] += workingDays(one.startsOn, one.endsOn);
      }
      const answered = new Set(
        said.filter((one) => one.user_id === member.userId).map((one) => one.week_start),
      );
      const byProject = [...projects.values()].map((p) => ({
        projectId: p.projectId,
        name: p.name,
        days: p.halves / 2,
      }));
      return {
        userId: member.userId,
        name: member.name,
        projects: byProject,
        worked: [...projects.values()].reduce((halves, p) => halves + p.halves, 0) / 2,
        leave,
        weeksMissing: mondays.filter((monday) => !answered.has(monday)).length,
      };
    });
  return { month, people };
}

export const timeCapabilities = [
  defineCapability({
    name: 'week_get',
    description:
      'Her week: the projects she is assigned to, and how she said her days split between them.',
    permission: 'team:member',
    autonomy: 1,
    input: z.object({ day: z.iso.date().optional() }),
    run: ({ day }, { db, actor }) =>
      weekOf(db, actor.onBehalfOf?.id ?? actor.id, day ?? new Date().toISOString().slice(0, 10)),
  }),
  defineCapability({
    name: 'month_elements',
    description:
      'The month’s elements for the pay, person by person: days by project, approved leave by kind, weeks without an answer. Figures only — no pay is computed.',
    permission: 'team:read',
    autonomy: 1,
    classification: 'confidential',
    input: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
    run: ({ month }, { db }) => monthElements(db, month),
  }),
  defineCapability({
    name: 'time_say',
    description:
      'Says how the days of a week split between the projects she is assigned to: one answer a week, in days and half-days.',
    permission: 'team:member',
    autonomy: 3,
    input: weekInput,
    command: sayWeek,
    draft: { recordType: 'week' },
  }),
];

export const timeDatasets = [
  defineDataset({
    name: 'time_by_project',
    description:
      'One row per person, project and week: the days she said she worked on it. Dated by the week’s Monday.',
    permission: 'team:read',
    classification: 'confidential',
    row: z.object({
      weekStart: z.string(),
      userId: z.string(),
      projectId: z.string(),
      project: z.string(),
      days: z.number(),
    }),
    time: 'weekStart',
    measures: ['days'],
    dimensions: ['project', 'userId'],
    rows: (query, { db }) => timeRows(db, query),
  }),
];
