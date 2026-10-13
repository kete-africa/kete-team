import { RuleError } from '@kete/capabilities';

export { leaveKinds, workingDays, type LeaveKind } from './days';

// The rules of leave, pure: no database, no framework, tested alone.

/** A rule of leave a gesture broke: the screen words its code (`errors_<code>`). */
export class LeaveRuleError extends RuleError {
  constructor(
    override readonly code:
      | 'leave_not_found'
      | 'leave_not_waiting'
      | 'leave_not_returned'
      | 'decided_at_the_center'
      | 'own_request'
      | 'not_the_requester'
      | 'reason_required'
      | 'period_invalid'
      | 'no_working_day'
      | 'already_on_leave',
  ) {
    super(code);
    this.name = 'LeaveRuleError';
  }
}

export type LeaveStatus = 'asked' | 'returned' | 'approved' | 'refused' | 'cancelled';
/** Who decides: not known yet, the center's circuits, or this app's own rule. */
export type Route = 'waiting' | 'center' | 'here';
