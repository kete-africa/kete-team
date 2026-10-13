import { defineCapability } from '@kete/capabilities';
import { z } from 'zod';
import { reads } from '@/features/people';
import { askLeave, cancelLeave, correctLeave, decideLeave } from './commands/leave';
import { listLeaves } from './infrastructure/leave.table';
import { leaveCorrection, leaveDecision, leaveInput, leaveRef } from './leave.record';

/**
 * What agents may do with leave: read who is away, prepare a request a person validates. A
 * decision is always a person's.
 */
export const leaveCapabilities = [
  defineCapability({
    name: 'leave_list',
    description:
      'The leaves: who, which days, how many working days, where each stands. Her own, unless she reads everyone’s.',
    permission: 'team:member',
    autonomy: 1,
    input: z.object({}),
    run: (_input, { db, actor }) =>
      listLeaves(db, reads() ? {} : { requesterId: actor.onBehalfOf?.id ?? actor.id }),
  }),
  defineCapability({
    name: 'leaves_ask',
    description: 'Asks for a leave: its kind (annual, sick, unpaid, other), its first and last day.',
    permission: 'team:member',
    autonomy: 3,
    input: leaveInput,
    command: askLeave,
    draft: { recordType: 'leave' },
  }),
  defineCapability({
    name: 'leaves_correct',
    description: 'Corrects a leave that was sent back to who asked: it is then decided again.',
    permission: 'team:member',
    autonomy: 3,
    input: leaveCorrection,
    command: correctLeave,
    draft: { recordType: 'leave_correction' },
  }),
  defineCapability({
    name: 'leaves_cancel',
    description: 'Takes a leave request back, while nobody decided it.',
    permission: 'team:member',
    autonomy: 3,
    input: leaveRef,
    command: cancelLeave,
    draft: { recordType: 'leave_cancelled' },
  }),
  defineCapability({
    name: 'leaves_decide',
    description:
      'Approves, refuses or sends back a leave, when the organization has no circuit for it at the center.',
    permission: 'team:approve',
    autonomy: 3,
    input: leaveDecision,
    command: decideLeave,
    draft: { recordType: 'leave_decision' },
  }),
];
