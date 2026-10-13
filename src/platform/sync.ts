import type { Actor } from '@kete/commands';
import { routeWaiting } from '@/features/leave';
import { log } from './log';

/**
 * After a gesture, what waits for the center: who decides the leaves she asked — its circuits, or
 * this app. With the token of who just acted; a center that does not answer leaves them waiting
 * for her next gesture. Never fails the gesture it follows.
 */
export async function syncCenter(
  token: string | null | undefined,
  caller: { organizationId: string; actor: Actor },
): Promise<{ routed: number }> {
  try {
    return { routed: await routeWaiting(token, caller) };
  } catch (error) {
    log.warn('the center was not asked', { error });
    return { routed: 0 };
  }
}
