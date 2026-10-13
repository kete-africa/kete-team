import { defineCapability } from '@kete/capabilities';
import { z } from 'zod';
import {
  addMember,
  assign,
  endAssignment,
  grantAuthorisation,
  nameKind,
  requireForProject,
} from './commands/people';
import {
  authorisationsOf,
  expiringWithin,
  listAssignments,
  listMembers,
} from './infrastructure/people.table';
import {
  assignmentEnd,
  assignmentInput,
  authorisationInput,
  kindInput,
  memberInput,
  requirementsInput,
} from './people.record';

/** Whether the caller reads everyone's, or only her own: set by the host for each call. */
let readsEveryone: () => boolean = () => false;
export function useReadsEveryone(check: () => boolean): void {
  readsEveryone = check;
}
export const reads = () => readsEveryone();

/**
 * What agents may do with the roster — and how far alone. An agent reads who is assigned where
 * and what expires; it prepares an assignment a person validates, and the rule that refuses an
 * assignment applies to it like to anyone.
 */
export const peopleCapabilities = [
  defineCapability({
    name: 'member_list',
    description: 'The people of the team.',
    permission: 'team:read',
    autonomy: 1,
    input: z.object({}),
    run: (_input, { db }) => listMembers(db),
  }),
  defineCapability({
    name: 'authorisations_of',
    description: 'The authorisations a person holds, with their validity. Her own, unless she reads everyone’s.',
    permission: 'team:member',
    autonomy: 1,
    input: z.object({ userId: z.string().max(64).optional() }),
    run: ({ userId }, { db, actor }) => {
      const mine = actor.onBehalfOf?.id ?? actor.id;
      return authorisationsOf(db, readsEveryone() ? (userId ?? mine) : mine);
    },
  }),
  defineCapability({
    name: 'authorisations_expiring',
    description:
      'The authorisations that expire within a number of days (60 by default): who, which one, when. Her own, unless she reads everyone’s.',
    permission: 'team:member',
    autonomy: 1,
    input: z.object({ withinDays: z.number().int().min(1).max(730).default(60) }),
    run: ({ withinDays }, { db, actor }) =>
      expiringWithin(db, withinDays, readsEveryone() ? undefined : (actor.onBehalfOf?.id ?? actor.id)),
  }),
  defineCapability({
    name: 'assignment_list',
    description:
      'Who is assigned to which project and when: of a project, of a person, or in a period. Her own, unless she reads everyone’s.',
    permission: 'team:member',
    autonomy: 1,
    input: z.object({
      projectId: z.string().max(64).optional(),
      userId: z.string().max(64).optional(),
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
    }),
    run: (input, { db, actor }) =>
      listAssignments(db, {
        ...input,
        userId: readsEveryone() ? input.userId : (actor.onBehalfOf?.id ?? actor.id),
      }),
  }),
  defineCapability({
    name: 'members_add',
    description: 'Adds a person to the roster, by her Compte Kete account.',
    permission: 'team:manage',
    autonomy: 3,
    input: memberInput,
    command: addMember,
    draft: { recordType: 'member' },
  }),
  defineCapability({
    name: 'authorisations_name_kind',
    description: 'Names a kind of authorisation the organization tracks.',
    permission: 'team:manage',
    autonomy: 3,
    input: kindInput,
    command: nameKind,
    draft: { recordType: 'authorisation_kind' },
  }),
  defineCapability({
    name: 'authorisations_grant',
    description: 'Records an authorisation a person holds: its kind, its validity, its proof.',
    permission: 'team:manage',
    autonomy: 3,
    input: authorisationInput,
    command: grantAuthorisation,
    draft: { recordType: 'authorisation' },
  }),
  defineCapability({
    name: 'projects_require',
    description: 'Says which authorisations a project requires of whoever is assigned to it.',
    permission: 'team:manage',
    autonomy: 3,
    input: requirementsInput,
    command: requireForProject,
    draft: { recordType: 'project_requirements' },
  }),
  defineCapability({
    name: 'assignments_assign',
    description:
      'Assigns a person to a project for a period. Refused when she lacks, for the whole period, an authorisation the project requires, or is on approved leave.',
    permission: 'team:manage',
    autonomy: 3,
    input: assignmentInput,
    command: assign,
    draft: { recordType: 'assignment' },
  }),
  defineCapability({
    name: 'assignments_end',
    description: 'Ends an assignment earlier than planned.',
    permission: 'team:manage',
    autonomy: 3,
    input: assignmentEnd,
    command: endAssignment,
    draft: { recordType: 'assignment_end' },
  }),
];
