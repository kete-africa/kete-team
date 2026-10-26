import { readFileSync } from 'node:fs';
import type { KeteIdentity } from '@kete/auth';
import { assignBusinessRole, performGesture, type Caller } from '@kete/capabilities';
import { objectBody } from '@kete/center';
import { validateManifest, validateObject, validateObjectType } from '@kete/sdk';
import { assertOrganizationIsolation, createTestSchema, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import { decisionOf, leaveObjects, listLeaves } from '../src/features/leave';
import { authorisationObjects } from '../src/features/people';
import { covering, missingFor } from '../src/features/people/domain/validity';
import {
  authorisationHoldings,
  expiringWithin,
  listAssignments,
  listMembers,
} from '../src/features/people';
import { monthElements, weekOf } from '../src/features/time';
import { mondayOf, plusDays, workingDays } from '../src/lib/days';
import { transaction, usePool } from '../src/platform/db';
import { manifest } from '../src/platform/events';
import { datasets, registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';
import { syncCenter } from '../src/platform/sync';

// Spec 001 — Kete Team. The proof of step H1: « A person without a valid authorisation cannot be
// assigned »; and around it: a renewal continues what it renews, a leave is never decided by who
// asked, an approved leave keeps a person off a site, and a week is answered once.

const ORG = 'org_acme';
const SITE = 'prj_0000000000000000000000000000000a'; // requires two authorisations
const OFFICE = 'prj_0000000000000000000000000000000b'; // requires nothing
const STUDY = 'prj_0000000000000000000000000000000c';
let db: TestSchema;

const person = (userId: string, role: KeteIdentity['role'], name: string) =>
  ({
    userId,
    email: `${userId}@example.test`,
    name,
    organizationId: ORG,
    role,
    apps: {},
    twoFactor: false,
    expiresAt: new Date(Date.now() + 60_000),
  }) satisfies KeteIdentity;

const afi = person('usr_afi', 'member', 'Afi'); // keeps the team
const kossi = person('usr_kossi', 'member', 'Kossi'); // leads a project
const yao = person('usr_yao', 'member', 'Yao'); // a technician
const essi = person('usr_essi', 'member', 'Essi'); // a technician

const onScreen = (identity: KeteIdentity): Caller => ({
  actor: screenActor(identity),
  organizationId: ORG,
});

// The center: three projects who keeps the team may see, and a circuit for leave — or none.
const center = {
  circuits: new Set(['leave']),
  asked: [] as Record<string, unknown>[],
  requests: new Map<string, string>(),
  decisions: new Map<string, { status: string; decidedBy: string | null; reason: string | null }>(),
};
/** The organization's policies on an assignment, at the center: none written until a test says. */
let policy: ((gesture: Record<string, unknown>) => Record<string, unknown>) | null = null;
const names: Record<string, string> = {
  [SITE]: 'Centrale solaire — Clinique Biasa',
  [OFFICE]: 'Bureau d’études',
  [STUDY]: 'Étude École La Colombe',
};
function fakeCenter(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const path = String(input instanceof Request ? input.url : input).replace(
    'https://api.center.test',
    '',
  );
  const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const no = (error: string, status: number) => Promise.resolve(Response.json({ error }, { status }));
  const project = /^\/v1\/projects\/(prj_[0-9a-f]+)$/.exec(path)?.[1];
  if (project) {
    return names[project] && token === 'usr_afi-token'
      ? Promise.resolve(
          Response.json({
            project: {
              projectId: project,
              name: names[project],
              party: null,
              lead: { userId: 'usr_kossi', name: 'Kossi' },
              status: 'open',
              phase: null,
              sold: null,
              currency: 'XOF',
              team: [],
              posts: [],
              budget: 0,
            },
          }),
        )
      : no('not_found', 404);
  }
  if (path === '/v1/apps/prd_kete_team/gestures' && policy) {
    return Promise.resolve(Response.json({ verdict: policy(body) }));
  }
  if (path === '/v1/apps/prd_kete_team/decisions' && init?.method === 'POST') {
    center.asked.push(body);
    if (!center.circuits.has(String(body['subject']))) return no('no_circuit', 422);
    const reference = String(body['reference']);
    const requestId = center.requests.get(reference) ?? `drq_${center.requests.size + 1}`;
    center.requests.set(reference, requestId);
    center.decisions.set(requestId, { status: 'pending', decidedBy: null, reason: null });
    return Promise.resolve(Response.json({ requestId, status: 'pending' }, { status: 201 }));
  }
  const read = /^\/public\/apps\/org_acme\/decisions\/(drq_\d+)$/.exec(path);
  if (read?.[1]) {
    const decision = center.decisions.get(read[1]);
    return decision && token === 'app-token'
      ? Promise.resolve(Response.json({ requestId: read[1], subject: '', reference: '', ...decision }))
      : no('not_found', 404);
  }
  return no('not_found', 404);
}

async function gesture<T = Record<string, unknown>>(
  who: KeteIdentity,
  name: string,
  input: unknown,
) {
  const caller = onScreen(who);
  const token = `${who.userId}-token`;
  const outcome = await performGesture<T>(registry, { ...caller, name, input }, (work) =>
    asPerson(who, work, token),
  );
  if (outcome.ok) await syncCenter(token, caller);
  return outcome;
}
const done = <T>(outcome: { ok: true; output: T } | { ok: false; code: string }): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);
  return outcome.output;
};

