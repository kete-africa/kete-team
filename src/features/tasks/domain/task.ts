import { RuleError } from '@kete/capabilities';
import type { TaskStatus } from '../task.record';

/** The rules of a task, pure: no database, no framework, tested alone. */
/** A rule of tasks a gesture broke: the screen words its code (`errors_<code>`). */
export class TaskRuleError extends RuleError {
  constructor(override readonly code: 'already_done' | 'not_done' | 'not_found') {
    super(code);
    this.name = 'TaskRuleError';
  }
}

export function completed(status: TaskStatus): TaskStatus {
  if (status === 'done') throw new TaskRuleError('already_done');
  return 'done';
}

export function reopened(status: TaskStatus): TaskStatus {
  if (status === 'open') throw new TaskRuleError('not_done');
  return 'open';
}
