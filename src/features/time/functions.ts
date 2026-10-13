import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  leaveCorrection,
  leaveDecision,
  leaveInput,
  leaveRef,
  listLeaves,
  readDecision,
} from '@/features/leave';
import { authorisationsOf, expiringWithin } from '@/features/people';
import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { centerAppToken } from '@/platform/events';
import { answer, may } from '@/platform/may';
import { holds } from '@/platform/rights';
import { perform, ScreenError, signedIn } from '@/platform/screen';
import { monthElements, weekInput, weekOf } from './time';

// Her own page — her week, her leaves, her authorisations — and the month's elements. Leave's
// gestures live here too: they are asked from that page.

const today = () => new Date().toISOString().slice(0, 10);

export const fetchMine = createServerFn({ method: 'GET' }).handler(async () => {
  const { caller, identity, as } = await signedIn();
  return as(async () => {
    if (!holds('team:member')) throw new ScreenError('forbidden');
    const rights = may();
    // A leave of hers that waits at the center may have been decided since.
    const waiting = await transaction(caller.organizationId, (db) =>
      listLeaves(db, { requesterId: identity.userId, statuses: ['asked'], route: 'center' }),
    );
    if (waiting.length > 0) {
      const appToken = await centerAppToken();
      for (const leave of waiting) {
        await readDecision(appToken, caller.organizationId, leave.leaveId).catch(() => false);
      }
    }
    return transaction(caller.organizationId, async (db) => ({
      me: { userId: identity.userId, name: identity.name },
      may: rights,
      connected: getCenter().connected,
      week: await weekOf(db, identity.userId, today()),
      leaves: await listLeaves(db, { requesterId: identity.userId, limit: 30 }),
      authorisations: await authorisationsOf(db, identity.userId),
      expiring: await expiringWithin(db, 60, rights.read ? undefined : identity.userId),
      toDecide: rights.approve
        ? (await listLeaves(db, { statuses: ['asked'], route: 'here' })).filter(
            (leave) => leave.requester.userId !== identity.userId,
          )
        : [],
      away: rights.read
        ? (await listLeaves(db, { statuses: ['approved'], limit: 100 })).filter(
            (leave) => leave.endsOn >= today(),
          )
        : [],
    }));
  });
});

export const fetchMonth = createServerFn({ method: 'GET' })
  .validator((input: unknown) =>
    z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { caller, as } = await signedIn();
    return as(async () => {
      if (!holds('team:read')) throw new ScreenError('forbidden');
      return transaction(caller.organizationId, (db) => monthElements(db, data.month));
    });
  });

export const sayWeek = createServerFn({ method: 'POST' })
  .validator((input: unknown) => weekInput.parse(input))
  .handler(async ({ data }) => answer(await perform<{ total: number }>('time_say', data)));

export const askLeave = createServerFn({ method: 'POST' })
  .validator((input: unknown) => leaveInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ leaveId: string; days: number }>('leaves_ask', data)),
  );

export const correctLeave = createServerFn({ method: 'POST' })
  .validator((input: unknown) => leaveCorrection.parse(input))
  .handler(async ({ data }) => answer(await perform<{ leaveId: string }>('leaves_correct', data)));

export const cancelLeave = createServerFn({ method: 'POST' })
  .validator((input: unknown) => leaveRef.parse(input))
  .handler(async ({ data }) => answer(await perform<{ leaveId: string }>('leaves_cancel', data)));

export const decideLeave = createServerFn({ method: 'POST' })
  .validator((input: unknown) => leaveDecision.parse(input))
  .handler(async ({ data }) => answer(await perform<{ leaveId: string }>('leaves_decide', data)));
