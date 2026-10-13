import { recordDailyUsage, organizationsWithUsage, dayPeriod, trackUsage } from '@kete/analytics';
import { createEmitter } from '@kete/sdk';
import { getPool, transaction } from './db';
import { log } from './log';
import { manifest } from './events';

// Who uses what in this app (@kete/analytics): each gesture counted for its organization, and
// once a day the counts — never a person — announced to Kete Cockpit.

/** A capability's name as a usage: `tasks_create` → `tasks.create`. */
const usageName = (capability: string) => capability.replace('_', '.');

/** Counts a gesture; usage never fails the gesture it measures. */
export async function recordUse(organizationId: string, capability: string, userId: string) {
  await transaction(organizationId, (db) =>
    trackUsage(db, organizationId, {
      name: usageName(capability),
      actor: { kind: 'person', id: userId },
    }),
  ).catch((error: unknown) => log.warn('usage not recorded', { capability, error }));
}

/** The worker, once a day: yesterday's counts of each organization, in the outbox to Cockpit. */
export async function announceDailyUsage(day = new Date(Date.now() - 86_400_000)) {
  const date = day.toISOString().slice(0, 10);
  const emitter = createEmitter(manifest());
  for (const organizationId of await organizationsWithUsage(getPool(), dayPeriod(date))) {
    await transaction(organizationId, (db) => recordDailyUsage(db, emitter, organizationId, date));
  }
}
