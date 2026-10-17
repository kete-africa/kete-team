import { defineCommand } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { announce } from '@/platform/announce';
import { getCenter } from '@/platform/center';
import { actingFor, currentToken } from '@/platform/person';
import { passGesture, sentencesOf } from '@/platform/policies';
import { missingFor, period, TeamRuleError } from '../domain/people';
import {
  endAssignmentOn,
  findAssignment,
  findMember,
  heldBy,
  insertAssignment,
  insertAuthorisation,
  insertKind,
  knownProjects,
  listKinds,
  requirementsOf,
  setRequirements,
  upsertMember,
} from '../infrastructure/people.table';
import {
  assignmentEnd,
  assignmentInput,
  authorisationInput,
  kindInput,
  memberInput,
  requirementsInput,
} from '../people.record';

/** Whether a person is on approved leave in a period: asked of the leave feature by the host. */
type LeaveCheck = (
  db: SqlExecutor,
  userId: string,
  from: string,
  to: string,
) => Promise<{ startsOn: string; endsOn: string } | null>;
let onLeave: LeaveCheck = async () => null;
export function useLeaveCheck(check: LeaveCheck): void {
  onLeave = check;
}

/**
 * A project by its identifier: read at the center with the token of who acts — she must see it —
 * or known here by what was already required or assigned on it.
 */
async function projectOf(db: SqlExecutor, projectId: string): Promise<{ projectId: string; name: string }> {
  const project = await getCenter().project(currentToken(), projectId);
  if (project) return { projectId: project.projectId, name: project.name };
  const known = (await knownProjects(db)).find((one) => one.projectId === projectId);
  if (!known) throw new TeamRuleError('not_of_project');
  return known;
}

/** Adds a person to the roster, by her Compte Kete account. */
export const addMember = defineCommand({
  name: 'add-member',
  input: memberInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    await upsertMember(db, { organizationId, ...input });
    return { userId: input.userId };
  },
  summarize: (input) => `Member ${input.userId} added`,
});

/** Names a kind of authorisation: « Habilitation électrique B1V », « Travail en hauteur ». */
export const nameKind = defineCommand({
  name: 'name-authorisation-kind',
  input: kindInput,
  reversibility: { reversible: false },
  async handler({ name }, { db, organizationId }) {
    return { kindId: await insertKind(db, organizationId, name) };
  },
  summarize: ({ name }) => `Authorisation kind "${name}" named`,
});

/** Records an authorisation a person holds, with its validity and its proof. */
export const grantAuthorisation = defineCommand({
  name: 'grant-authorisation',
  input: authorisationInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    if (!(await findMember(db, input.userId))) throw new TeamRuleError('member_not_found');
    if (!(await listKinds(db)).some((kind) => kind.kindId === input.kindId)) {
      throw new TeamRuleError('kind_not_found');
    }
    if (input.validUntil) period(input.validFrom, input.validUntil);
    const authorisationId = await insertAuthorisation(db, {
      organizationId,
      ...input,
      grantedBy: actingFor(actor),
    });
    return { authorisationId };
  },
  summarize: (input) => `Authorisation recorded for ${input.userId}`,
});

/** How many days a period covers, both ends counted. */
const daysOf = (startsOn: string, endsOn: string) =>
  Math.round((Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000) + 1;

/** Says what a project requires of whoever is assigned to it. */
export const requireForProject = defineCommand({
  name: 'require-for-project',
  input: requirementsInput,
  reversibility: { reversible: false },
  async handler({ projectId, kindIds }, { db, organizationId }) {
    const project = await projectOf(db, projectId);
    const kinds = new Set((await listKinds(db)).map((kind) => kind.kindId));
    if (kindIds.some((kindId) => !kinds.has(kindId))) throw new TeamRuleError('kind_not_found');
    await setRequirements(db, organizationId, project, [...new Set(kindIds)]);
    return { projectId, required: kindIds.length };
  },
  summarize: ({ projectId }) => `Requirements of project ${projectId} set`,
});

/**
 * Assigns a person to a project for a period. Refused when she does not hold, for the whole
 * period, every authorisation the project requires — and when she is on approved leave in it.
 * The refusal names what is missing: nobody is sent to a site she may not work on.
 */
export const assign = defineCommand({
  name: 'assign',
  input: assignmentInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    period(input.startsOn, input.endsOn);
    const member = await findMember(db, input.userId);
    if (!member?.active) throw new TeamRuleError('member_not_found');
    const project = await projectOf(db, input.projectId);
    const [missing] = missingFor(
      await requirementsOf(db, project.projectId),
      await heldBy(db, input.userId),
      input.startsOn,
      input.endsOn,
    );
    if (missing) {
      throw new TeamRuleError(
        missing.why === 'missing' ? 'authorisation_missing' : 'authorisation_expired',
        { kind: missing.name, until: missing.until ?? '', person: member.name },
      );
    }
    const leave = await onLeave(db, input.userId, input.startsOn, input.endsOn);
    if (leave) {
      throw new TeamRuleError('on_leave', {
        person: member.name,
        from: leave.startsOn,
        to: leave.endsOn,
      });
    }
    // The organization's policies, at the center (kete-core spec 114): the same for a person and
    // her agent. Unruled, this app's rules above are enough.
    const verdict = await passGesture(currentToken(), actor, {
      kind: 'assignment.make',
      object: { kind: 'project', id: project.projectId },
      context: { days: daysOf(input.startsOn, input.endsOn) },
    });
    if (verdict.effect === 'refuse') {
      throw new TeamRuleError('refused_by_policy', { why: sentencesOf(verdict) });
    }
    if (verdict.effect === 'approve') {
      const ids = verdict.approvers.flatMap((a) => a.people);
      const names = await Promise.all(ids.map(async (id) => (await findMember(db, id))?.name ?? id));
      throw new TeamRuleError('approval_required', {
        who: names.join(', ') || '—',
        why: sentencesOf(verdict),
      });
    }
    const assignmentId = await insertAssignment(db, {
      organizationId,
      userId: input.userId,
      projectId: project.projectId,
      projectName: project.name,
      role: input.role,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      assignedBy: actingFor(actor),
    });
    await announce(db, {
      type: 'assignment.made',
      organization: organizationId,
      data: {
        assignmentId,
        userId: input.userId,
        projectId: project.projectId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      },
    });
    return { assignmentId };
  },
  summarize: (input) => `${input.userId} assigned to ${input.projectId}`,
});

/** Ends an assignment earlier than planned: never later — a longer one is a new assignment. */
export const endAssignment = defineCommand({
  name: 'end-assignment',
  input: assignmentEnd,
  reversibility: { reversible: false },
  async handler({ assignmentId, endsOn }, { db }) {
    const assignment = await findAssignment(db, assignmentId);
    if (!assignment) throw new TeamRuleError('assignment_not_found');
    if (endsOn < assignment.startsOn || endsOn > assignment.endsOn) {
      throw new TeamRuleError('period_invalid');
    }
    await endAssignmentOn(db, assignmentId, endsOn);
    return { assignmentId, endsOn };
  },
  summarize: ({ assignmentId }) => `Assignment ${assignmentId} ended`,
});
