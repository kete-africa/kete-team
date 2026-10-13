import { definePermissions } from '@kete/capabilities';
import * as m from '@/paraglide/messages.js';
import { words } from '@/platform/words';

/**
 * Who may do what in Équipe. Everyone of the team reads her own things, asks her leave and says
 * her week; reading everyone's and keeping the roster are each a permission; a leave is never
 * decided by who asked it.
 */
export const peoplePermissions = definePermissions([
  {
    name: 'team:member',
    label: words(m.perm_team_member),
    description: words(m.perm_team_member_body),
    roles: ['owner', 'admin'],
    businessRoles: ['hr', 'lead', 'staff'],
  },
  {
    name: 'team:read',
    label: words(m.perm_team_read),
    description: words(m.perm_team_read_body),
    roles: ['owner', 'admin'],
    businessRoles: ['hr', 'lead'],
  },
  {
    name: 'team:manage',
    label: words(m.perm_team_manage),
    description: words(m.perm_team_manage_body),
    roles: ['owner', 'admin'],
    businessRoles: ['hr'],
  },
]);
