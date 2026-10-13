import { executeCommand, type Actor } from '@kete/commands';
import * as m from '@/paraglide/messages.js';
import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { log } from '@/platform/log';
import { APP, routeLeave, settleLeave } from './commands/leave';
import { findLeave, leaveOfDecision, listLeaves } from './infrastructure/leave.table';

type Caller = { organizationId: string; actor: Actor };

/** Where the center tells the app a request was decided: an https address only. */
function callbackUrl(): string | undefined {
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  return base.startsWith('https://') ? `${base}/api/centre/decisions` : undefined;
}

/**
 * After she asked: who decides her leaves. The center's circuit for `leave` when the organization
 * has one — it finds her manager, interim included; without one, or without a center, this app's
 * own rule: who may approve leave, never who asked. A center that does not answer leaves the
 * request waiting for her next gesture.
 */
export async function routeWaiting(
  token: string | null | undefined,
  caller: Caller,
): Promise<number> {
  const center = getCenter();
  const requesterId = caller.actor.onBehalfOf?.id ?? caller.actor.id;
  const leaves = await transaction(caller.organizationId, (db) =>
    listLeaves(db, { requesterId, statuses: ['asked'], route: 'waiting', limit: 20 }),
  );
  let routed = 0;
  for (const leave of leaves) {
    const decided = async (route: 'center' | 'here', decisionRequestId?: string) => {
      await transaction(caller.organizationId, (db) =>
        executeCommand(db, routeLeave, {
          ...caller,
          idempotencyKey: `route-${crypto.randomUUID()}`,
          input: { leaveId: leave.leaveId, route, ...(decisionRequestId ? { decisionRequestId } : {}) },
        }),
      );
      routed += 1;
    };
    if (!center.connected) {
      await decided('here');
      continue;
    }
    const answer = await center.requestDecision(token, {
      subject: 'leave',
      reference: leave.leaveId,
      title: m.center_leave({
        number: leave.number,
        name: leave.requester.name,
        days: String(leave.days),
        from: leave.startsOn,
        to: leave.endsOn,
      }),
      measure: leave.days,
      ...(callbackUrl() ? { callbackUrl: callbackUrl() as string } : {}),
    });
    if (answer.ok) {
      await decided('center', answer.requestId);
      if (answer.status === 'approved' || answer.status === 'refused') {
        await applyDecision(caller.organizationId, leave.leaveId, {
          status: answer.status,
          decidedBy: null,
          reason: null,
        });
      }
    } else if (answer.error === 'no_circuit' || answer.error === 'unknown_subject') {
      await decided('here');
    } else {
      log.warn('decision not asked at the center', { leave: leave.number, error: answer.error });
      break;
    }
  }
  return routed;
}

/** Applies a decision of the center to its leave here; applied twice, it changes nothing. */
export async function applyDecision(
  organizationId: string,
  leaveId: string,
  decision: { status: string; decidedBy: string | null; reason: string | null },
): Promise<boolean> {
  const to = { approved: 'approve', refused: 'refuse', returned: 'return' }[decision.status] as
    | 'approve'
    | 'refuse'
    | 'return'
    | undefined;
  if (!to) return false;
  return transaction(organizationId, async (db) => {
    const leave = await findLeave(db, leaveId);
    if (!leave || leave.status !== 'asked' || leave.route !== 'center') return false;
    await executeCommand(db, settleLeave, {
      organizationId,
      actor: APP,
      idempotencyKey: `settle-${crypto.randomUUID()}`,
      input: {
        leaveId,
        decision: to,
        by: decision.decidedBy ?? m.decided_by_circuit(),
        ...(decision.reason ? { reason: decision.reason } : to === 'return' ? { reason: '—' } : {}),
      },
    });
    return true;
  });
}

/** Reads at the center where a leave stands, with the app's own token, and applies it. */
export async function readDecision(
  appToken: string | null,
  organizationId: string,
  leaveId: string,
): Promise<boolean> {
  const leave = await transaction(organizationId, (db) => findLeave(db, leaveId));
  if (!leave?.decisionRequestId || leave.status !== 'asked') return false;
  const decision = await getCenter().decision(appToken, organizationId, leave.decisionRequestId);
  if (!decision || decision.status === 'pending') return false;
  return applyDecision(organizationId, leaveId, decision);
}

/** The center says one of its requests was decided: the app reads it, and applies it. */
export async function decisionOf(
  appToken: string | null,
  organizationId: string,
  decisionRequestId: string,
): Promise<boolean> {
  const leaveId = await transaction(organizationId, (db) => leaveOfDecision(db, decisionRequestId));
  return leaveId ? readDecision(appToken, organizationId, leaveId) : false;
}
