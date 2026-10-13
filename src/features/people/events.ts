import { z } from 'zod';

/**
 * The business events of the roster: identifiers and days only, never a name; the manifest lists
 * them (`emits`).
 */
export const peopleEvents = [
  {
    type: 'assignment.made',
    description: 'A person was assigned to a project for a period: who, which project, which days.',
    classification: 'internal',
    data: z.object({
      assignmentId: z.string(),
      userId: z.string(),
      projectId: z.string(),
      startsOn: z.string(),
      endsOn: z.string(),
    }),
  },
] as const;
