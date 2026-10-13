import type { KeteIdentity } from '@kete/auth';
import {
  businessRoleDecisions,
  businessRoleOf,
  createRights,
  definePermissions,
} from '@kete/capabilities';
import { AsyncLocalStorage } from 'node:async_hooks';
import { taskPermissions } from '@/features/tasks';
import * as m from '@/paraglide/messages.js';
import { getCenter } from './center';
import { transaction } from './db';
import { words } from './words';

/**
 * Every permission the app checks, with its words and its default roles (kete-core spec 049): each
 * feature declares its own. The manifest describes them; Kete Enterprise lets an administrator
 * grant them to roles and positions.
 */
export const permissions = definePermissions([
  ...taskPermissions,
  // The organization's journal: who did what, agents included (@kete/admin).
  {
    name: 'journal:read',
    label: words(m.perm_journal_read),
    description: words(m.perm_journal_read_body),
    roles: ['owner', 'admin'],
  },
]);

/**
 * The roles of the app's own trade (kete-core spec 093): a member holds what her business role
 * holds, as the owner ticked it — nothing without one. Replace `staff` by the roles of the trade
 * (a cashier, a washer) and name them in each permission's `businessRoles`.
 */
export const businessRoles = ['owner', 'staff'] as const;

const rights = createRights({
  permissions,
  grants: (token) => getCenter().grants(token),
  businessRoleOf: (person) =>
    person.organizationId
      ? transaction(person.organizationId, async (db) => ({
          role: await businessRoleOf(db, person.userId),
          decided: await businessRoleDecisions(db),
        }))
      : Promise.resolve({ role: null, decided: new Map() }),
});

const current = new AsyncLocalStorage<{
  identity: KeteIdentity | null;
  permissions: Set<string>;
}>();

/**
 * Runs `work` for this person: every right checked within it is hers — her grants at the center,
 * read with her token, or the defaults of her role.
 */
export async function asPerson<T>(
  identity: KeteIdentity | null,
  work: () => T | Promise<T>,
  token?: string | null,
): Promise<T> {
  const held = identity ? await rights.permissionsOf(identity, token) : new Set<string>();
  return current.run({ identity, permissions: held }, work);
}

export function currentIdentity(): KeteIdentity | null {
  return current.getStore()?.identity ?? null;
}

/**
 * Whether the person of this request holds `permission` in her organization. An agent acting for
 * her runs within her request: it never has more rights than she has (doctrine).
 */
export function holds(permission: string): boolean {
  return current.getStore()?.permissions.has(permission) ?? false;
}
