import type { KeteIdentity } from '@kete/auth';
import { assignBusinessRole } from '@kete/capabilities';
import type { SqlExecutor } from '@kete/tenancy';
import { mondayOf, plusDays } from '@/lib/days';
import { transaction } from '@/platform/db';
import { registry } from '@/platform/registry';
import { asPerson } from '@/platform/rights';
import { screenActor } from '@/platform/session';
import { syncCenter } from '@/platform/sync';

// The demonstration's data: the team of a small solar installer, a few weeks into its autumn.
// Everything is written through the app's own gestures, as its people would.

export const DEMO_ORGANIZATION = 'org_demo_team';

const person = (userId: string, name: string, role: KeteIdentity['role']): KeteIdentity => ({
  userId,
  email: `${userId}@example.test`,
  name,
  organizationId: DEMO_ORGANIZATION,
  role,
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 8 * 3_600_000),
});

/** Who the demonstration can be opened as: the owner, and one person per role of the trade. */
export const demoPeople = {
  owner: person('usr_demo_afi', 'Afi Mensah', 'owner'),
  hr: person('usr_demo_lawson', 'Mme Lawson', 'member'),
  lead: person('usr_demo_kossi', 'Kossi Adjo', 'member'),
  staff: person('usr_demo_yao', 'Yao Agbeko', 'member'),
} as const;
const essi = person('usr_demo_essi', 'Essi Dogbe', 'member');

async function act<T = Record<string, unknown>>(
  who: KeteIdentity,
  name: string,
  input: unknown,
): Promise<T> {
  const result = await asPerson(who, () =>
    registry.invoke({
      actor: screenActor(who),
      organizationId: DEMO_ORGANIZATION,
      name,
      input,
      confirmed: true,
    }),
  );
  if (result.status !== 'done') throw new Error(`${name}: ${JSON.stringify(result)}`);
  await syncCenter(null, { actor: screenActor(who), organizationId: DEMO_ORGANIZATION });
  return result.output as T;
}

const today = () => new Date().toISOString().slice(0, 10);
const day = (offset: number) => plusDays(today(), offset);

/**
 * Projects come from the center; the demonstration runs without one. Two are written here as the
 * app would know them after a first assignment: what a project requires, by its name.
 */
async function knownProject(db: SqlExecutor, projectId: string, name: string, kindId: string) {
  await db.query(
    `insert into project_requirements (organization_id, project_id, project_name, kind_id)
     values ($1, $2, $3, $4)`,
    [DEMO_ORGANIZATION, projectId, name, kindId],
  );
}

export async function seedDemo(): Promise<void> {
  const { owner, hr, lead, staff } = demoPeople;
  await transaction(DEMO_ORGANIZATION, async (db) => {
    await assignBusinessRole(db, DEMO_ORGANIZATION, hr.userId, 'hr');
    await assignBusinessRole(db, DEMO_ORGANIZATION, lead.userId, 'lead');
    await assignBusinessRole(db, DEMO_ORGANIZATION, staff.userId, 'staff');
    await assignBusinessRole(db, DEMO_ORGANIZATION, essi.userId, 'staff');
  });

  for (const who of [owner, hr, lead, staff, essi]) {
    await act(hr, 'members_add', { userId: who.userId, name: who.name, joinedOn: day(-400) });
  }
  const kind = async (name: string) =>
    (await act<{ kindId: string }>(hr, 'authorisations_name_kind', { name })).kindId;
  const electrical = await kind('Habilitation électrique B1V');
  const height = await kind('Travail en hauteur');
  const licence = await kind('Permis de conduire B');

  const site = 'prj_demo_clinique_biasa';
  const office = 'prj_demo_bureau_etudes';
  await transaction(DEMO_ORGANIZATION, async (db) => {
    await knownProject(db, site, 'Centrale solaire — Clinique Biasa', electrical);
    await knownProject(db, office, 'Bureau d’études', licence);
  });
  await act(hr, 'projects_require', { projectId: site, kindIds: [electrical, height] });

  // Yao holds both; his electrical clearance ends in three weeks.
  await act(hr, 'authorisations_grant', {
    userId: staff.userId,
    kindId: electrical,
    validFrom: day(-344),
    validUntil: day(21),
    proof: 'Certificat APAVE n° 2291',
  });
  await act(hr, 'authorisations_grant', { userId: staff.userId, kindId: height, validFrom: day(-200) });
  // Essi works at height, and has no electrical clearance: she cannot be sent to the site.
  await act(hr, 'authorisations_grant', { userId: essi.userId, kindId: height, validFrom: day(-90) });
  // The office's work needs a driving licence: everyone has one, and Kossi's is to renew.
  for (const who of [staff, essi]) {
    await act(hr, 'authorisations_grant', { userId: who.userId, kindId: licence, validFrom: day(-2000) });
  }
  await act(hr, 'authorisations_grant', {
    userId: lead.userId,
    kindId: licence,
    validFrom: day(-900),
    validUntil: day(45),
  });

  await act(hr, 'assignments_assign', {
    userId: staff.userId,
    projectId: site,
    startsOn: day(-10),
    endsOn: day(18),
    role: 'Électricien',
  });
  for (const who of [staff, essi, lead]) {
    await act(hr, 'assignments_assign', {
      userId: who.userId,
      projectId: office,
      startsOn: day(-30),
      // Never beyond what a licence covers: Kossi's ends in 45 days.
      endsOn: who === lead ? day(40) : day(60),
    });
  }

  // Yao answered his week; Essi has not.
  await act(staff, 'time_say', {
    weekStart: mondayOf(today()),
    entries: [
      { projectId: site, days: 3 },
      { projectId: office, days: 1.5 },
    ],
  });
  await act(staff, 'time_say', {
    weekStart: mondayOf(day(-7)),
    entries: [
      { projectId: site, days: 4 },
      { projectId: office, days: 1 },
    ],
  });

  // Leave: one approved, one waiting for who keeps the team, one sent back.
  const next = mondayOf(day(28));
  const granted = await act<{ leaveId: string }>(essi, 'leaves_ask', {
    kind: 'annual',
    startsOn: next,
    endsOn: plusDays(next, 4),
    reason: 'Mariage de ma sœur',
  });
  await act(hr, 'leaves_decide', { ...granted, decision: 'approve' });
  await act(staff, 'leaves_ask', {
    kind: 'annual',
    startsOn: mondayOf(day(49)),
    endsOn: plusDays(mondayOf(day(49)), 1),
  });
  const back = await act<{ leaveId: string }>(lead, 'leaves_ask', {
    kind: 'unpaid',
    startsOn: mondayOf(day(70)),
    endsOn: plusDays(mondayOf(day(70)), 9),
  });
  await act(owner, 'leaves_decide', {
    ...back,
    decision: 'return',
    reason: 'Dix jours sans solde en pleine saison : prenez-en cinq, ou des congés annuels.',
  });
}
