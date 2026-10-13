import { z } from 'zod';

const leave = z.object({
  leaveId: z.string(),
  userId: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  days: z.number(),
});

/** The business events of leave: identifiers and days only; the manifest lists them (`emits`). */
export const leaveEvents = [
  {
    type: 'leave.asked',
    description: 'A leave was asked: who, which days, how many working days.',
    classification: 'internal',
    data: leave,
  },
  {
    type: 'leave.approved',
    description: 'A leave was approved: who is away, and when.',
    classification: 'internal',
    data: leave,
  },
] as const;