const today = new Date().toISOString().slice(0, 10);
const day = (offset: number) => plusDays(today, offset);
const ids = {} as Record<'electrical' | 'height' | 'siteWork' | 'essiLeave' | 'yaoLeave', string>;

beforeAll(async () => {
  process.env.ENTERPRISE_API_URL = 'https://api.center.test';
  process.env.PUBLIC_URL = 'https://team.test';
  vi.stubGlobal('fetch', fakeCenter);
  db = await createTestSchema({
    migrate: async (owner, context) => {
      for (const migration of migrations) await owner.query(migration.sql(context));
    },
  });
  usePool(db.app);
  await transaction(ORG, async (client) => {
    await assignBusinessRole(client, ORG, afi.userId, 'hr');
    await assignBusinessRole(client, ORG, kossi.userId, 'lead');
    await assignBusinessRole(client, ORG, yao.userId, 'staff');
    await assignBusinessRole(client, ORG, essi.userId, 'staff');
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.ENTERPRISE_API_URL;
  await db.drop();
});

describe('what covers a period', () => {
  const held = [
    { kindId: 'k', validFrom: '2026-01-01', validUntil: '2026-11-06' },
    { kindId: 'forever', validFrom: '2025-06-01', validUntil: null },
  ];
  it('is an authorisation valid from its first day to its last', () => {
    expect(covering(held, 'k', '2026-11-02', '2026-11-06')).toBe('valid');
    expect(covering(held, 'k', '2026-11-02', '2026-11-13')).toBe('expired');
    expect(covering(held, 'k', '2025-12-30', '2026-01-05')).toBe('expired');
    expect(covering(held, 'forever', '2026-11-02', '2030-01-01')).toBe('valid');
    expect(covering(held, 'other', '2026-11-02', '2026-11-13')).toBe('missing');
  });

  it('counts a renewal that follows without a day between, and refuses a gap', () => {
    const renewed = [...held, { kindId: 'k', validFrom: '2026-11-07', validUntil: '2027-11-06' }];
    expect(covering(renewed, 'k', '2026-11-02', '2026-11-13')).toBe('valid');
    const late = [...held, { kindId: 'k', validFrom: '2026-11-10', validUntil: '2027-11-09' }];
    expect(covering(late, 'k', '2026-11-02', '2026-11-13')).toBe('expired');
    expect(
      missingFor([{ kindId: 'k', name: 'B1V' }], late, '2026-11-02', '2026-11-13'),
    ).toEqual([{ kindId: 'k', name: 'B1V', why: 'expired', until: '2027-11-09' }]);
  });

  it('counts the working days of a period', () => {
    expect(workingDays('2026-10-12', '2026-10-18')).toBe(5);
    expect(workingDays('2026-10-17', '2026-10-18')).toBe(0);
    expect(mondayOf('2026-10-15')).toBe('2026-10-12');
  });
});

describe('a person without a valid authorisation cannot be assigned', () => {
  it('starts from what the project requires of whoever works on it', async () => {
    ids.electrical = done(
      await gesture<{ kindId: string }>(afi, 'authorisations_name_kind', {
        name: 'Habilitation électrique B1V',
      }),
    ).kindId;
    ids.height = done(
      await gesture<{ kindId: string }>(afi, 'authorisations_name_kind', {
        name: 'Travail en hauteur',
      }),
    ).kindId;
    for (const who of [yao, essi]) {
      done(await gesture(afi, 'members_add', { userId: who.userId, name: who.name }));
    }
    done(
      await gesture(afi, 'projects_require', {
        projectId: SITE,
        kindIds: [ids.electrical, ids.height],
      }),
    );
    // Who leads a project reads the team, and does not change what a project requires.
    expect(
      await gesture(kossi, 'projects_require', { projectId: SITE, kindIds: [] }),
    ).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('refuses who never held what the project requires, and names it', async () => {
    const work = { userId: yao.userId, projectId: SITE, startsOn: day(10), endsOn: day(21) };
    expect(await gesture(afi, 'assignments_assign', work)).toEqual({
      ok: false,
      code: 'authorisation_missing',
      facts: { kind: 'Habilitation électrique B1V', until: '', person: 'Yao' },
    });
    expect(await transaction(ORG, (tx) => listAssignments(tx, { userId: yao.userId }))).toEqual([]);
  });

  it('refuses when an authorisation ends before the work does, and says the day', async () => {
    done(
      await gesture(afi, 'authorisations_grant', {
        userId: yao.userId,
        kindId: ids.electrical,
        validFrom: day(-300),
        validUntil: day(14),
        proof: 'Certificat n° 2291',
      }),
    );
    done(
      await gesture(afi, 'authorisations_grant', {
        userId: yao.userId,
        kindId: ids.height,
        validFrom: day(-500),
      }),
    );
    const work = { userId: yao.userId, projectId: SITE, startsOn: day(10), endsOn: day(21) };
    expect(await gesture(afi, 'assignments_assign', work)).toEqual({
      ok: false,
      code: 'authorisation_expired',
      facts: { kind: 'Habilitation électrique B1V', until: day(14), person: 'Yao' },
    });
    // It is said to expire soon, to who keeps the team — and to her.
    const expiring = await transaction(ORG, (tx) => expiringWithin(tx, 60));
    expect(expiring).toEqual([
      expect.objectContaining({ userId: 'usr_yao', kindName: 'Habilitation électrique B1V', validUntil: day(14) }),
    ]);
  });

  it('assigns her for the days she is covered, or once it is renewed', async () => {
    // Shorter: within what she holds.
    const short = done(
      await gesture<{ assignmentId: string }>(afi, 'assignments_assign', {
        userId: yao.userId,
        projectId: SITE,
        startsOn: day(10),
        endsOn: day(14),
        role: 'Électricien',
      }),
    );
    ids.siteWork = short.assignmentId;
    // Never made longer than what was checked.
    expect(
      await gesture(afi, 'assignments_end', { assignmentId: ids.siteWork, endsOn: day(21) }),
    ).toMatchObject({ ok: false, code: 'period_invalid' });
    done(await gesture(afi, 'assignments_end', { assignmentId: ids.siteWork, endsOn: day(12) }));
    // Renewed from the day after: the whole period is covered.
    done(
      await gesture(afi, 'authorisations_grant', {
        userId: yao.userId,
        kindId: ids.electrical,
        validFrom: day(15),
        validUntil: day(380),
      }),
    );
    done(
      await gesture(afi, 'assignments_assign', {
        userId: yao.userId,
        projectId: SITE,
        startsOn: day(13),
        endsOn: day(21),
      }),
    );
    // Renewed, it is no longer said to expire.
    expect(await transaction(ORG, (tx) => expiringWithin(tx, 60))).toEqual([]);
    const assigned = await transaction(ORG, (tx) => listAssignments(tx, { projectId: SITE }));
    expect(assigned.map((one) => [one.memberName, one.startsOn, one.endsOn])).toEqual([
      ['Yao', day(13), day(21)],
      ['Yao', day(10), day(12)],
    ]);
  });

  it('applies to an agent as to anyone: it prepares, and the rule decides', async () => {
    const asked = await asPerson(
      afi,
      () =>
        registry.invoke({
          actor: {
            kind: 'agent',
            id: 'agt_mcp',
            channel: 'mcp',
            onBehalfOf: { kind: 'person', id: afi.userId },
          },
          organizationId: ORG,
          name: 'assignments_assign',
          input: { userId: essi.userId, projectId: SITE, startsOn: day(10), endsOn: day(12) },
        }),
      'usr_afi-token',
    );
    expect(asked).toMatchObject({ status: 'draft' });
    const { draftId } = asked as { draftId: string };
    // Afi validates the draft: Essi holds nothing — the assignment is refused all the same.
    await expect(
      asPerson(
        afi,
        () =>
          registry.decide({ ...onScreen(afi), draftId, action: 'validate', confirmed: true }),
        'usr_afi-token',
      ),
    ).rejects.toMatchObject({ code: 'authorisation_missing' });
    expect(await transaction(ORG, (tx) => listAssignments(tx, { userId: essi.userId }))).toEqual([]);
  });
});

describe('leave', () => {
  it('goes to the center’s circuit, with its working days', async () => {
    const from = mondayOf(day(35));
    const asked = done(
      await gesture<{ leaveId: string; number: string; days: number }>(essi, 'leaves_ask', {
        kind: 'annual',
        startsOn: from,
        endsOn: plusDays(from, 6),
        reason: 'Mariage de ma sœur',
      }),
    );
    ids.essiLeave = asked.leaveId;
    expect(asked).toMatchObject({ number: `CG-${today.slice(0, 4)}-0001`, days: 5 });
    expect(center.asked.at(-1)).toMatchObject({
      subject: 'leave',
      reference: ids.essiLeave,
      measure: 5,
    });
    const [leave] = await transaction(ORG, (tx) => listLeaves(tx, { requesterId: essi.userId }));
    expect(leave).toMatchObject({ status: 'asked', route: 'center' });
    // One leave at a time on a day; and a week-end is not a leave.
    expect(
      await gesture(essi, 'leaves_ask', { kind: 'sick', startsOn: plusDays(from, 2), endsOn: plusDays(from, 3) }),
    ).toMatchObject({ ok: false, code: 'already_on_leave' });
    expect(
      await gesture(essi, 'leaves_ask', {
        kind: 'annual',
        startsOn: plusDays(from, 12),
        endsOn: plusDays(from, 13),
      }),
    ).toMatchObject({ ok: false, code: 'no_working_day' });
    // The center decides it: nobody decides it here.
    expect(
      await gesture(afi, 'leaves_decide', { leaveId: ids.essiLeave, decision: 'approve' }),
    ).toMatchObject({ ok: false, code: 'decided_at_the_center' });
  });

  it('keeps a person off a project once approved', async () => {
    const [leave] = await transaction(ORG, (tx) => listLeaves(tx, { requesterId: essi.userId }));
    const work = {
      userId: essi.userId,
      projectId: OFFICE,
      startsOn: plusDays(leave?.startsOn ?? '', -3),
      endsOn: plusDays(leave?.endsOn ?? '', 3),
    };
    // Asked is not approved: she may still be planned.
    const planned = done(await gesture<{ assignmentId: string }>(afi, 'assignments_assign', work));
    done(
      await gesture(afi, 'assignments_end', {
        assignmentId: planned.assignmentId,
        endsOn: work.startsOn,
      }),
    );
    center.decisions.set(center.requests.get(ids.essiLeave) ?? '', {
      status: 'approved',
      decidedBy: 'Kossi',
      reason: null,
    });
    expect(await decisionOf('app-token', ORG, center.requests.get(ids.essiLeave) ?? '')).toBe(true);
    expect(
      await gesture(afi, 'assignments_assign', { ...work, startsOn: plusDays(work.startsOn, 1) }),
    ).toEqual({
      ok: false,
      code: 'on_leave',
      facts: { person: 'Essi', from: leave?.startsOn, to: leave?.endsOn },
    });
  });

  it('is decided here without a circuit — never by who asked, and sent back with a reason', async () => {
    center.circuits.clear();
    const from = mondayOf(day(63));
    const asked = done(
      await gesture<{ leaveId: string }>(yao, 'leaves_ask', {
        kind: 'unpaid',
        startsOn: from,
        endsOn: plusDays(from, 1),
      }),
    );
    ids.yaoLeave = asked.leaveId;
    const decide = (who: KeteIdentity, decision: string, reason?: string) =>
      gesture(who, 'leaves_decide', { leaveId: ids.yaoLeave, decision, ...(reason ? { reason } : {}) });
    expect(await decide(kossi, 'approve')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await decide(afi, 'return')).toMatchObject({ ok: false, code: 'reason_required' });
    done(await decide(afi, 'return', 'Prenez plutôt un congé annuel.'));
    // Only who asked corrects it; corrected, it waits again.
    expect(
      await gesture(essi, 'leaves_correct', {
        leaveId: ids.yaoLeave,
        kind: 'annual',
        startsOn: from,
        endsOn: plusDays(from, 1),
      }),
    ).toMatchObject({ ok: false, code: 'not_the_requester' });
    done(
      await gesture(yao, 'leaves_correct', {
        leaveId: ids.yaoLeave,
        kind: 'annual',
        startsOn: from,
        endsOn: plusDays(from, 1),
      }),
    );
    done(await decide(afi, 'approve'));
    const [leave] = await transaction(ORG, (tx) => listLeaves(tx, { requesterId: yao.userId }));
    expect(leave).toMatchObject({ status: 'approved', kind: 'annual', days: 2, decided: { by: 'Afi' } });
    // Afi's own leave is not hers to approve.
    const own = done(
      await gesture<{ leaveId: string }>(afi, 'leaves_ask', {
        kind: 'annual',
        startsOn: from,
        endsOn: from,
      }),
    );
    expect(
      await gesture(afi, 'leaves_decide', { leaveId: own.leaveId, decision: 'approve' }),
    ).toMatchObject({ ok: false, code: 'own_request' });
  });
});

describe('time by project, in one answer a week', () => {
  const monday = mondayOf(today);
  it('asks only the projects she is assigned to that week', async () => {
    for (const projectId of [OFFICE, STUDY]) {
      done(
        await gesture(afi, 'assignments_assign', {
          userId: yao.userId,
          projectId,
          startsOn: day(-14),
          endsOn: day(6),
        }),
      );
    }
    const week = await transaction(ORG, (tx) => weekOf(tx, yao.userId, today));
    expect(week).toMatchObject({ weekStart: monday, entries: null });
    expect(week.projects.map((p) => p.projectId).sort()).toEqual([OFFICE, STUDY].sort());
    // The site starts later: it is not of this week.
    expect(
      await gesture(yao, 'time_say', { weekStart: monday, entries: [{ projectId: SITE, days: 1 }] }),
    ).toMatchObject({ ok: false, code: 'not_assigned' });
    expect(
      await gesture(yao, 'time_say', { weekStart: plusDays(monday, 1), entries: [] }),
    ).toMatchObject({ ok: false, code: 'not_a_monday' });
  });

  it('holds seven days at most, in halves, and a second answer replaces the first', async () => {
    const say = (office: number, study: number) =>
      gesture<{ total: number }>(yao, 'time_say', {
        weekStart: monday,
        entries: [
          { projectId: OFFICE, days: office },
          { projectId: STUDY, days: study },
        ],
      });
    expect(await say(4, 3.5)).toMatchObject({ ok: false, code: 'week_too_long' });
    expect(await say(2.25, 1)).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(done(await say(3.5, 1)).total).toBe(4.5);
    expect(done(await say(3, 2)).total).toBe(5);
    const week = await transaction(ORG, (tx) => weekOf(tx, yao.userId, today));
    expect(week.entries).toEqual([
      { projectId: OFFICE, projectName: 'Bureau d’études', days: 3 },
      { projectId: STUDY, projectName: 'Étude École La Colombe', days: 2 },
    ]);
  });

  it('gives the month’s elements for the pay, and the days as a data set', async () => {
    const elements = await transaction(ORG, (tx) => monthElements(tx, monday.slice(0, 7)));
    const his = elements.people.find((one) => one.userId === yao.userId);
    expect(his).toMatchObject({ name: 'Yao', worked: 5 });
    expect(his?.projects.map((p) => [p.name, p.days]).sort()).toEqual([
      ['Bureau d’études', 3],
      ['Étude École La Colombe', 2],
    ]);
    const read = await asPerson(afi, () => datasets.read(onScreen(afi), 'time_by_project', {}));
    expect(read).toMatchObject({ status: 'done', dataset: 'time_by_project' });
    expect(await asPerson(yao, () => datasets.read(onScreen(yao), 'time_by_project', {}))).toEqual({
      status: 'refused',
      reason: 'not_allowed',
    });
  });
});

describe('who reads what', () => {
  it('shows a person her own, and everyone’s to who keeps or leads the team', async () => {
    const leaves = async (who: KeteIdentity) =>
      done(await gesture<{ number: string }[]>(who, 'leave_list', {})).length;
    expect(await leaves(yao)).toBe(1);
    expect(await leaves(kossi)).toBe(3);
    expect(done(await gesture<unknown[]>(yao, 'authorisations_of', { userId: essi.userId }))).toHaveLength(3);
    expect(await gesture(yao, 'member_list', {})).toMatchObject({ ok: false, code: 'not_allowed' });
    // Whoever asked or answered is on the roster.
    const roster = await transaction(ORG, (tx) => listMembers(tx));
    expect(roster.map((member) => member.name).sort()).toEqual(['Afi', 'Essi', 'Yao']);
  });

  it('keeps each organization’s roster and leave to itself (RLS)', async () => {
    await assertOrganizationIsolation({
      app: db.app,
      table: 'members',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into members (organization_id, user_id, name) values ($1, 'usr_x', 'x')`,
          [organizationId],
        );
      },
    });
    await assertOrganizationIsolation({
      app: db.app,
      table: 'leaves',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into leaves (leave_id, organization_id, number, requester_id, requester_name,
                               kind, starts_on, ends_on, days)
           values ($1, $2, 'CG-1', 'usr_x', 'x', 'annual', current_date, current_date, 1)`,
          [`lev_${organizationId}`, organizationId],
        );
      },
    });
  });
});

describe('the living model (spec 004)', () => {
  it('passes an assignment through the organization’s policies, and says their sentence', async () => {
    const work = { userId: essi.userId, projectId: OFFICE, startsOn: day(60), endsOn: day(62) };
    policy = (gesture) => ({
      effect: 'refuse',
      policies: [{ id: 'assign.lead', sentence: 'Seul le responsable du projet y affecte' }],
      approvers: [],
      echo: gesture,
    });
    expect(await gesture(afi, 'assignments_assign', work)).toEqual({
      ok: false,
      code: 'refused_by_policy',
      facts: { why: 'Seul le responsable du projet y affecte' },
    });
    policy = () => ({
      effect: 'approve',
      policies: [{ id: 'assign.long', sentence: 'Au-delà de deux jours, la direction approuve' }],
      approvers: [{ approver: 'manager', people: ['usr_yao'] }],
    });
    expect(await gesture(afi, 'assignments_assign', work)).toEqual({
      ok: false,
      code: 'approval_required',
      facts: { who: 'Yao', why: 'Au-delà de deux jours, la direction approuve' },
    });
    policy = () => ({ effect: 'allow', policies: [], approvers: [] });
    done(await gesture(afi, 'assignments_assign', work));
    policy = null;
  });

  it('says an authorisation ending within thirty days as its holder’s to renew', async () => {
    const kind = done(
      await gesture<{ kindId: string }>(afi, 'authorisations_name_kind', { name: 'Travail en hauteur — recyclage' }),
    );
    done(
      await gesture(afi, 'authorisations_grant', {
        userId: essi.userId,
        kindId: kind.kindId,
        validFrom: day(-300),
        validUntil: day(5),
      }),
    );
    const holdings = await transaction(ORG, (tx) => authorisationHoldings(tx));
    expect(holdings).toContainEqual(
      expect.objectContaining({
        kind: 'authorisation',
        holder: { kind: 'person', id: 'usr_essi' },
        due: day(5),
        href: 'https://team.test/equipe/personnes/usr_essi',
      }),
    );
  });
});

describe('its objects in the center’s index (spec 006; kete-core spec 142)', () => {
  it('says its leaves and authorisations, each with its holder and a state its kind declares', async () => {
    const card = manifest();
    expect((card.objects ?? []).map((o) => o.kind)).toEqual(['leave', 'authorisation']);
    for (const kind of card.objects ?? []) expect(validateObjectType(kind).ok).toBe(true);
    const objects = await transaction(ORG, async (tx) => [
      ...(await leaveObjects(tx)),
      ...(await authorisationObjects(tx)),
    ]);
    expect(objects.some((o) => o.kind === 'leave')).toBe(true);
    // The authorisation ending in five days says so.
    expect(objects).toContainEqual(
      expect.objectContaining({ kind: 'authorisation', state: 'ending', personId: 'usr_essi' }),
    );
    const states = new Map((card.objects ?? []).map((k) => [k.kind, k.states.map((x) => x.id)]));
    for (const object of objects) {
      expect(validateObject(objectBody(object)).ok).toBe(true);
      expect(states.get(object.kind)).toContain(object.state);
    }
  });
});

describe('what the app says about itself', () => {
  it('serves a valid manifest: what it asks the center, its events, its gestures', () => {
    const card = manifest();
    expect(validateManifest(card).ok).toBe(true);
    expect(card).toMatchObject({ product: 'prd_kete_team', name: 'Kete Team' });
    expect(card.subjects?.map((s) => s.name)).toEqual(['leave']);
    expect(card.emits?.map((e) => e.type)).toEqual(['assignment.made', 'leave.asked', 'leave.approved']);
    expect(card.capabilities?.map((c) => c.name)).toEqual(
      expect.arrayContaining(['assignments_assign', 'authorisations_expiring', 'leaves_ask', 'time_say']),
    );
    expect(card.datasets?.map((d) => d.name)).toEqual(['time_by_project']);
  });

  it('says the same words in every language', () => {
    const fr = JSON.parse(readFileSync(new URL('../messages/fr.json', import.meta.url), 'utf8'));
    const en = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });
});
