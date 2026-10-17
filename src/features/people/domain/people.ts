import { RuleError } from '@kete/capabilities';

export { covering, missingFor, overlaps, type Held, type Missing } from './validity';

// The rules of the roster, pure: no database, no framework, tested alone.

/**
 * A rule of the roster a gesture broke: the screen words its code (`errors_<code>`), with the
 * facts it names — the authorisation that is missing, the day it expires.
 */
export class TeamRuleError extends RuleError {
  constructor(
    override readonly code:
      | 'member_not_found'
      | 'kind_not_found'
      | 'authorisation_missing'
      | 'authorisation_expired'
      | 'on_leave'
      | 'period_invalid'
      | 'not_of_project'
      | 'assignment_not_found'
      | 'refused_by_policy'
      | 'approval_required',
    facts: Record<string, string | number> = {},
  ) {
    super(code, facts);
    this.name = 'TeamRuleError';
  }
}

/** A period runs from a day to a later or the same day. */
export function period(startsOn: string, endsOn: string): void {
  if (endsOn < startsOn) throw new TeamRuleError('period_invalid');
}
