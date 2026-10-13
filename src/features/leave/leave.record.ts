import { z } from 'zod';
import { leaveKinds, type LeaveKind } from './domain/days';
import type { LeaveStatus, Route } from './domain/leave';

// A leave, described once.

const id = z.string().min(1).max(64);

export const leaveInput = z.object({
  kind: z.enum(leaveKinds),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  reason: z.string().trim().max(500).optional(),
});

export const leaveCorrection = leaveInput.extend({ leaveId: id });
export const leaveRef = z.object({ leaveId: id });

export const leaveDecision = z.object({
  leaveId: id,
  decision: z.enum(['approve', 'refuse', 'return']),
  reason: z.string().trim().max(1000).optional(),
});

/** A decision taken at the center, applied here by the app itself. */
export const leaveSettled = leaveDecision.extend({ by: z.string().min(1).max(200) });

export interface Leave {
  leaveId: string;
  number: string;
  requester: { userId: string; name: string };
  kind: LeaveKind;
  startsOn: string;
  endsOn: string;
  /** Its working days, counted when it was asked. */
  days: number;
  reason: string | null;
  status: LeaveStatus;
  route: Route;
  decisionRequestId: string | null;
  decided: { by: string; reason: string | null } | null;
  askedOn: string;
}
