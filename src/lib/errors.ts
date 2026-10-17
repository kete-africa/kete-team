import * as m from '@/paraglide/messages.js';

type Facts = Record<string, string | number>;
const fact = (facts: Facts, key: string) => String(facts[key] ?? '');

/**
 * A gesture's code in words (`RuleError`, a refusal): what happened, why, what to do — with the
 * facts the rule names: the authorisation that is missing, the day it expires. A code without its
 * own words is said in general terms, never as a code.
 */
export function sayError(code: string, facts: Facts = {}): string {
  const words: Record<string, () => string> = {
    not_allowed: m.errors_not_allowed,
    invalid_input: m.errors_invalid_input,
    not_found: m.errors_not_found,
    member_not_found: m.errors_member_not_found,
    kind_not_found: m.errors_kind_not_found,
    authorisation_missing: () =>
      m.errors_authorisation_missing({ person: fact(facts, 'person'), kind: fact(facts, 'kind') }),
    authorisation_expired: () =>
      m.errors_authorisation_expired({
        person: fact(facts, 'person'),
        kind: fact(facts, 'kind'),
        until: fact(facts, 'until'),
      }),
    on_leave: () =>
      m.errors_on_leave({
        person: fact(facts, 'person'),
        from: fact(facts, 'from'),
        to: fact(facts, 'to'),
      }),
    period_invalid: m.errors_period_invalid,
    not_of_project: m.errors_not_of_project,
    assignment_not_found: m.errors_assignment_not_found,
    refused_by_policy: () => m.errors_refused_by_policy({ why: fact(facts, 'why') }),
    approval_required: () =>
      m.errors_approval_required({ who: fact(facts, 'who'), why: fact(facts, 'why') }),
    leave_not_found: m.errors_leave_not_found,
    leave_not_waiting: m.errors_leave_not_waiting,
    leave_not_returned: m.errors_leave_not_returned,
    decided_at_the_center: m.errors_decided_at_the_center,
    own_request: m.errors_own_request,
    not_the_requester: m.errors_not_the_requester,
    reason_required: m.errors_reason_required,
    no_working_day: m.errors_no_working_day,
    already_on_leave: m.errors_already_on_leave,
    not_a_monday: m.errors_not_a_monday,
    week_too_long: m.errors_week_too_long,
    not_assigned: m.errors_not_assigned,
    week_not_started: m.errors_week_not_started,
  };
  return (words[code] ?? m.errors_generic)();
}
