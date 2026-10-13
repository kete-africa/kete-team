import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { answer, may } from '@/platform/may';
import { holds } from '@/platform/rights';
import { perform, ScreenError, signedIn } from '@/platform/screen';
import {
  authorisationsOf,
  expiringWithin,
  findMember,
  knownProjects,
  listAssignments,
  listKinds,
  listMembers,
  requirementsOf,
} from './infrastructure/people.table';
import {
  assignmentEnd,
  assignmentInput,
  authorisationInput,
  kindInput,
  memberInput,
  requirementsInput,
} from './people.record';

// The screens of the roster. A gesture's refusal comes back as its code and the facts it names —
// the authorisation that is missing, the day it expires — for the screen to word.

async function reading<T>(
  permission: 'team:member' | 'team:read',
  work: (context: { organizationId: string; userId: string; token: string | null }) => Promise<T>,
): Promise<T> {
  const { caller, identity, as, token } = await signedIn();
  return as(async () => {
    if (!holds(permission)) throw new ScreenError('forbidden');
    return work({ organizationId: caller.organizationId, userId: identity.userId, token });
  });
}

const today = () => new Date().toISOString().slice(0, 10);

export const fetchRoster = createServerFn({ method: 'GET' }).handler(() =>
  reading('team:read', ({ organizationId }) =>
    transaction(organizationId, async (db) => ({
      may: may(),
      members: await listMembers(db),
      kinds: await listKinds(db),
      expiring: await expiringWithin(db, 60),
    })),
  ),
);

export const fetchPersonCard = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ userId: z.string().min(1).max(64) }).parse(input))
  .handler(({ data }) =>
    reading('team:member', ({ organizationId, userId }) =>
      transaction(organizationId, async (db) => {
        const rights = may();
        // Her own card, or anyone's for who reads everyone's.
        if (data.userId !== userId && !rights.read) throw new ScreenError('forbidden');
        return {
          may: rights,
          member: await findMember(db, data.userId),
          kinds: await listKinds(db),
          authorisations: await authorisationsOf(db, data.userId),
          assignments: await listAssignments(db, { userId: data.userId }),
        };
      }),
    ),
  );

export const fetchAssignments = createServerFn({ method: 'GET' }).handler(() =>
  reading('team:read', async ({ organizationId, token }) => {
    const fromCenter = (await getCenter().projects(token))
      .filter((project) => project.status === 'open')
      .map((project) => ({ projectId: project.projectId, name: project.name }));
    return transaction(organizationId, async (db) => {
      const projects = [
        ...fromCenter,
        ...(await knownProjects(db)).filter(
          (known) => !fromCenter.some((one) => one.projectId === known.projectId),
        ),
      ];
      const requirements = [];
      for (const project of projects) {
        requirements.push({ ...project, kinds: await requirementsOf(db, project.projectId) });
      }
      return {
        may: may(),
        connected: getCenter().connected,
        members: (await listMembers(db)).filter((member) => member.active),
        kinds: await listKinds(db),
        projects: requirements,
        assignments: await listAssignments(db, { from: today() }),
      };
    });
  }),
);

export const addMember = createServerFn({ method: 'POST' })
  .validator((input: unknown) => memberInput.parse(input))
  .handler(async ({ data }) => answer(await perform<{ userId: string }>('members_add', data)));

export const nameKind = createServerFn({ method: 'POST' })
  .validator((input: unknown) => kindInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ kindId: string }>('authorisations_name_kind', data)),
  );

export const grantAuthorisation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => authorisationInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ authorisationId: string }>('authorisations_grant', data)),
  );

export const requireForProject = createServerFn({ method: 'POST' })
  .validator((input: unknown) => requirementsInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ projectId: string }>('projects_require', data)),
  );

export const assignPerson = createServerFn({ method: 'POST' })
  .validator((input: unknown) => assignmentInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ assignmentId: string }>('assignments_assign', data)),
  );

export const endAssignment = createServerFn({ method: 'POST' })
  .validator((input: unknown) => assignmentEnd.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ assignmentId: string }>('assignments_end', data)),
  );
