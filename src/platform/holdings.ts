import { organizationsWithUsage } from '@kete/analytics';
import type { AppHolding, AppObject } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import { leaveHoldings, leaveObjects } from '@/features/leave';
import { authorisationHoldings, authorisationObjects } from '@/features/people';
import { getCenter } from './center';
import { getPool, transaction } from './db';
import { centerAppToken } from './events';
import { log } from './log';

// What this app holds, said to its center (kete-core spec 114; doctrine D-056): every thing in
// progress, with who holds it — a person of the center, never nobody. The center keeps them as
// holdings, in « Pour moi », relayed when their holder is away, and finishes those the app no
// longer says. Said all at once: after a gesture, and every minute by the worker.

/** Each feature's things in progress, read in the organization's transaction. */
const SOURCES: ((db: SqlExecutor) => Promise<AppHolding[]>)[] = [leaveHoldings, authorisationHoldings];

/**
 * Its leaves and authorisations, for the center's index (spec 006; kete-core spec 142): found and
 * cited there — « # », the search, Kete, the agents — with each person's rights.
 */
const OBJECTS: ((db: SqlExecutor) => Promise<AppObject[]>)[] = [leaveObjects, authorisationObjects];

/** Says what the app holds for one organization; never fails the gesture it follows. */
export async function sayHoldings(organizationId: string): Promise<void> {
  const center = getCenter();
  if (!center.connected) return;
  try {
    const token = await centerAppToken();
    if (!token) return;
    const holdings = await transaction(organizationId, async (db) =>
      (await Promise.all(SOURCES.map((source) => source(db)))).flat(),
    );
    const said = await center.sayHoldings(token, organizationId, holdings);
    if (!said.ok)
      log.warn('holdings not said to the center', { organizationId, error: said.error });
    const objects = await transaction(organizationId, async (db) =>
      (await Promise.all(OBJECTS.map((source) => source(db)))).flat(),
    );
    const indexed = await center.sayObjects(token, organizationId, objects);
    if (!indexed.ok)
      log.warn('objects not said to the center', { organizationId, error: indexed.error });
  } catch (error) {
    log.warn('holdings not said to the center', { organizationId, error });
  }
}

/** The worker, every minute: each organization that used the app these ninety days. */
export async function sayAllHoldings(now = new Date()): Promise<void> {
  if (!getCenter().connected) return;
  const period = { from: new Date(now.getTime() - 90 * 86_400_000), to: now };
  for (const organizationId of await organizationsWithUsage(getPool(), period)) {
    await sayHoldings(organizationId);
  }
}
