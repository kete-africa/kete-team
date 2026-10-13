import { holds } from './rights';

/** What a gesture answers a screen: its output, or its code and the facts it names. */
export const answer = <T>(
  outcome:
    | { ok: true; output: T }
    | { ok: false; code: string; facts?: Record<string, string | number> },
) =>
  outcome.ok
    ? { ok: true as const, output: outcome.output }
    : { ok: false as const, code: outcome.code, facts: outcome.facts ?? {} };

/** What she may do here: a screen shows a gesture only to who may make it. */
export const may = () => ({
  member: holds('team:member'),
  read: holds('team:read'),
  manage: holds('team:manage'),
  approve: holds('team:approve'),
});
