import { definePermissions } from '@kete/capabilities';
import * as m from '@/paraglide/messages.js';
import { words } from '@/platform/words';

/** Deciding a leave here, when the organization has no circuit for it — never one's own. */
export const leavePermissions = definePermissions([
  {
    name: 'team:approve',
    label: words(m.perm_team_approve),
    description: words(m.perm_team_approve_body),
    roles: ['owner', 'admin'],
    businessRoles: ['hr'],
  },
]);

/** What the app asks the center's circuits to decide (manifest `subjects`). */
export const leaveSubjects = [{ name: 'leave', label: words(m.subject_leave) }];
