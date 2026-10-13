import { createCapabilityRegistry, createDatasetRegistry } from '@kete/capabilities';
import { leaveCapabilities, leaveIn } from '@/features/leave';
import { peopleCapabilities, useLeaveCheck, useReadsEveryone } from '@/features/people';
import { timeCapabilities, timeDatasets } from '@/features/time';
import { transaction } from './db';
import { holds } from './rights';

/**
 * Every gesture of the app, the same for its screens, its MCP endpoint and its agents: same
 * rights, same journal, same autonomy rules (@kete/capabilities).
 */
export const registry = createCapabilityRegistry(
  [...peopleCapabilities, ...leaveCapabilities, ...timeCapabilities],
  {
    authorize: async (_caller, permission) => holds(permission),
    transaction,
  },
);

// Who reads everyone's, and who only her own: the features ask, the rights answer.
useReadsEveryone(() => holds('team:read'));
// An assignment asks whether the person is on approved leave: the leave feature answers.
useLeaveCheck((db, userId, from, to) => leaveIn(db, userId, from, to, { approvedOnly: true }));

/**
 * What the app exposes to dashboards, the assistant and other apps (kete-core spec 045): data sets
 * read with the same rights and organization as its capabilities.
 */
export const datasets = createDatasetRegistry([...timeDatasets], {
  authorize: async (_caller, permission) => holds(permission),
  transaction,
});
