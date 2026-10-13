import * as m from '@/paraglide/messages.js';

/**
 * A gesture's code in words (`RuleError`, a refusal): what happened, why, what to do. A code
 * without its own words is said in general terms, never as a code.
 */
export function sayError(code: string): string {
  const words: Record<string, () => string> = {
    not_allowed: m.errors_not_allowed,
    invalid_input: m.errors_invalid_input,
    not_found: m.errors_not_found,
    already_done: m.errors_already_done,
    not_done: m.errors_not_done,
  };
  return (words[code] ?? m.errors_generic)();
}
