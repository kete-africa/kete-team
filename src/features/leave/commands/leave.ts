import { defineCommand, type Actor } from '@kete/commands';
import { formatNumber, nextNumber } from '@kete/sequences';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { noteMember } from '@/features/people';
import { announce } from '@/platform/announce';
import { actingFor, currentName } from '@/platform/person';
import { workingDays } from '../domain/days';
import { LeaveRuleError } from '../domain/leave';
import {
  findLeave,
  insertLeave,
  leaveIn,
  rewriteLeave,
  setDecided,
  setRoute,
} from '../infrastructure/leave.table';
import {
  leaveCorrection,
  leaveDecision,
  leaveInput,
  leaveRef,
  leaveSettled,
  type Leave,
} from '../leave.record';

/** How leaves are numbered: the series starts again every year. */
const NUMBER = { series: 'leave', pattern: 'CG-{YYYY}-{N:4}' } as const;

/** A leave's working days — at least one — and that she has no other leave on those days. */
async function counted(
  db: SqlExecutor,
  userId: string,
  input: { startsOn: string; endsOn: string },
  except?: string,
): Promise<number> {
  if (input.endsOn < input.startsOn) throw new LeaveRuleError('period_invalid');
  const days = workingDays(input.startsOn, input.endsOn);
  if (days === 0) throw new LeaveRuleError('no_working_day');
  if (await leaveIn(db, userId, input.startsOn, input.endsOn, except ? { except } : {})) {
    throw new LeaveRuleError('already_on_leave');
  }
  return days;
}

/** Asks for a leave: its kind, its days, a word. Its working days are counted here. */
export const askLeave = defineCommand({
  name: 'ask-leave',
  input: leaveInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const userId = actingFor(actor);
    const name = currentName(userId);
    // Whoever asks is of the team: she is on the roster from her first request.
    await noteMember(db, { organizationId, userId, name });
    const days = await counted(db, userId, input);
    const now = new Date();
    const number = formatNumber(
      NUMBER.pattern,
      await nextNumber(db, organizationId, {
        series: NUMBER.series,
        period: String(now.getUTCFullYear()),
      }),
      now,
    );
    const leaveId = await insertLeave(db, {
      organizationId,
      number,
      requester: { userId, name },
      ...input,
      days,
    });
    await announce(db, {
      type: 'leave.asked',
      organization: organizationId,
      data: { leaveId, userId, startsOn: input.startsOn, endsOn: input.endsOn, days },
    });
    return { leaveId, number, days };
  },
  summarize: (input) => `Leave asked from ${input.startsOn} to ${input.endsOn}`,
});

/** Who asked corrects what was sent back to her: it waits again, and is decided again. */
export const correctLeave = defineCommand({
  name: 'correct-leave',
  input: leaveCorrection,
  reversibility: { reversible: false },
  async handler({ leaveId, ...input }, { db, actor }) {
    const leave = await findLeave(db, leaveId);
    if (!leave) throw new LeaveRuleError('leave_not_found');
    if (leave.requester.userId !== actingFor(actor)) throw new LeaveRuleError('not_the_requester');
    if (leave.status !== 'returned') throw new LeaveRuleError('leave_not_returned');
    const days = await counted(db, leave.requester.userId, input, leaveId);
    await rewriteLeave(db, leaveId, { ...input, days });
    return { leaveId, days };
  },
  summarize: ({ leaveId }) => `Leave ${leaveId} corrected`,
});

/** She takes her request back, while nobody decided it. */
export const cancelLeave = defineCommand({
  name: 'cancel-leave',
  input: leaveRef,
  reversibility: { reversible: false },
  async handler({ leaveId }, { db, actor }) {
    const leave = await findLeave(db, leaveId);
    if (!leave) throw new LeaveRuleError('leave_not_found');
    const by = actingFor(actor);
    if (leave.requester.userId !== by) throw new LeaveRuleError('not_the_requester');
    if (leave.status !== 'asked' && leave.status !== 'returned') {
      throw new LeaveRuleError('leave_not_waiting');
    }
    await setDecided(db, leaveId, 'cancelled', { by: currentName(by) });
    return { leaveId, status: 'cancelled' as const };
  },
  summarize: ({ leaveId }) => `Leave ${leaveId} cancelled`,
});

/** A decision, applied: sent back with its reason, refused, or approved. */
async function settle(
  db: SqlExecutor,
  organizationId: string,
  leave: Leave,
  decision: 'approve' | 'refuse' | 'return',
  decided: { by: string; reason?: string | undefined },
) {
  if (leave.status !== 'asked') throw new LeaveRuleError('leave_not_waiting');
  if (decision === 'return' && !decided.reason) throw new LeaveRuleError('reason_required');
  const status = { approve: 'approved', refuse: 'refused', return: 'returned' }[decision] as
    | 'approved'
    | 'refused'
    | 'returned';
  await setDecided(db, leave.leaveId, status, decided);
  if (status === 'approved') {
    await announce(db, {
      type: 'leave.approved',
      organization: organizationId,
      data: {
        leaveId: leave.leaveId,
        userId: leave.requester.userId,
        startsOn: leave.startsOn,
        endsOn: leave.endsOn,
        days: leave.days,
      },
    });
  }
  return { leaveId: leave.leaveId, status };
}

/**
 * Decides a leave here, when the organization has no circuit for it at the center: by who may
 * approve leave — never by who asked.
 */
export const decideLeave = defineCommand({
  name: 'decide-leave',
  input: leaveDecision,
  reversibility: { reversible: false },
  async handler({ leaveId, decision, reason }, { db, organizationId, actor }) {
    const leave = await findLeave(db, leaveId);
    if (!leave) throw new LeaveRuleError('leave_not_found');
    if (leave.route !== 'here') throw new LeaveRuleError('decided_at_the_center');
    const by = actingFor(actor);
    if (leave.requester.userId === by) throw new LeaveRuleError('own_request');
    return settle(db, organizationId, leave, decision, { by: currentName(by), reason });
  },
  summarize: ({ leaveId, decision }) => `Leave ${leaveId}: ${decision}`,
});

/** Applies what the center's circuits decided. Run by the app when the center says so. */
export const settleLeave = defineCommand({
  name: 'settle-leave',
  input: leaveSettled,
  reversibility: { reversible: false },
  async handler({ leaveId, decision, reason, by }, { db, organizationId }) {
    const leave = await findLeave(db, leaveId);
    if (!leave) throw new LeaveRuleError('leave_not_found');
    return settle(db, organizationId, leave, decision, { by, reason });
  },
  summarize: ({ leaveId, decision }) => `Leave ${leaveId}: ${decision} at the center`,
});

/** Says who decides a leave: the center's circuits, or this app. Run by the app. */
export const routeLeave = defineCommand({
  name: 'route-leave',
  input: leaveRef.extend({
    route: z.enum(['center', 'here']),
    decisionRequestId: z.string().max(64).optional(),
  }),
  reversibility: { reversible: false },
  async handler({ leaveId, route, decisionRequestId }, { db }) {
    await setRoute(db, leaveId, route, decisionRequestId ?? null);
    return { leaveId, route };
  },
  summarize: ({ leaveId, route }) => `Leave ${leaveId} decided ${route}`,
});

/** The app itself, applying what the center decided. */
export const APP: Actor = { kind: 'app', id: 'app_center', channel: 'api' };
